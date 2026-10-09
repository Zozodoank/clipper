"""Pipeline tests with mocked search, resolver and ffprobe (offline)."""
from __future__ import annotations

import app.pipeline as pipeline_mod
from app.config import Settings
from app.db import Database
from app.models import VideoStatus
from app.pipeline import Pipeline
from app.search.base import SearchResult, canonical_url
from app.video.ffprobe import ProbeResult
from app.video.resolver import VideoMeta


def _make_settings(tmp_path, daily_limit: int = 2) -> Settings:
    return Settings(
        db_path=tmp_path / "test.db",
        daily_video_limit=daily_limit,
        proxy_url=None,
        ffprobe_path="ffprobe",
        ytdlp_path="yt-dlp",
        candidate_delay_sec=0.0,
    )


class FakeSearch:
    """Returns fixed results per query."""

    def __init__(self, count: int = 5):
        self.count = count

    async def search_all(self, query: str) -> tuple[list[SearchResult], str]:
        results = [
            SearchResult(
                url=canonical_url(f"vid{i:08d}"), title=f"video {i}"
            )
            for i in range(1, self.count + 1)
        ]
        return results, "fake"


def _fake_probe(width: int = 1920, height: int = 1080) -> ProbeResult:
    return ProbeResult(
        width=width,
        height=height,
        codec="h264",
        fps=30.0,
        duration=60.0,
        raw={"streams": [{"width": width, "height": height}]},
    )


def _install_fakes(monkeypatch, meta: VideoMeta, probe: ProbeResult):
    async def fake_resolve(url, settings):
        return meta

    async def fake_probe_stream(stream_url, timeout_sec=20.0):
        return probe

    monkeypatch.setattr(pipeline_mod, "resolve_video", fake_resolve)
    monkeypatch.setattr(pipeline_mod, "probe_stream", fake_probe_stream)


async def test_pipeline_passes_and_stops_at_daily_limit(tmp_path, monkeypatch):
    settings = _make_settings(tmp_path, daily_limit=2)
    db = Database(settings.db_path)
    await db.init_db()
    search = FakeSearch(count=5)

    meta = VideoMeta(
        youtube_id="vid00000001", url="https://www.youtube.com/watch?v=vid00000001",
        title="t", channel="c", duration=10, view_count=1,
        stream_url="http://stream/1",
    )
    _install_fakes(monkeypatch, meta, _fake_probe())

    pipeline = Pipeline(settings, db, search)
    summary = await pipeline.run_all(["Samsung Galaxy S24"])

    assert summary["passed"] == 2
    assert summary["failed"] == 0
    assert await db.get_daily_count(pipeline.today()) == 2
    # remaining candidates stored as NEW, quota exhausted
    assert await db.count_videos("passed") == 2
    assert await db.count_videos("new") == 3


async def test_pipeline_marks_below_1080p_as_failed(tmp_path, monkeypatch):
    settings = _make_settings(tmp_path, daily_limit=10)
    db = Database(settings.db_path)
    await db.init_db()
    search = FakeSearch(count=1)

    meta = VideoMeta(
        youtube_id="vid00000001", url="https://www.youtube.com/watch?v=vid00000001",
        title="t", channel="c", duration=10, view_count=1,
        stream_url="http://stream/1",
    )
    _install_fakes(monkeypatch, meta, _fake_probe(width=1280, height=720))

    pipeline = Pipeline(settings, db, search)
    summary = await pipeline.run_all(["query"])

    assert summary["passed"] == 0
    assert summary["failed"] == 1
    assert await db.get_daily_count(pipeline.today()) == 0
    stored = await db.get_video("vid00000001")
    assert stored["status"] == VideoStatus.FAILED.value
    assert stored["width"] == 1280
    assert stored["height"] == 720


async def test_pipeline_marks_no_1080p_format_as_failed(tmp_path, monkeypatch):
    settings = _make_settings(tmp_path, daily_limit=10)
    db = Database(settings.db_path)
    await db.init_db()
    search = FakeSearch(count=1)

    meta = VideoMeta(
        youtube_id="vid00000001", url="https://www.youtube.com/watch?v=vid00000001",
        title="t", channel="c", duration=10, view_count=1,
        stream_url="",  # no 1080p format
    )
    _install_fakes(monkeypatch, meta, _fake_probe())

    pipeline = Pipeline(settings, db, search)
    summary = await pipeline.run_all(["query"])

    assert summary["failed"] == 1
    stored = await db.get_video("vid00000001")
    assert stored["status"] == VideoStatus.FAILED.value
    assert "no 1080p" in stored["error"]


async def test_pipeline_skips_already_passed_videos(tmp_path, monkeypatch):
    settings = _make_settings(tmp_path, daily_limit=10)
    db = Database(settings.db_path)
    await db.init_db()

    from app.models import VideoCandidate

    existing = VideoCandidate(
        youtube_id="vid00000001",
        url="https://www.youtube.com/watch?v=vid00000001",
        title="t",
        status=VideoStatus.PASSED,
    )
    await db.upsert_video(existing)

    search = FakeSearch(count=2)
    meta = VideoMeta(
        youtube_id="vid00000002", url="https://www.youtube.com/watch?v=vid00000002",
        title="t2", channel="c", duration=10, view_count=1,
        stream_url="http://stream/2",
    )
    _install_fakes(monkeypatch, meta, _fake_probe())

    pipeline = Pipeline(settings, db, search)
    summary = await pipeline.run_all(["query"])

    assert summary["skipped"] == 1
    assert summary["passed"] == 1


async def test_probe_failure_is_retried_and_then_failed(tmp_path, monkeypatch):
    settings = _make_settings(tmp_path, daily_limit=10)
    db = Database(settings.db_path)
    await db.init_db()
    search = FakeSearch(count=1)

    meta = VideoMeta(
        youtube_id="vid00000001", url="https://www.youtube.com/watch?v=vid00000001",
        title="t", channel="c", duration=10, view_count=1,
        stream_url="http://stream/1",
    )
    _install_fakes(monkeypatch, meta, _fake_probe())

    calls = {"probe": 0}

    from app.video.ffprobe import ProbeError

    async def flaky_probe(stream_url, timeout_sec=20.0):
        calls["probe"] += 1
        if calls["probe"] == 1:
            raise ProbeError("expired URL")
        return _fake_probe()

    monkeypatch.setattr(pipeline_mod, "probe_stream", flaky_probe)

    pipeline = Pipeline(settings, db, search)
    summary = await pipeline.run_all(["query"])

    assert calls["probe"] == 2
    assert summary["passed"] == 1
