import asyncio
import itertools
import logging
from datetime import datetime
from uuid import uuid4

from app.config import get_settings
from app.clip.models import ClipJob, ClipStatus
from app.db import Database

logger = logging.getLogger(__name__)

class ClipJobRunner:
    def __init__(self, db: Database, pipeline: "ClipPipeline", phase1_pipeline: "Pipeline" = None):
        self.db = db
        self.pipeline = pipeline
        self.phase1_pipeline = phase1_pipeline
        self._current_task: asyncio.Task | None = None
        self._active_jobs: dict[str, ClipJob] = {}

    def is_running(self) -> bool:
        return self._current_task is not None and not self._current_task.done()

    def cancel(self) -> None:
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()

    def create_job(self, query: str) -> ClipJob:
        job = ClipJob(
            id=uuid4().hex,
            query=query,
            status=ClipStatus.queued,
            created_at=datetime.utcnow()
        )
        self._active_jobs[job.id] = job
        return job

    def get(self, job_id: str) -> ClipJob | None:
        return self._active_jobs.get(job_id)

    async def start(self, queries: list[str]) -> None:
        if not queries:
            queries = await self.pipeline.gemini.generate_smartphone_queries()
            if not queries:
                # Fallback list if Gemini fails
                queries = [
                    "Samsung Galaxy S24 Ultra review",
                    "iPhone 15 Pro Max review",
                    "Xiaomi 14 Pro review",
                    "Poco X6 Pro review",
                    "Vivo X100 Pro review",
                    "Oppo Find X7 Ultra review",
                    "iQOO 12 review",
                    "Realme GT 5 Pro review"
                ]

        settings = get_settings()
        consecutive_errors = 0

        for query in itertools.cycle(queries):
            if self._current_task and self._current_task.cancelled():
                break

            job = self.create_job(query)
            await self.db.save_clip_job(job)
            try:
                # RUN PHASE 1 FIRST (Search and Resolve)
                if self.phase1_pipeline:
                    job.step = "Searching YouTube for videos"
                    await self.db.save_clip_job(job)
                    await self.phase1_pipeline.run_all([query])

                # RUN PHASE 2 (Clip and Analyze)
                await self.pipeline.process_product(job)
                consecutive_errors = 0  # Reset on success
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception(f"Error processing {query}")
                job.status = ClipStatus.error
                job.error = str(e)
                job.finished_at = datetime.utcnow()
                await self.db.save_clip_job(job)
                
                consecutive_errors += 1
                if consecutive_errors >= settings.clip_max_consecutive_errors:
                    logger.error(f"Stopping autorun after {consecutive_errors} consecutive failures")
                    break
