"""Application configuration loaded from environment / .env file."""
from __future__ import annotations

import json
import os
import shutil
import sys
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
CONFIG_DIR = BASE_DIR / "config"


class Settings(BaseSettings):
    """Runtime settings; values come from .env, overridable by real env vars."""

    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    port: int = 5000
    daily_video_limit: int = 20
    proxy_url: str | None = None

    rapidapi_key: str | None = None
    rapidapi_host: str = "yt-api.p.rapidapi.com"
    ytsearch_max_results: int = 8

    disable_cookies: bool = True
    candidate_delay_sec: float = 3.0

    ffprobe_path: str | None = None
    ytdlp_path: str | None = None
    ytdlp_proxy: str | None = None  # Add support for SOCKS5/HTTP proxies

    search_timeout_sec: float = 15.0
    probe_timeout_sec: float = 20.0
    ytdlp_timeout_sec: float = 60.0
    ytdlp_retries: int = 3
    ytdlp_max_retries: int = 2
    ytdlp_retry_sleep_sec: float = 5.0
    engine_cooldown_sec: float = 300.0
    search_delay_sec: float = 1.5
    min_results_per_query: int = 5
    probe_concurrency: int = 2
    query_concurrency: int = 2
    clip_max_consecutive_errors: int = 3

    db_path: Path = DATA_DIR / "clipper.db"
    queries_path: Path = CONFIG_DIR / "queries.json"

    # Gemini Settings
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_sec: float = 180.0
    gemini_max_retries: int = 3
    gemini_rpm: float = 8.0
    section_discovery_fps: float = 0.2
    voiceover_frame_fps: float = 1 / 3
    qwen_check_fps: float = 1.0
    analysis_size: str = "360x640"

    # TTS Settings
    tts_provider: str = "gemini_tts"
    gemini_tts_model: str | None = None
    gemini_tts_fallback_model: str | None = None
    gemini_tts_voice: str = "Despina"
    edge_tts_voice: str | None = None

    # VLM Settings
    vlm_provider: str = "auto"
    vlm_model_id: str = "Qwen/Qwen2.5-VL-3B-Instruct"
    vlm_batch_size: int = 8
    vlm_timeout_sec: float | None = Field(
        default=None,
        validation_alias=AliasChoices("VLM_TIMEOUT_SEC", "VLM_ORACLE_TIMEOUT_SEC"),
    )
    vlm_oracle_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("VLM_ORACLE_URL", "NGROK_URL"),
    )
    ollama_url: str = "http://localhost:11434"

    # Pipeline Settings
    min_total_clean_sec: float = 45.0
    min_clean_frame_ratio: float = 0.7
    min_subwindow_sec: float = 5.0
    max_video_attempts: int = 4
    clip_concurrency: int = 1
    max_source_duration_sec: float = 900.0
    output_dir: Path = DATA_DIR / "output"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_queries(path: Path | None = None) -> list[str]:
    """Load the brand+type query list from config/queries.json."""
    p = path or get_settings().queries_path
    if not p.is_file():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("queries", [])
    else:
        items = []
    return [str(q).strip() for q in items if str(q).strip()]


def find_ffprobe() -> str | None:
    """Locate the ffprobe binary: explicit config, PATH, winget dir, static-ffmpeg."""
    settings = get_settings()
    if settings.ffprobe_path and Path(settings.ffprobe_path).is_file():
        return settings.ffprobe_path
    exe = shutil.which("ffprobe")
    if exe:
        return exe
    # winget Gyan.FFmpeg install location (PATH may be stale in old shells)
    local_appdata = Path(os.environ.get("LOCALAPPDATA", ""))
    if local_appdata.is_dir():
        for candidate in local_appdata.glob(
            "Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin/ffprobe.exe"
        ):
            return str(candidate)
    # static-ffmpeg fallback (bundles ffmpeg + ffprobe)
    try:
        import static_ffmpeg  # noqa: PLC0415

        static_ffmpeg.add_paths()
        exe = shutil.which("ffprobe")
        if exe:
            return exe
    except Exception:  # pragma: no cover - optional dependency
        pass
    return None


def find_ffmpeg() -> str | None:
    """Locate the ffmpeg binary: explicit config, PATH, winget dir, static-ffmpeg."""
    settings = get_settings()
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    # winget Gyan.FFmpeg install location
    local_appdata = Path(os.environ.get("LOCALAPPDATA", ""))
    if local_appdata.is_dir():
        for candidate in local_appdata.glob(
            "Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin/ffmpeg.exe"
        ):
            return str(candidate)
    # static-ffmpeg fallback
    try:
        import static_ffmpeg  # noqa: PLC0415

        static_ffmpeg.add_paths()
        exe = shutil.which("ffmpeg")
        if exe:
            return exe
    except Exception:  # pragma: no cover - optional dependency
        pass
    return None


def find_ytdlp() -> list[str]:
    """Return the yt-dlp command prefix (explicit path > PATH > python -m)."""
    settings = get_settings()
    if settings.ytdlp_path:
        return [settings.ytdlp_path]
    exe = shutil.which("yt-dlp")
    if exe:
        return [exe]
    return [sys.executable, "-m", "yt_dlp"]
