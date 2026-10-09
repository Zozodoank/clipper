import asyncio
import pytest
from unittest.mock import AsyncMock
from app.clip.jobs import ClipJobRunner
from app.config import Settings
from app.db import Database
from app.clip.pipeline import ClipPipeline, ClipStatus

@pytest.mark.asyncio
async def test_clip_job_runner_circuit_breaker(monkeypatch):
    settings = Settings(clip_max_consecutive_errors=3)
    monkeypatch.setattr("app.clip.jobs.get_settings", lambda: settings)
    
    db = AsyncMock(spec=Database)
    db.save_clip_job = AsyncMock()
    
    # Mock pipeline that always throws an error
    pipeline = AsyncMock(spec=ClipPipeline)
    pipeline.process_product.side_effect = Exception("Mock pipeline error")
    
    runner = ClipJobRunner(db, pipeline, None)
    
    # Normally this would loop infinitely because it uses itertools.cycle
    # But because of the circuit breaker, it should break after 3 failures
    await runner.start(["query 1", "query 2"])
    
    # process_product should have been called exactly 3 times (the circuit breaker limit)
    assert pipeline.process_product.call_count == 3
