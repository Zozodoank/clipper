"""Unit tests for the ffprobe verifier (subprocess output mocked)."""
from __future__ import annotations

import asyncio
import json

import pytest

import app.video.ffprobe as ffprobe
from app.video.ffprobe import ProbeError, ProbeResult, probe_stream


def _probe_payload(width: int, height: int, codec: str = "h264") -> str:
    return json.dumps(
        {
            "streams": [
                {
                    "codec_name": codec,
                    "width": width,
                    "height": height,
                    "avg_frame_rate": "30000/1001",
                }
            ],
            "format": {"duration": "120.5"},
        }
    )


async def test_probe_passes_1080p(monkeypatch):
    payload = _probe_payload(1920, 1080)

    async def fake_run(cmd, timeout_sec):
        return 0, payload, ""

    monkeypatch.setattr(ffprobe, "_run_proc", fake_run)
    monkeypatch.setattr(ffprobe, "find_ffprobe", lambda: "ffprobe")

    result = await probe_stream("http://stream.example/v.mp4")
    assert isinstance(result, ProbeResult)
    assert result.is_1080p
    assert result.width == 1920
    assert result.height == 1080
    assert result.codec == "h264"
    assert result.fps == pytest.approx(29.97, rel=1e-2)
    assert result.duration == 120.5


async def test_probe_rejects_720p(monkeypatch):
    payload = _probe_payload(1280, 720)

    async def fake_run(cmd, timeout_sec):
        return 0, payload, ""

    monkeypatch.setattr(ffprobe, "_run_proc", fake_run)
    monkeypatch.setattr(ffprobe, "find_ffprobe", lambda: "ffprobe")

    result = await probe_stream("http://stream.example/v.mp4")
    assert not result.is_1080p


async def test_probe_raises_on_nonzero_exit(monkeypatch):
    async def fake_run(cmd, timeout_sec):
        return 1, "", "Server returned 403 Forbidden"

    monkeypatch.setattr(ffprobe, "_run_proc", fake_run)
    monkeypatch.setattr(ffprobe, "find_ffprobe", lambda: "ffprobe")

    with pytest.raises(ProbeError, match="403"):
        await probe_stream("http://stream.example/v.mp4")


async def test_probe_raises_on_timeout(monkeypatch):
    async def fake_run(cmd, timeout_sec):
        raise ProbeError(f"ffprobe timeout after {timeout_sec}s")

    monkeypatch.setattr(ffprobe, "_run_proc", fake_run)
    monkeypatch.setattr(ffprobe, "find_ffprobe", lambda: "ffprobe")

    with pytest.raises(ProbeError, match="timeout"):
        await probe_stream("http://stream.example/v.mp4")


async def test_probe_raises_on_invalid_json(monkeypatch):
    async def fake_run(cmd, timeout_sec):
        return 0, "not-json", ""

    monkeypatch.setattr(ffprobe, "_run_proc", fake_run)
    monkeypatch.setattr(ffprobe, "find_ffprobe", lambda: "ffprobe")

    with pytest.raises(ProbeError, match="invalid JSON"):
        await probe_stream("http://stream.example/v.mp4")


async def test_probe_raises_when_ffprobe_missing(monkeypatch):
    monkeypatch.setattr(ffprobe, "find_ffprobe", lambda: None)
    with pytest.raises(ProbeError, match="not found"):
        await probe_stream("http://stream.example/v.mp4")


async def test_real_subprocess_timeout_kills_process(monkeypatch):
    """The _run_proc helper must kill the child on timeout."""

    async def fake_communicate():
        raise asyncio.TimeoutError

    class FakeProc:
        returncode = 0
        killed = False

        async def communicate(self):
            return await fake_communicate()

        def kill(self):
            self.killed = True

        async def wait(self):
            pass

    proc = FakeProc()

    async def fake_create(*args, **kwargs):
        return proc

    monkeypatch.setattr(ffprobe.asyncio, "create_subprocess_exec", fake_create)
    with pytest.raises(ProbeError, match="timeout"):
        await ffprobe._run_proc(["ffprobe", "http://x"], 0.1)
    assert proc.killed
