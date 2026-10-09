"""Pydantic schemas shared by the API, database and pipeline."""
from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum

from pydantic import BaseModel, Field


class VideoStatus(str, Enum):
    NEW = "new"
    PASSED = "passed"
    FAILED = "failed"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


class VideoCandidate(BaseModel):
    """A YouTube video found by a search engine, optionally verified via ffprobe."""

    youtube_id: str
    url: str
    title: str = ""
    channel: str = ""
    duration: float | None = None
    view_count: int | None = None
    query: str = ""
    engine: str = ""
    status: VideoStatus = VideoStatus.NEW
    width: int | None = None
    height: int | None = None
    codec: str = ""
    fps: float | None = None
    stream_url: str = ""
    error: str = ""
    probe_json: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    probed_at: datetime | None = None


class SearchJob(BaseModel):
    """Status of one background pipeline run."""

    id: str
    queries: list[str] = Field(default_factory=list)
    status: JobStatus = JobStatus.QUEUED
    started_at: datetime | None = None
    finished_at: datetime | None = None
    total_found: int = 0
    passed: int = 0
    failed: int = 0
    processed_queries: int = 0
    total_queries: int = 0
    error: str = ""


class SearchRequest(BaseModel):
    """Body for POST /search; omit queries to use config/queries.json."""

    queries: list[str] | None = None
