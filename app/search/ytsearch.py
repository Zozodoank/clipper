"""yt-dlp `ytsearch` engine: direct YouTube search as a backstop source."""
from __future__ import annotations

import asyncio
import json

import httpx

from app.config import Settings, find_ytdlp
from app.search.base import EngineBlockedError, SearchEngine, SearchResult, canonical_url


class YtSearchEngine(SearchEngine):
    """Searches YouTube directly via yt-dlp's ytsearch extractor (no API key)."""

    name = "ytsearch"

    def __init__(self, settings: Settings | None = None, max_results: int = 8):
        self._settings = settings
        self.max_results = max_results

    def build_query(self, term: str) -> str:
        # ytsearch already targets YouTube; no site: filter needed
        return term

    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchResult]:
        from app.config import get_settings

        settings = self._settings or get_settings()
        cmd = find_ytdlp()
        if settings.ytdlp_proxy:
            cmd += ["--proxy", settings.ytdlp_proxy]
        cmd += [
            "--no-warnings",
            "--flat-playlist",
            "--dump-single-json",
            f"ytsearch{self.max_results}:{self.build_query(query)}",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=settings.ytdlp_timeout_sec
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise EngineBlockedError("ytsearch timeout")
        if proc.returncode != 0:
            detail = stderr.decode(errors="replace").strip().splitlines()
            raise EngineBlockedError(
                f"ytsearch exit {proc.returncode}: {detail[-1] if detail else 'unknown'}"
            )
        try:
            data = json.loads(stdout.decode(errors="replace"))
        except json.JSONDecodeError as exc:
            raise EngineBlockedError(f"ytsearch invalid JSON: {exc}") from exc
        results: dict[str, SearchResult] = {}
        for entry in data.get("entries") or []:
            video_id = entry.get("id")
            if video_id and video_id not in results:
                results[video_id] = SearchResult(
                    url=canonical_url(video_id), title=entry.get("title") or ""
                )
        return list(results.values())

    async def health_check(self, client: httpx.AsyncClient) -> bool:
        return True
