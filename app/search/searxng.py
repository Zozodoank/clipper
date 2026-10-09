"""SearXNG public instances engine (JSON preferred, HTML fallback)."""
from __future__ import annotations

import json

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

INSTANCES = (
    "https://searx.be",
    "https://paulgo.io",
    "https://searx.tiekoetter.com",
)


class SearxngEngine(SearchEngine):
    name = "searxng"
    instances = list(INSTANCES)

    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchResult]:
        last_error: Exception | None = None
        for base in self.instances:
            try:
                resp = await client.get(
                    f"{base}/search",
                    params={"q": self.build_query(query), "format": "json"},
                    headers={"User-Agent": UA},
                )
            except httpx.HTTPError as exc:
                last_error = exc
                continue
            if resp.status_code in (403, 429):
                last_error = EngineBlockedError(f"searxng {base} HTTP {resp.status_code}")
                continue
            if resp.status_code != 200:
                last_error = EngineBlockedError(f"searxng {base} HTTP {resp.status_code}")
                continue
            results = _parse_json(resp.text)
            if results:
                return results
            # some instances ignore format=json and return HTML
            results = _parse_html(resp.text)
            if results:
                return results
            last_error = EngineBlockedError(f"searxng {base} returned no youtube hits")
        raise EngineBlockedError(f"all searxng instances failed: {last_error}")

    async def health_check(self, client: httpx.AsyncClient) -> bool:
        for base in self.instances:
            try:
                resp = await client.get(
                    f"{base}/search", params={"q": "test"}, headers={"User-Agent": UA}
                )
                if resp.status_code == 200:
                    return True
            except httpx.HTTPError:
                continue
        return False


def _parse_json(text: str) -> list[SearchResult]:
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return []
    results: dict[str, SearchResult] = {}
    for item in data.get("results", []):
        url = item.get("url") or ""
        for video_id in extract_youtube_ids(url):
            if video_id not in results:
                results[video_id] = SearchResult(
                    url=canonical_url(video_id), title=item.get("title") or ""
                )
    return list(results.values())


def _parse_html(html: str) -> list[SearchResult]:
    soup = BeautifulSoup(html, "lxml")
    titles: dict[str, str] = {}
    for link in soup.find_all("a", href=True):
        for video_id in extract_youtube_ids(link["href"]):
            titles.setdefault(video_id, link.get_text(strip=True))
    return [SearchResult(url=canonical_url(vid), title=titles[vid]) for vid in titles]
