"""SQLite persistence for videos, job runs and the daily quota.

Uses the stdlib sqlite3 driver (WAL mode). Public methods are async and
delegate to thread workers so the event loop never blocks on disk I/O.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

from app.models import JobStatus, SearchJob, VideoCandidate
from app.clip.models import ClipJob, ClipStatus, FinalClip

_SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    youtube_id   TEXT PRIMARY KEY,
    url          TEXT NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    channel      TEXT NOT NULL DEFAULT '',
    duration     REAL,
    view_count   INTEGER,
    query        TEXT NOT NULL DEFAULT '',
    engine       TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'new',
    width        INTEGER,
    height       INTEGER,
    codec        TEXT NOT NULL DEFAULT '',
    fps          REAL,
    stream_url   TEXT NOT NULL DEFAULT '',
    error        TEXT NOT NULL DEFAULT '',
    probe_json   TEXT NOT NULL DEFAULT '',
    created_at   TEXT,
    probed_at    TEXT
);

CREATE TABLE IF NOT EXISTS job_runs (
    id                TEXT PRIMARY KEY,
    queries           TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL DEFAULT 'queued',
    started_at        TEXT,
    finished_at       TEXT,
    total_found       INTEGER NOT NULL DEFAULT 0,
    passed            INTEGER NOT NULL DEFAULT 0,
    failed            INTEGER NOT NULL DEFAULT 0,
    processed_queries INTEGER NOT NULL DEFAULT 0,
    total_queries     INTEGER NOT NULL DEFAULT 0,
    error             TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS daily_usage (
    day            TEXT PRIMARY KEY,
    accepted_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clip_jobs (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL DEFAULT '',
    youtube_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'queued',
    step TEXT NOT NULL DEFAULT '',
    progress TEXT NOT NULL DEFAULT '{}',
    sections TEXT NOT NULL DEFAULT '[]',
    clean_sec REAL NOT NULL DEFAULT 0.0,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS finals (
    youtube_id TEXT PRIMARY KEY,
    query TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT '',
    duration REAL NOT NULL DEFAULT 0.0,
    final_path TEXT NOT NULL DEFAULT '',
    subtitle_path TEXT NOT NULL DEFAULT '',
    voiceover_path TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '[]',
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT
);
"""

_VIDEO_COLS = [
    "youtube_id", "url", "title", "channel", "duration", "view_count", "query",
    "engine", "status", "width", "height", "codec", "fps", "stream_url",
    "error", "probe_json", "created_at", "probed_at",
]

_CLIP_JOB_COLS = [
    "id", "query", "youtube_id", "attempt", "status", "step", "progress",
    "sections", "clean_sec", "error", "created_at", "finished_at"
]

_FINAL_COLS = [
    "youtube_id", "query", "title", "channel", "duration", "final_path",
    "subtitle_path", "voiceover_path", "caption", "hashtags", "meta_json",
    "created_at"
]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def _to_row(video: VideoCandidate) -> dict[str, Any]:
    return {
        "youtube_id": video.youtube_id,
        "url": video.url,
        "title": video.title,
        "channel": video.channel,
        "duration": video.duration,
        "view_count": video.view_count,
        "query": video.query,
        "engine": video.engine,
        "status": video.status.value,
        "width": video.width,
        "height": video.height,
        "codec": video.codec,
        "fps": video.fps,
        "stream_url": video.stream_url,
        "error": video.error,
        "probe_json": video.probe_json,
        "created_at": _iso(video.created_at),
        "probed_at": _iso(video.probed_at),
    }


class Database:
    """Async facade over a synchronous SQLite connection."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    # -- sync internals ---------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            with conn:  # commit on success, rollback on error
                yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._db() as conn:
            conn.executescript(_SCHEMA)

    def _get_video(self, youtube_id: str) -> dict | None:
        with self._db() as conn:
            row = conn.execute(
                "SELECT * FROM videos WHERE youtube_id = ?", (youtube_id,)
            ).fetchone()
        return dict(row) if row else None

    def _upsert_video(self, row: dict[str, Any]) -> None:
        cols = ", ".join(_VIDEO_COLS)
        placeholders = ", ".join("?" for _ in _VIDEO_COLS)
        updates = ", ".join(f"{c} = excluded.{c}" for c in _VIDEO_COLS[1:])
        with self._db() as conn:
            conn.execute(
                f"INSERT INTO videos ({cols}) VALUES ({placeholders}) "
                f"ON CONFLICT(youtube_id) DO UPDATE SET {updates}",
                [row[c] for c in _VIDEO_COLS],
            )

    def _list_videos(self, status: str | None, limit: int, offset: int) -> list[dict]:
        sql = "SELECT * FROM videos"
        args: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            args.append(status)
        sql += " ORDER BY COALESCE(probed_at, created_at) DESC LIMIT ? OFFSET ?"
        args += [limit, offset]
        with self._db() as conn:
            rows = conn.execute(sql, args).fetchall()
        return [dict(r) for r in rows]

    def _count_videos(self, status: str | None = None) -> int:
        sql = "SELECT COUNT(*) FROM videos"
        args: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            args.append(status)
        with self._db() as conn:
            return conn.execute(sql, args).fetchone()[0]

    def _get_daily_count(self, day: str) -> int:
        with self._db() as conn:
            row = conn.execute(
                "SELECT accepted_count FROM daily_usage WHERE day = ?", (day,)
            ).fetchone()
        return row[0] if row else 0

    def _try_increment_daily(self, day: str, limit: int) -> bool:
        """Atomically increment the daily counter; False when the quota is full."""
        with self._db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO daily_usage (day, accepted_count) VALUES (?, 0)",
                (day,),
            )
            cur = conn.execute(
                "UPDATE daily_usage SET accepted_count = accepted_count + 1 "
                "WHERE day = ? AND accepted_count < ?",
                (day, limit),
            )
        return cur.rowcount > 0

    def _save_job(self, job: SearchJob) -> None:
        with self._db() as conn:
            conn.execute(
                """INSERT INTO job_runs (id, queries, status, started_at, finished_at,
                       total_found, passed, failed, processed_queries, total_queries, error)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     status = excluded.status,
                     started_at = excluded.started_at,
                     finished_at = excluded.finished_at,
                     total_found = excluded.total_found,
                     passed = excluded.passed,
                     failed = excluded.failed,
                     processed_queries = excluded.processed_queries,
                     total_queries = excluded.total_queries,
                     error = excluded.error""",
                (
                    job.id,
                    json.dumps(job.queries),
                    job.status.value,
                    _iso(job.started_at),
                    _iso(job.finished_at),
                    job.total_found,
                    job.passed,
                    job.failed,
                    job.processed_queries,
                    job.total_queries,
                    job.error,
                ),
            )

    def _get_job(self, job_id: str) -> SearchJob | None:
        with self._db() as conn:
            row = conn.execute(
                "SELECT * FROM job_runs WHERE id = ?", (job_id,)
            ).fetchone()
        if not row:
            return None
        r = dict(row)

        def _dt(value: str | None) -> datetime | None:
            return datetime.fromisoformat(value) if value else None

        return SearchJob(
            id=r["id"],
            queries=json.loads(r["queries"] or "[]"),
            status=JobStatus(r["status"]),
            started_at=_dt(r["started_at"]),
            finished_at=_dt(r["finished_at"]),
            total_found=r["total_found"],
            passed=r["passed"],
            failed=r["failed"],
            processed_queries=r["processed_queries"],
            total_queries=r["total_queries"],
            error=r["error"],
        )

    def _save_clip_job(self, job: ClipJob) -> None:
        cols = ", ".join(_CLIP_JOB_COLS)
        placeholders = ", ".join("?" for _ in _CLIP_JOB_COLS)
        updates = ", ".join(f"{c} = excluded.{c}" for c in _CLIP_JOB_COLS[1:])
        with self._db() as conn:
            conn.execute(
                f"INSERT INTO clip_jobs ({cols}) VALUES ({placeholders}) "
                f"ON CONFLICT(id) DO UPDATE SET {updates}",
                (
                    job.id,
                    job.query,
                    job.youtube_id,
                    job.attempt,
                    job.status.value,
                    job.step,
                    json.dumps(job.progress),
                    json.dumps([s.model_dump() for s in job.sections]),
                    job.clean_sec,
                    job.error,
                    _iso(job.created_at),
                    _iso(job.finished_at),
                ),
            )

    def _get_clip_job(self, job_id: str) -> ClipJob | None:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM clip_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        r = dict(row)
        def _dt(value: str | None) -> datetime | None:
            return datetime.fromisoformat(value) if value else None
        return ClipJob(
            id=r["id"],
            query=r["query"],
            youtube_id=r["youtube_id"],
            attempt=r["attempt"],
            status=ClipStatus(r["status"]),
            step=r["step"],
            progress=json.loads(r["progress"] or "{}"),
            sections=json.loads(r["sections"] or "[]"),
            clean_sec=r["clean_sec"],
            error=r["error"],
            created_at=_dt(r["created_at"]),
            finished_at=_dt(r["finished_at"]),
        )

    def _list_clip_jobs(self, limit: int = 50) -> list[dict]:
        with self._db() as conn:
            rows = conn.execute("SELECT * FROM clip_jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        def parse(r: dict) -> dict:
            r["progress"] = json.loads(r["progress"])
            r["sections"] = json.loads(r["sections"])
            return r
        return [parse(dict(r)) for r in rows]

    def _upsert_final(self, final: FinalClip) -> None:
        cols = ", ".join(_FINAL_COLS)
        placeholders = ", ".join("?" for _ in _FINAL_COLS)
        updates = ", ".join(f"{c} = excluded.{c}" for c in _FINAL_COLS[1:])
        with self._db() as conn:
            conn.execute(
                f"INSERT INTO finals ({cols}) VALUES ({placeholders}) "
                f"ON CONFLICT(youtube_id) DO UPDATE SET {updates}",
                (
                    final.youtube_id,
                    final.query,
                    final.title,
                    final.channel,
                    final.duration,
                    final.final_path,
                    final.subtitle_path,
                    final.voiceover_path,
                    final.caption,
                    json.dumps(final.hashtags),
                    json.dumps(final.meta_json),
                    _iso(final.created_at),
                ),
            )

    def _get_final(self, youtube_id: str) -> FinalClip | None:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM finals WHERE youtube_id = ?", (youtube_id,)).fetchone()
        if not row:
            return None
        r = dict(row)
        def _dt(value: str | None) -> datetime | None:
            return datetime.fromisoformat(value) if value else None
        return FinalClip(
            youtube_id=r["youtube_id"],
            query=r["query"],
            title=r["title"],
            channel=r["channel"],
            duration=r["duration"],
            final_path=r["final_path"],
            subtitle_path=r["subtitle_path"],
            voiceover_path=r["voiceover_path"],
            caption=r["caption"],
            hashtags=json.loads(r["hashtags"] or "[]"),
            meta_json=json.loads(r["meta_json"] or "{}"),
            created_at=_dt(r["created_at"]),
        )

    def _list_finals(self, limit: int = 50, offset: int = 0) -> list[dict]:
        with self._db() as conn:
            rows = conn.execute("SELECT * FROM finals ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        def parse(r: dict) -> dict:
            r["hashtags"] = json.loads(r["hashtags"])
            r["meta_json"] = json.loads(r["meta_json"])
            return r
        return [parse(dict(r)) for r in rows]

    def _count_finals(self) -> int:
        with self._db() as conn:
            return conn.execute("SELECT COUNT(*) FROM finals").fetchone()[0]

    # -- async facade ------------------------------------------------------

    async def init_db(self) -> None:
        await asyncio.to_thread(self._init_db)

    async def get_video(self, youtube_id: str) -> dict | None:
        return await asyncio.to_thread(self._get_video, youtube_id)

    async def upsert_video(self, video: VideoCandidate) -> None:
        await asyncio.to_thread(self._upsert_video, _to_row(video))

    async def list_videos(
        self, status: str | None = None, limit: int = 20, offset: int = 0
    ) -> list[dict]:
        return await asyncio.to_thread(self._list_videos, status, limit, offset)

    async def count_videos(self, status: str | None = None) -> int:
        return await asyncio.to_thread(self._count_videos, status)

    async def get_daily_count(self, day: str) -> int:
        return await asyncio.to_thread(self._get_daily_count, day)

    async def try_increment_daily(self, day: str, limit: int) -> bool:
        return await asyncio.to_thread(self._try_increment_daily, day, limit)

    async def save_job(self, job: SearchJob) -> None:
        await asyncio.to_thread(self._save_job, job)

    async def get_job(self, job_id: str) -> SearchJob | None:
        return await asyncio.to_thread(self._get_job, job_id)

    async def save_clip_job(self, job: ClipJob) -> None:
        await asyncio.to_thread(self._save_clip_job, job)

    async def get_clip_job(self, job_id: str) -> ClipJob | None:
        return await asyncio.to_thread(self._get_clip_job, job_id)

    async def list_clip_jobs(self, limit: int = 50) -> list[dict]:
        return await asyncio.to_thread(self._list_clip_jobs, limit)

    async def upsert_final(self, final: FinalClip) -> None:
        await asyncio.to_thread(self._upsert_final, final)

    async def get_final(self, youtube_id: str) -> FinalClip | None:
        return await asyncio.to_thread(self._get_final, youtube_id)

    async def list_finals(self, limit: int = 50, offset: int = 0) -> list[dict]:
        return await asyncio.to_thread(self._list_finals, limit, offset)

    async def count_finals(self) -> int:
        return await asyncio.to_thread(self._count_finals)
