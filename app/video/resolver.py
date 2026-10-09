"""yt-dlp subprocess wrapper: metadata + 1080p stream URL resolution.

yt-dlp runs as a subprocess (not a Python import) so it can be killed
cleanly on timeout on Windows and stays version-isolated.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass

from app.config import Settings, find_ytdlp


class ResolveError(Exception):
    """yt-dlp failed or timed out."""
    def __init__(self, message: str, kind: str = "exit"):
        super().__init__(message)
        self.kind = kind


@dataclass
class VideoMeta:
    youtube_id: str
    url: str
    title: str
    channel: str
    duration: float | None
    view_count: int | None
    stream_url: str  # 1080p video-only stream ("" when unavailable)


import logging
import os
import re
import signal

logger = logging.getLogger("app.video.resolver")

_URL_RE = re.compile(r"https?://\S+")

async def _run(cmd: list[str], timeout: float) -> tuple[str, str]:
    kwargs = {}
    if os.name == "posix":
        kwargs["start_new_session"] = True

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **kwargs
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        if os.name == "posix":
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        await proc.wait()
        raise ResolveError(f"yt-dlp timeout after {timeout}s", kind="timeout")
    if proc.returncode != 0:
        detail = stderr.decode(errors="replace").strip().splitlines()
        last = _URL_RE.sub("<url-redacted>", detail[-1]) if detail else "unknown error"
        raise ResolveError(
            f"yt-dlp exit {proc.returncode}: {last}",
            kind="exit"
        )
    return stdout.decode(errors="replace"), stderr.decode(errors="replace")


def _base_cmd(settings: Settings) -> list[str]:
    cmd = find_ytdlp()
    if settings.ytdlp_proxy:
        cmd += ["--proxy", settings.ytdlp_proxy]
    cmd += [
        "--retries", str(settings.ytdlp_retries),
        "--extractor-retries", str(settings.ytdlp_retries),
        "--socket-timeout", "15",
    ]
    if not settings.disable_cookies:
        cmd += ["--cookies-from-browser", "chrome"]
    return cmd


async def _resolve_once(url: str, settings: Settings) -> VideoMeta:
    base = _base_cmd(settings)

    meta_cmd = base + ["--skip-download", "--no-warnings", "--dump-single-json", url]
    meta_out, _ = await _run(meta_cmd, settings.ytdlp_timeout_sec)
    info = json.loads(meta_out)

    stream_cmd = base + [
        "--skip-download",
        "--no-warnings",
        "-f",
        "bv*[height>=1080]/b[height>=1080]",
        "--get-url",
        url,
    ]
    stream_out, _ = await _run(stream_cmd, settings.ytdlp_timeout_sec)
    lines = [line for line in stream_out.strip().splitlines() if line.strip()]
    stream_url = lines[0] if lines else ""

    video_id = info.get("id") or ""
    return VideoMeta(
        youtube_id=video_id,
        url=f"https://www.youtube.com/watch?v={video_id}" if video_id else url,
        title=info.get("title") or "",
        channel=info.get("channel") or info.get("uploader") or "",
        duration=info.get("duration"),
        view_count=info.get("view_count"),
        stream_url=stream_url,
    )

async def resolve_video(url: str, settings: Settings) -> VideoMeta:
    """Fetch video metadata and a direct >=1080p stream URL for `url` with retries."""
    attempts = max(1, settings.ytdlp_max_retries)
    last_err: ResolveError | None = None
    for attempt in range(attempts):
        try:
            return await _resolve_once(url, settings)
        except ResolveError as exc:
            last_err = exc
            if exc.kind != "timeout" or attempt == attempts - 1:
                break
            logger.warning("resolve_video %s timeout, retrying (%d/%d)...", url, attempt + 1, attempts)
            await asyncio.sleep(settings.ytdlp_retry_sleep_sec)
    if last_err is None:  # pragma: no cover - defensive guard
        raise ResolveError("yt-dlp resolution failed with no attempts", kind="exit")
    raise last_err
