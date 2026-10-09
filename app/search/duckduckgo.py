"""DuckDuckGo HTML endpoint engine (primary per user preference)."""
from __future__ import annotations

import httpx
from bs4 import BeautifulSoup

from app.search.base import (
    EngineBlockedError,
    SearchEngine,
    SearchResult,
    canonical_url,
    extract_youtube_ids,
)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


class DuckDuckGoEngine(SearchEngine):
    name = "duckduckgo"
    endpoint = "https://html.duckduckgo.com/html/"

    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchResult]:
        try:
            resp = await client.post(
                self.endpoint,
                data={"q": self.build_query(query)},
                headers={
                    "User-Agent": UA,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
        except httpx.HTTPError as exc:
            # TLS interception (ISP block) surfaces as ConnectError here
            raise EngineBlockedError(f"duckduckgo unreachable: {exc}") from exc
        if resp.status_code in (403, 429):
            raise EngineBlockedError(
                f"duckduckgo rejected request (HTTP {resp.status_code})"
            )
        resp.raise_for_status()
        return _parse(resp.text)

    async def health_check(self, client: httpx.AsyncClient) -> bool:
        try:
            resp = await client.get(self.endpoint, headers={"User-Agent": UA})
            return resp.status_code == 200
        except httpx.HTTPError:
            return False


def _parse(html: str) -> list[SearchResult]:
    soup = BeautifulSoup(html, "lxml")
    titles: dict[str, str] = {}
    for link in soup.select("a.result__a"):
        for video_id in extract_youtube_ids(link.get("href", "")):
            titles.setdefault(video_id, link.get_text(strip=True))
    if not titles:  # layout fallback: scan every anchor
        for link in soup.find_all("a", href=True):
            for video_id in extract_youtube_ids(link["href"]):
                titles.setdefault(video_id, link.get_text(strip=True))
    return [SearchResult(url=canonical_url(vid), title=titles[vid]) for vid in titles]
