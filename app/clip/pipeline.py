import logging
from datetime import datetime
from pathlib import Path

from app.clip.models import ClipJob, ClipStatus, FinalClip
from app.db import Database
from app.config import Settings
from app.clip.gemini import GeminiClient
from app.clip.qwen import get_analyzer
from app.video.resolver import resolve_video, ResolveError, VideoMeta
from app.video.ffprobe import probe_stream, ProbeError

logger = logging.getLogger(__name__)

async def _resolve_with_fallback(candidate: dict, settings: Settings) -> VideoMeta:
    try:
        meta = await resolve_video(candidate["url"], settings)
        if meta and meta.stream_url:
            return meta
    except ResolveError as exc:
        logger.warning("resolve_video failed: %s. Falling back to cached stream URL...", exc)
    except Exception as exc:  # noqa: BLE001 - non-Resolve errors also deserve the fallback
        logger.warning(
            "resolve_video raised %s: %s. Falling back to cached stream URL...",
            type(exc).__name__, exc,
        )

    cached_url = candidate.get("stream_url")
    if not cached_url:
        raise ResolveError("No fresh stream URL and no cached stream URL available", kind="exit")

    try:
        await probe_stream(cached_url, settings.probe_timeout_sec)
    except ProbeError as exc:
        reason = str(exc)
        if "403" in reason or "401" in reason:
            # googlevideo URLs are IP-locked to the host that resolved them
            raise ResolveError(
                "fresh resolve and cached stream URL both failed: cached stream URL "
                "rejected (expired or IP-locked to the host that resolved it)",
                kind="exit",
            ) from exc
        raise ResolveError(f"fresh resolve and cached stream URL both failed: {reason}", kind="exit") from exc

    return VideoMeta(
        youtube_id=candidate["youtube_id"],
        url=candidate["url"],
        title=candidate["title"],
        channel=candidate["channel"],
        duration=candidate.get("duration"),
        view_count=candidate.get("view_count"),
        stream_url=cached_url,
    )

class ClipPipeline:
    def __init__(self, settings: Settings, db: Database):
        self.settings = settings
        self.db = db
        self.gemini = GeminiClient(settings)
        self.analyzer = get_analyzer(settings)

    async def process_product(self, job: ClipJob) -> None:
        job.status = ClipStatus.checking
        job.step = "Finding candidate video"
        await self.db.save_clip_job(job)

        # Simplified for mock
        videos = await self.db.list_videos(status="passed", limit=100)
        candidates = [v for v in videos if v["query"] == job.query]
        
        if not candidates:
            # Hint when candidates exist but are not 'passed' yet (e.g. daily quota reached)
            all_videos = await self.db.list_videos(status=None, limit=200)
            related = [v for v in all_videos if v["query"] == job.query]
            hint = ""
            if related:
                statuses = sorted({v["status"] for v in related})
                hint = f" ({len(related)} candidate(s) exist with status {statuses}; only 'passed' videos can be clipped)"
            job.status = ClipStatus.error
            job.error = f"No passed videos found for query{hint}"
            job.finished_at = datetime.utcnow()
            await self.db.save_clip_job(job)
            return

        candidate = None
        for c in candidates:
            if await self.db.get_final(c["youtube_id"]) is None:
                candidate = c
                break
                
        if not candidate:
            job.status = ClipStatus.error
            job.error = "All candidates for this query have already been processed"
            job.finished_at = datetime.utcnow()
            await self.db.save_clip_job(job)
            return
            
        job.youtube_id = candidate["youtube_id"]
        job.status = ClipStatus.planning
        job.step = "Planning sections via Gemini"
        await self.db.save_clip_job(job)
        
        import shutil
        import uuid
        from app.clip.media import extract_frames, download_section, concat_videos, render_916, merge_audio
        
        job_dir = Path(self.settings.output_dir) / job.id
        job_dir.mkdir(parents=True, exist_ok=True)
        frames_dir = job_dir / "frames"
        
        try:
            job.step = "Resolving fresh stream URL"
            await self.db.save_clip_job(job)
            
            meta = await _resolve_with_fallback(candidate, self.settings)
            fresh_stream_url = meta.stream_url
            
            # 1. Extract frames from YouTube stream
            job.step = "Extracting frames"
            await self.db.save_clip_job(job)
            await extract_frames(fresh_stream_url, frames_dir, fps=self.settings.section_discovery_fps)
            
            frame_paths = sorted(frames_dir.glob("*.jpg"))
            if not frame_paths:
                raise Exception("Failed to extract frames")
                
            # 2. Analyze frames with Qwen
            job.step = "Analyzing frames with Qwen VLM"
            await self.db.save_clip_job(job)
            analysis_results = await self.analyzer.analyze_batch(frame_paths, mode="camera")
            
            # Filter clean frames
            clean_frames = [fp for fp, res in zip(frame_paths, analysis_results) if res.get("clean", False)]
            if not clean_frames:
                raise Exception("No clean frames found in the video")
                
            # 3. Plan sections with Gemini
            job.step = "Planning sections via Gemini"
            await self.db.save_clip_job(job)
            sections = await self.gemini.plan_sections(candidate["title"], candidate, clean_frames[:10])
            if not sections:
                raise Exception("Gemini failed to plan sections")
                
            # 4. Download and concat sections
            job.step = "Downloading segments"
            await self.db.save_clip_job(job)
            segment_paths = []
            for i, sec in enumerate(sections):
                out_path = job_dir / f"sec_{i}.mp4"
                await download_section(fresh_stream_url, sec.start, sec.end, out_path)
                segment_paths.append(out_path)
                
            concat_path = job_dir / "concat.mp4"
            await concat_videos(segment_paths, concat_path)
            
            # 5. Render to 9:16
            job.step = "Rendering to 9:16 format"
            await self.db.save_clip_job(job)
            render_path = job_dir / "render.mp4"
            await render_916(concat_path, render_path)
            
            # 6. Generate Script & TTS
            job.step = "Generating Script and Voiceover"
            await self.db.save_clip_job(job)
            script_data = await self.gemini.write_script_and_caption(candidate["title"], candidate, clean_frames[:5], 45.0, sections)
            tts_text = " ".join([s.get("text", "") for s in script_data.get("script", [])])
            if not tts_text:
                tts_text = f"This is a review of {job.query}. Check it out!"
                
            audio_bytes, _ = await self.gemini.synthesize(tts_text)
            audio_path = job_dir / "voice.mp3"
            with open(audio_path, "wb") as f:
                f.write(audio_bytes)
                
            # 7. Merge Audio
            job.step = "Merging audio and finalizing"
            await self.db.save_clip_job(job)
            final_mp4 = Path(self.settings.output_dir) / f"{job.id}_final.mp4"
            await merge_audio(render_path, audio_path, final_mp4)
            
            # 8. Save FinalClip
            final = FinalClip(
                youtube_id=candidate["youtube_id"],
                query=job.query,
                title=candidate["title"],
                channel=candidate["channel"],
                duration=45.0,
                final_path=f"/output/{job.id}_final.mp4",
                subtitle_path="",
                voiceover_path="",
                caption=script_data.get("caption", f"Checkout {job.query}! #review"),
                hashtags=script_data.get("hashtags", ["#review"]),
                created_at=datetime.utcnow()
            )
            await self.db.upsert_final(final)
            
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

        job.status = ClipStatus.done
        job.step = "Finished"
        job.finished_at = datetime.utcnow()
        await self.db.save_clip_job(job)
