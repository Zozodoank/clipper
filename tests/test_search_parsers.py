"""Unit tests for the search-engine parsers (offline, fixture-driven)."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest

from app.search.base import EngineBlockedError, extract_youtube_ids
from app.search.duckduckgo import DuckDuckGoEngine
from app.search.mojeek import MojeekEngine
from app.search.rapidapi import RapidApiEngine
from app.search.searxng import SearxngEngine
from app.search.ytsearch import YtSearchEngine

FIXTURES = Path(__file__).parent / "fixtures"


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# -- base helpers ---------------------------------------------------------


def test_extract_youtube_ids_decodes_and_dedupes():
    text = (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ and "
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ and "
        "https://youtu.be/9bZkp7q19f0"
    )
    assert extract_youtube_ids(text) == ["dQw4w9WgXcQ", "9bZkp7q19f0"]


# -- DuckDuckGo ------------------------------------------------------------


async def test_ddg_parses_result_links():
    html = (FIXTURES / "ddg_results.html").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode())
        assert "site:youtube.com" in form["q"][0]
        return httpx.Response(200, text=html)

    engine = DuckDuckGoEngine()
    async with _client(handler) as client:
        results = await engine.search("Samsung Galaxy S24", client)
    assert [r.youtube_id for r in results] == ["dQw4w9WgXcQ", "9bZkp7q19f0"]
    assert results[0].url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert "Samsung" in results[0].title


async def test_ddg_raises_blocked_on_connect_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("SSL: CERTIFICATE_VERIFY_FAILED hostname mismatch")

    engine = DuckDuckGoEngine()
    async with _client(handler) as client:
        with pytest.raises(EngineBlockedError):
            await engine.search("query", client)


async def test_ddg_raises_blocked_on_429():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="rate limited")

    engine = DuckDuckGoEngine()
    async with _client(handler) as client:
        with pytest.raises(EngineBlockedError):
            await engine.search("query", client)


# -- Mojeek ----------------------------------------------------------------


async def test_mojeek_parses_result_links():
    html = (FIXTURES / "mojeek_results.html").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        assert "site:youtube.com" in request.url.params["q"]
        return httpx.Response(200, text=html)

    engine = MojeekEngine()
    async with _client(handler) as client:
        results = await engine.search("iPhone 15 Pro Max", client)
    assert [r.youtube_id for r in results] == ["dQw4w9WgXcQ", "9bZkp7q19f0"]


# -- SearXNG ---------------------------------------------------------------


async def test_searxng_parses_json():
    payload = (FIXTURES / "searxng_results.json").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=payload)

    engine = SearxngEngine()
    async with _client(handler) as client:
        results = await engine.search("test phone", client)
    assert [r.youtube_id for r in results] == ["dQw4w9WgXcQ", "9bZkp7q19f0"]


async def test_searxng_falls_back_to_next_instance():
    html = (FIXTURES / "mojeek_results.html").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        if "searx.be" in request.url.host:
            return httpx.Response(500, text="boom")
        if "paulgo.io" in request.url.host:
            return httpx.Response(200, text=html)  # HTML despite format=json
        return httpx.Response(200, text="{}")

    engine = SearxngEngine()
    async with _client(handler) as client:
        results = await engine.search("test phone", client)
    assert [r.youtube_id for r in results] == ["dQw4w9WgXcQ", "9bZkp7q19f0"]


async def test_searxng_raises_blocked_when_all_instances_fail():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="denied")

    engine = SearxngEngine()
    async with _client(handler) as client:
        with pytest.raises(EngineBlockedError):
            await engine.search("test phone", client)


# -- RapidAPI yt-api --------------------------------------------------------


async def test_rapidapi_parses_video_items():
    payload = (
        '{"data": ['
        '{"type": "ad", "videoId": "ad000000001", "title": "skip ad"},'
        '{"type": "video", "videoId": "YohkOvHTYCA", "title": "Galaxy S24 review"},'
        '{"type": "video", "videoId": "JUay0yJ-w88", "title": "Another one"}'
        ']}'
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-rapidapi-key"] == "test-key"
        assert request.url.params["query"] == "Samsung Galaxy S24"  # raw term
        return httpx.Response(200, text=payload)

    engine = RapidApiEngine(api_key="test-key")
    async with _client(handler) as client:
        results = await engine.search("Samsung Galaxy S24", client)
    assert [r.youtube_id for r in results] == ["YohkOvHTYCA", "JUay0yJ-w88"]
    assert "review" in results[0].title


async def test_rapidapi_raises_blocked_without_key():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text='{"data": []}')

    engine = RapidApiEngine(api_key=None)
    async with _client(handler) as client:
        with pytest.raises(EngineBlockedError, match="not configured"):
            await engine.search("query", client)


# -- yt-dlp ytsearch ---------------------------------------------------------


async def test_ytsearch_parses_flat_playlist(monkeypatch):
    import app.search.ytsearch as ytsearch_mod

    class FakeProc:
        returncode = 0

        async def communicate(self):
            return (
                b'{"entries": ['
                b'{"id": "YohkOvHTYCA", "title": "v1"},'
                b'{"id": "JUay0yJ-w88", "title": "v2"}'
                b']}',
                b"",
            )

    async def fake_create(*args, **kwargs):
        return FakeProc()

    monkeypatch.setattr(ytsearch_mod.asyncio, "create_subprocess_exec", fake_create)
    monkeypatch.setattr(ytsearch_mod, "find_ytdlp", lambda: ["yt-dlp"])
    from app.config import Settings

    engine = YtSearchEngine(settings=Settings(proxy_url=None))
    async with httpx.AsyncClient() as client:
        results = await engine.search("Samsung Galaxy S24", client)
    assert [r.youtube_id for r in results] == ["YohkOvHTYCA", "JUay0yJ-w88"]


async def test_ytsearch_raises_blocked_on_nonzero_exit(monkeypatch):
    import app.search.ytsearch as ytsearch_mod

    class FakeProc:
        returncode = 1

        async def communicate(self):
            return b"", b"ERROR: unable to download video data"

    async def fake_create(*args, **kwargs):
        return FakeProc()

    monkeypatch.setattr(ytsearch_mod.asyncio, "create_subprocess_exec", fake_create)
    monkeypatch.setattr(ytsearch_mod, "find_ytdlp", lambda: ["yt-dlp"])
    from app.config import Settings

    engine = YtSearchEngine(settings=Settings(proxy_url=None))
    async with httpx.AsyncClient() as client:
        with pytest.raises(EngineBlockedError, match="ytsearch exit 1"):
            await engine.search("query", client)
