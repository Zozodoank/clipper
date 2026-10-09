"""Background job runner: in-memory registry + database persistence."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from app.db import Database
from app.models import JobStatus, SearchJob
from app.pipeline import Pipeline

logger = logging.getLogger("clipper.jobs")


class JobRunner:
    """Starts pipeline runs in the background; only one run at a time."""

    def __init__(self, db: Database, pipeline: Pipeline):
        self.db = db
        self.pipeline = pipeline
        self.jobs: dict[str, SearchJob] = {}
        self._lock = asyncio.Lock()

    def create_job(self, queries: list[str]) -> SearchJob:
        job = SearchJob(
            id=uuid.uuid4().hex[:12],
            queries=queries,
            total_queries=len(queries),
        )
        self.jobs[job.id] = job
        return job

    def is_running(self) -> bool:
        return any(j.status == JobStatus.RUNNING for j in self.jobs.values())

    def get(self, job_id: str) -> SearchJob | None:
        return self.jobs.get(job_id)

    async def start(self, job: SearchJob) -> None:
        async with self._lock:
            if any(j.status == JobStatus.RUNNING for j in self.jobs.values()):
                raise RuntimeError("a pipeline run is already in progress")
            job.status = JobStatus.RUNNING
            job.started_at = datetime.now(UTC)
            await self.db.save_job(job)
        try:
            summary = await self.pipeline.run_all(job.queries)
            job.status = JobStatus.DONE
            job.total_found = summary["total_found"]
            job.passed = summary["passed"]
            job.failed = summary["failed"]
            job.processed_queries = summary["processed_queries"]
        except Exception as exc:  # noqa: BLE001 - surfaced via job.status
            logger.exception("job %s failed", job.id)
            job.status = JobStatus.ERROR
            job.error = str(exc)
        finally:
            job.finished_at = datetime.now(UTC)
            await self.db.save_job(job)
