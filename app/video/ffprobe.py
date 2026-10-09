"""ffprobe subprocess wrapper: verify 1080p quality over HTTP, no download."""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any

from app.config import find_ffprobe

_URL_RE = re.compile(r"https?://\S+")


class ProbeError(Exception):
    """ffprobe failed, timed out, or returned no video stream."""


@dataclass
class ProbeResult:
    width: int
    height: int
    codec: str
    fps: float | None
    duration: float | None
    raw: dict[str, Any]

    @property
    def is_1080p(self) -> bool:
        return self.width >= 1920 and self.height >= 1080


async def _run_proc(cmd: list[str], timeout_sec: float) -> tuple[int, str, str]:
    """Run a subprocess; raise ProbeError on timeout. Returns (rc, out, err)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise ProbeError(f"ffprobe timeout after {timeout_sec}s")
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


def _parse_fps(value: str | None) -> float | None:
    try:
        num, _, den = (value or "0/0").partition("/")
        if float(den) == 0:
            return None
        return float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        return None


async def probe_stream(stream_url: str, timeout_sec: float = 20.0) -> ProbeResult:
    """Probe a direct video stream URL and return its video stream details."""
    exe = find_ffprobe()
    if not exe:
        raise ProbeError(
            "ffprobe not found; install with: winget install -e --id Gyan.FFmpeg"
        )
    cmd = [
        exe,
        "-v", "error",
        "-print_format", "json",
        "-show_streams", "-show_format",
        "-select_streams", "v:0",
        "-timeout", "15000000",  # microseconds (15s HTTP timeout)
        "-analyzeduration", "20M",
        "-probesize", "20M",
        stream_url,
    ]
    returncode, stdout, stderr = await _run_proc(cmd, timeout_sec)
    if returncode != 0:
        detail = stderr.strip().splitlines()
        last = _URL_RE.sub("<url-redacted>", detail[-1]) if detail else "unknown error"
        raise ProbeError(f"ffprobe exit {returncode}: {last}")
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise ProbeError(f"ffprobe returned invalid JSON: {exc}") from exc
    streams = data.get("streams") or []
    if not streams:
        raise ProbeError("no video stream in probe result")
    stream = streams[0]
    fmt = data.get("format") or {}
    duration: float | None = None
    if fmt.get("duration"):
        try:
            duration = float(fmt["duration"])
        except (TypeError, ValueError):
            duration = None
    return ProbeResult(
        width=int(stream.get("width") or 0),
        height=int(stream.get("height") or 0),
        codec=stream.get("codec_name") or "",
        fps=_parse_fps(stream.get("avg_frame_rate")),
        duration=duration,
        raw=data,
    )
