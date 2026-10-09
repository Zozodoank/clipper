"""Ordered multi-engine search with automatic fallback and cooldowns."""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

from app.search.base import EngineBlockedError, SearchEngine, SearchResult
from app.search.duckduckgo import DuckDuckGoEngine
from app.search.mojeek import MojeekEngine
from app.search.searxng import SearxngEngine

logger = logging.getLogger("clipper.search")


@dataclass
class _EngineState:
    engine: SearchEngine
    healthy: bool = True
    cooldown_until: float = 0.0
    failures: int = 0


class SearchManager:
    """Tries engines in priority order, cools down blocked ones, merges results."""

    def __init__(
        self,
        engines: list[SearchEngine] | None = None,
        *,
        cooldown_sec: float = 300.0,
        delay_sec: float = 1.5,
        min_results: int = 5,
        timeout_sec: float = 15.0,
    ):
        engines = engines or [DuckDuckGoEngine(), MojeekEngine(), SearxngEngine()]
        self._states = [_EngineState(e) for e in engines]
        self.cooldown_sec = cooldown_sec
        self.delay_sec = delay_sec
        self.min_results = min_results
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_sec),
            follow_redirects=True,
        )

    @property
    def client(self) -> httpx.AsyncClient:
        return self._client

    async def close(self) -> None:
        await self._client.aclose()

    async def search_all(self, query: str) -> tuple[list[SearchResult], str]:
        """Search across engines until enough unique results are gathered.

        Returns (results, engine_names_used). Engines that fail are cooled
        down for `cooldown_sec` so blocked engines are skipped on later runs.
        """
        collected: dict[str, SearchResult] = {}
        used: list[str] = []
        for state in self._states:
            now = time.monotonic()
            if not state.healthy and now < state.cooldown_until:
                logger.debug("engine %s in cooldown", state.engine.name)
                continue
            try:
                results = await state.engine.search(query, self._client)
            except EngineBlockedError as exc:
                logger.warning("engine %s failed: %s", state.engine.name, exc)
                state.healthy = False
                state.failures += 1
                state.cooldown_until = time.monotonic() + self.cooldown_sec
                continue
            except Exception:
                logger.exception("engine %s unexpected error", state.engine.name)
                state.failures += 1
                continue
            state.healthy = True
            state.failures = 0
            for result in results:
                collected.setdefault(result.youtube_id, result)
            used.append(state.engine.name)
            if len(collected) >= self.min_results:
                break
            await asyncio.sleep(self.delay_sec)
        return list(collected.values()), ",".join(used)

    def get_health(self) -> list[dict]:
        now = time.monotonic()
        return [
            {
                "name": s.engine.name,
                "healthy": s.healthy,
                "cooldown_sec": max(0.0, round(s.cooldown_until - now, 1)),
                "failures": s.failures,
            }
            for s in self._states
        ]
