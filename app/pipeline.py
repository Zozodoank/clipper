"""Pipeline orchestrator: queries -> search -> resolve -> probe -> store."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, date, datetime

from app.config import Settings
from app.db import Database
from app.models import VideoCandidate, VideoStatus
from app.search.base import SearchResult
from app.search.manager import SearchManager
from app.video.ffprobe import ProbeError, ProbeResult, probe_stream
from app.video.resolver import ResolveError, VideoMeta, resolve_video

logger = logging.getLogger("clipper.pipeline")


class Pipeline:
    """Runs the search + 1080p verification flow for brand+type queries."""

    def __init__(self, settings: Settings, db: Database, search: SearchManager):
        self.settings = settings
        self.db = db
        self.search = search
        self._probe_lock = asyncio.Semaphore(settings.probe_concurrency)
        self._query_lock = asyncio.Semaphore(settings.query_concurrency)
        self._run_lock = asyncio.Lock()

    def today(self) -> str:
        return date.today().isoformat()

    async def quota_reached(self) -> bool:
        used = await self.db.get_daily_count(self.today())
        return used >= self.settings.daily_video_limit

    async def run_all(self, queries: list[str]) -> dict:
        """Process all queries with limited concurrency; return a summary."""
        async with self._run_lock:
            async with asyncio.TaskGroup() as tg:
                tasks = [tg.create_task(self.process_query(q)) for q in queries]
            per_query = [task.result() for task in tasks]
        summary = {"total_found": 0, "passed": 0, "failed": 0, "skipped": 0, "processed_queries": 0}
        for item in per_query:
            summary["total_found"] += item["found"]
            summary["passed"] += item["passed"]
            summary["failed"] += item["failed"]
            summary["skipped"] += item["skipped"]
            summary["processed_queries"] += 1
        return summary

    async def process_query(self, query: str) -> dict:
        """Search one query and verify every unique candidate."""
        async with self._query_lock:
            return await self._process_query_locked(query)

    async def _process_query_locked(self, query: str) -> dict:
        item = {
            "query": query,
            "engine": "",
            "found": 0,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "error": "",
        }
        try:
            results, engines = await self.search.search_all(query)
            item["engine"] = engines
        except Exception as exc:  # noqa: BLE001 - a failing query must not kill the run
            logger.exception("search failed for %r", query)
            item["error"] = str(exc)
            return item

        for result in results:
            if await self.quota_reached():
                logger.info(
                    "daily quota reached (%s), storing remaining candidates as new",
                    self.settings.daily_video_limit,
                )
                stored = await self.db.get_video(result.youtube_id)
                if not stored:
                    await self.db.upsert_video(
                        self._build_candidate(
                            result, query, engines, None, None,
                            "daily quota reached; not probed", VideoStatus.NEW,
                        )
                    )
                continue
            stored = await self.db.get_video(result.youtube_id)
            if stored and stored["status"] == VideoStatus.PASSED.value:
                item["skipped"] += 1
                continue
            item["found"] += 1
            # pace yt-dlp calls: this ISP's DNS flaps under rapid bursts
            await asyncio.sleep(self.settings.candidate_delay_sec)
            if await self.verify_and_store(query, engines, result):
                item["passed"] += 1
            else:
                item["failed"] += 1
        return item

    async def verify_and_store(
        self, query: str, engine: str, result: SearchResult, *, count_quota: bool = True
    ) -> bool:
        """Resolve a 1080p stream, probe it with ffprobe, and persist the outcome."""
        async with self._probe_lock:
            try:
                meta = await resolve_video(result.url, self.settings)
                if not meta.stream_url:
                    await self._store(
                        result, query, engine, meta, None,
                        "no 1080p format available", VideoStatus.FAILED,
                    )
                    return False
                try:
                    probe = await probe_stream(
                        meta.stream_url, self.settings.probe_timeout_sec
                    )
                except ProbeError:
                    # stream URLs expire quickly: retry once with a fresh one
                    meta = await resolve_video(result.url, self.settings)
                    if not meta.stream_url:
                        await self._store(
                            result, query, engine, meta, None,
                            "no 1080p format on retry", VideoStatus.FAILED,
                        )
                        return False
                    probe = await probe_stream(
                        meta.stream_url, self.settings.probe_timeout_sec
                    )
            except (ResolveError, ProbeError, TimeoutError) as exc:
                logger.warning("verify failed for %s: %s", result.url, exc)
                await self._store(
                    result, query, engine, None, None, str(exc), VideoStatus.FAILED
                )
                return False
            except Exception:  # noqa: BLE001 - never let one video kill the run
                logger.exception("unexpected verify error for %s", result.url)
                await self._store(
                    result, query, engine, None, None,
                    "unexpected error", VideoStatus.FAILED,
                )
                return False

        if not probe.is_1080p:
            await self._store(
                result, query, engine, meta, probe,
                f"resolution {probe.width}x{probe.height} below 1080p",
                VideoStatus.FAILED,
            )
            return False

        if count_quota:
            accepted = await self.db.try_increment_daily(
                self.today(), self.settings.daily_video_limit
            )
            if not accepted:
                await self._store(
                    result, query, engine, meta, probe,
                    "daily quota reached", VideoStatus.FAILED,
                )
                return False

        await self._store(result, query, engine, meta, probe, "", VideoStatus.PASSED)
        return True

    async def recheck(self, youtube_id: str) -> dict:
        """Re-resolve and re-probe a stored video without touching the quota."""
        stored = await self.db.get_video(youtube_id)
        if not stored:
            raise KeyError(youtube_id)
        result = SearchResult(url=stored["url"], title=stored["title"])
        async with self._probe_lock:
            try:
                meta = await resolve_video(result.url, self.settings)
                if not meta.stream_url:
                    return {**stored, "recheck": "no 1080p format"}
                probe = await probe_stream(meta.stream_url, self.settings.probe_timeout_sec)
            except (ResolveError, ProbeError) as exc:
                logger.warning("recheck %s failed: %s", youtube_id, exc)
                return {**stored, "recheck": f"failed: {exc}"}
        status = VideoStatus.PASSED if probe.is_1080p else VideoStatus.FAILED
        error = "" if probe.is_1080p else (
            f"resolution {probe.width}x{probe.height} below 1080p"
        )
        await self._store(result, stored["query"], stored["engine"], meta, probe, error, status)
        updated = await self.db.get_video(youtube_id)
        return {**(updated or {}), "recheck": "ok"}

    async def _store(
        self,
        result: SearchResult,
        query: str,
        engine: str,
        meta: VideoMeta | None,
        probe: ProbeResult | None,
        error: str,
        status: VideoStatus,
    ) -> None:
        await self.db.upsert_video(
            self._build_candidate(result, query, engine, meta, probe, error, status)
        )

    @staticmethod
    def _build_candidate(
        result: SearchResult,
        query: str,
        engine: str,
        meta: VideoMeta | None,
        probe: ProbeResult | None,
        error: str,
        status: VideoStatus,
    ) -> VideoCandidate:
        return VideoCandidate(
            youtube_id=result.youtube_id,
            url=result.url,
            title=meta.title if meta else result.title,
            channel=meta.channel if meta else "",
            duration=meta.duration if meta else None,
            view_count=meta.view_count if meta else None,
            query=query,
            engine=engine,
            status=status,
            width=probe.width if probe else None,
            height=probe.height if probe else None,
            codec=probe.codec if probe else "",
            fps=probe.fps if probe else None,
            stream_url=meta.stream_url if meta else "",
            error=error,
            probe_json=json.dumps(probe.raw) if probe else "",
            probed_at=datetime.now(UTC) if probe else None,
        )
