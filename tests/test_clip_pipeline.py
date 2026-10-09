import pytest
from unittest.mock import AsyncMock, patch
from app.config import Settings
from app.video.resolver import ResolveError, VideoMeta
from app.clip.pipeline import ClipPipeline, ClipJob, ClipStatus

@pytest.mark.asyncio
async def test_resolve_with_fallback(monkeypatch):
    settings = Settings()
    candidate = {
        "youtube_id": "123",
        "url": "https://youtube.com/watch?v=123",
        "title": "Test Video",
        "channel": "Test Channel",
        "stream_url": "https://cached-stream-url.com/video.mp4"
    }

    # Mock resolve_video to FAIL
    async def mock_resolve_video(*args, **kwargs):
        raise ResolveError("yt-dlp failed", kind="exit")
    monkeypatch.setattr("app.clip.pipeline.resolve_video", mock_resolve_video)

    # Mock probe_stream to SUCCEED
    async def mock_probe_stream(*args, **kwargs):
        return True
    monkeypatch.setattr("app.clip.pipeline.probe_stream", mock_probe_stream)
    
    # Import locally to test the inner function
    from app.clip.pipeline import _resolve_with_fallback
    
    # The fallback should use the cached stream_url
    meta = await _resolve_with_fallback(candidate, settings)
    assert meta.stream_url == "https://cached-stream-url.com/video.mp4"
    assert meta.youtube_id == "123"

@pytest.mark.asyncio
async def test_resolve_with_fallback_probe_fails(monkeypatch):
    settings = Settings()
    candidate = {
        "youtube_id": "123",
        "url": "https://youtube.com/watch?v=123",
        "title": "Test Video",
        "channel": "Test Channel",
        "stream_url": "https://cached-stream-url.com/video.mp4"
    }

    async def mock_resolve_video(*args, **kwargs):
        raise ResolveError("yt-dlp failed", kind="exit")
    monkeypatch.setattr("app.clip.pipeline.resolve_video", mock_resolve_video)

    from app.video.ffprobe import ProbeError
    async def mock_probe_stream(*args, **kwargs):
        raise ProbeError("Server returned 403 Forbidden")
    monkeypatch.setattr("app.clip.pipeline.probe_stream", mock_probe_stream)
    
    from app.clip.pipeline import _resolve_with_fallback
    
    with pytest.raises(ResolveError) as exc_info:
        await _resolve_with_fallback(candidate, settings)
        
    assert "fresh resolve and cached stream URL both failed" in str(exc_info.value)
