"""RapidAPI yt-api engine (key provided in .env; reliable YouTube search)."""
from __future__ import annotations

import httpx

from app.search.base import (
    EngineBlockedError,
    SearchEngine,
    SearchResult,
    canonical_url,
)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


class RapidApiEngine(SearchEngine):
    name = "rapidapi"
    endpoint = "https://yt-api.p.rapidapi.com/search"

    def __init__(self, api_key: str | None, host: str = "yt-api.p.rapidapi.com"):
        self.api_key = api_key
        self.host = host

    def build_query(self, term: str) -> str:
        # the search API wants the raw brand+type term, no site: filter
        return term

    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchResult]:
        if not self.api_key:
            raise EngineBlockedError("rapidapi key not configured")
        try:
            resp = await client.get(
                self.endpoint,
                params={"query": self.build_query(query)},
                headers={
                    "User-Agent": UA,
                    "X-RapidAPI-Key": self.api_key,
                    "X-RapidAPI-Host": self.host,
                },
            )
        except httpx.HTTPError as exc:
            raise EngineBlockedError(f"rapidapi unreachable: {exc}") from exc
        if resp.status_code in (403, 429):
            raise EngineBlockedError(
                f"rapidapi rejected request (HTTP {resp.status_code})"
            )
        resp.raise_for_status()
        return _parse(resp.json())

    async def health_check(self, client: httpx.AsyncClient) -> bool:
        return bool(self.api_key)


def _parse(data: dict) -> list[SearchResult]:
    results: dict[str, SearchResult] = {}
    for item in data.get("data") or []:
        if item.get("type") != "video":
            continue
        video_id = item.get("videoId")
        if video_id and video_id not in results:
            results[video_id] = SearchResult(
                url=canonical_url(video_id), title=item.get("title") or ""
            )
    return list(results.values())
