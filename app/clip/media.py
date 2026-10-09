import asyncio
import logging
from pathlib import Path

from app.config import find_ffmpeg, find_ffprobe, get_settings

logger = logging.getLogger(__name__)

class MediaError(Exception):
    pass

async def _run_proc(*args: str, timeout: float = 600.0) -> None:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if proc.returncode != 0:
            err = stderr.decode(errors='ignore')
            logger.error(f"FFmpeg error: {err}")
            raise MediaError(f"Command failed with {proc.returncode}: {err}")
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise MediaError(f"Command timed out after {timeout}s")

async def download_section(stream_url: str, start: float, end: float, out_path: Path) -> None:
    ffmpeg = find_ffmpeg() or "ffmpeg"
    settings = get_settings()
    
    proxy_args = []
    if settings.ytdlp_proxy:
        proxy_args = ["-http_proxy", settings.ytdlp_proxy]

    try:
        await _run_proc(
            ffmpeg, "-y", *proxy_args, "-ss", str(start), "-to", str(end),
            "-i", stream_url, "-c", "copy", "-avoid_negative_ts", "make_zero",
            str(out_path)
        )
    except MediaError:
        # Retry with re-encode
        logger.warning(f"Failed to copy stream for {out_path.name}, retrying with re-encode")
        await _run_proc(
            ffmpeg, "-y", *proxy_args, "-ss", str(start), "-to", str(end),
            "-i", stream_url, "-c:v", "libx264", "-preset", "veryfast",
            "-avoid_negative_ts", "make_zero",
            str(out_path)
        )

async def extract_frames(video: Path | str, out_dir: Path, fps: float, size: str = "360x640") -> None:
    ffmpeg = find_ffmpeg() or "ffmpeg"
    settings = get_settings()
    proxy_args = []
    if settings.ytdlp_proxy:
        proxy_args = ["-http_proxy", settings.ytdlp_proxy]

    w, h = size.split('x')
    vf = f"fps={fps},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_pattern = str(out_dir / "f_%04d.jpg")
    await _run_proc(
        ffmpeg, "-y", *proxy_args, "-i", str(video), "-vf", vf, "-q:v", "3", out_pattern
    )

async def render_916(input_video: Path, out_path: Path) -> None:
    ffmpeg = find_ffmpeg() or "ffmpeg"
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p"
    await _run_proc(
        ffmpeg, "-y", "-i", str(input_video), "-vf", vf,
        "-r", "30", "-c:v", "libx264", "-crf", "20", "-preset", "medium",
        "-movflags", "+faststart", "-an", str(out_path)
    )

async def concat_videos(paths: list[Path], out_path: Path) -> None:
    if not paths:
        return
    ffmpeg = find_ffmpeg() or "ffmpeg"
    list_path = out_path.with_name(out_path.stem + "_list.txt")
    with open(list_path, "w", encoding="utf-8") as f:
        for p in paths:
            # Need to escape paths for ffmpeg concat demuxer
            f.write(f"file '{p.absolute().as_posix()}'\n")
    
    await _run_proc(
        ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_path),
        "-c", "copy", str(out_path)
    )

async def burn_subtitles(video: Path, srt: Path, out_path: Path) -> None:
    ffmpeg = find_ffmpeg() or "ffmpeg"
    # Escape path for subtitles filter: Windows backslashes need escaping, or use posix paths
    escaped_srt = srt.absolute().as_posix().replace(":", "\\\\:")
    vf = f"subtitles=filename='{escaped_srt}'"
    await _run_proc(
        ffmpeg, "-y", "-i", str(video), "-vf", vf,
        "-c:a", "copy", str(out_path)
    )

async def merge_audio(video: Path, audio: Path, out_path: Path) -> None:
    ffmpeg = find_ffmpeg() or "ffmpeg"
    await _run_proc(
        ffmpeg, "-y", "-i", str(video), "-i", str(audio),
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
        str(out_path)
    )

async def get_duration(path: Path) -> float:
    ffprobe = find_ffprobe() or "ffprobe"
    proc = await asyncio.create_subprocess_exec(
        ffprobe, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return 0.0
    try:
        return float(stdout.decode().strip())
    except ValueError:
        return 0.0
