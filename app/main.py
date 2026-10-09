"""FastAPI application for the Clipper Stage-1 backend.

Run: uvicorn app.main:app --port 5000
"""
from __future__ import annotations

import asyncio
import logging
import re
import os
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import find_ffprobe, find_ytdlp, get_settings, load_queries
from app.db import Database
from app.jobs import JobRunner
from app.models import SearchRequest
from app.pipeline import Pipeline
from app.search.duckduckgo import DuckDuckGoEngine
from app.search.manager import SearchManager
from app.search.mojeek import MojeekEngine
from app.search.rapidapi import RapidApiEngine
from app.search.searxng import SearxngEngine
from app.search.ytsearch import YtSearchEngine

from app.clip.pipeline import ClipPipeline
from app.clip.jobs import ClipJobRunner

logger = logging.getLogger("clipper")

settings = get_settings()
db = Database(settings.db_path)
search = SearchManager(
    engines=[
        DuckDuckGoEngine(),
        RapidApiEngine(api_key=settings.rapidapi_key, host=settings.rapidapi_host),
        MojeekEngine(),
        SearxngEngine(),
        YtSearchEngine(settings=settings, max_results=settings.ytsearch_max_results),
    ],
    cooldown_sec=settings.engine_cooldown_sec,
    delay_sec=settings.search_delay_sec,
    min_results=settings.min_results_per_query,
    timeout_sec=settings.search_timeout_sec,
)
pipeline = Pipeline(settings, db, search)
runner = JobRunner(db, pipeline)

clip_pipeline = ClipPipeline(settings, db)
clip_runner = ClipJobRunner(db, clip_pipeline, phase1_pipeline=pipeline)

_background_tasks: set[asyncio.Task] = set()


def _setup_logging() -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    try:
        settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(
            logging.FileHandler(settings.db_path.parent / "app.log", encoding="utf-8")
        )
    except OSError:  # pragma: no cover - disk issues must not block startup
        pass
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _setup_logging()
    await db.init_db()
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    logger.info("clipper stage-1 starting on port %s", settings.port)
    yield
    for task in _background_tasks:
        task.cancel()
    if clip_runner._current_task:
        clip_runner._current_task.cancel()
    await search.close()


app = FastAPI(title="Clipper Stage-1 Backend", version="0.1.0", lifespan=lifespan)
Path(settings.output_dir).mkdir(parents=True, exist_ok=True)
app.mount("/output", StaticFiles(directory=settings.output_dir), name="output")


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/health")
async def health() -> dict:
    from app.config import find_ffmpeg
    return {
        "status": "ok",
        "engines": search.get_health(),
        "ffprobe": find_ffprobe() or "missing",
        "ffmpeg": find_ffmpeg() or "missing",
        "ytdlp": find_ytdlp(),
        "gemini": {"configured": bool(settings.gemini_api_key), "model": settings.gemini_model},
        "vlm": {"provider": settings.vlm_provider, "ready": True},
        "tts": {"provider": settings.tts_provider},
        "daily_limit": settings.daily_video_limit,
        "daily_used": await db.get_daily_count(date.today().isoformat()),
    }


@app.get("/queries")
async def list_queries() -> dict:
    return {"queries": load_queries()}


@app.post("/search", status_code=202)
async def trigger_search(request: SearchRequest) -> dict:
    queries = request.queries or load_queries()
    if not queries:
        raise HTTPException(status_code=400, detail="no queries configured")
    if runner.is_running():
        raise HTTPException(status_code=409, detail="a search job is already running")
    job = runner.create_job(queries)
    task = asyncio.create_task(runner.start(job))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return {"job_id": job.id, "status": job.status.value, "queries": queries}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    job = runner.get(job_id)
    if job is None:
        job = await db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job.model_dump()


@app.get("/videos")
async def list_videos(
    status: str | None = Query(default=None, pattern="^(new|passed|failed)$"),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    rows = await db.list_videos(status=status, limit=limit, offset=offset)
    return {
        "videos": rows,
        "count": len(rows),
        "total": await db.count_videos(status),
    }


@app.post("/videos/{youtube_id}/recheck")
async def recheck_video(youtube_id: str) -> dict:
    try:
        return await pipeline.recheck(youtube_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="video not found")


@app.get("/stats")
async def stats() -> dict:
    return {
        "daily_used": await db.get_daily_count(date.today().isoformat()),
        "daily_limit": settings.daily_video_limit,
        "videos": {
            "new": await db.count_videos("new"),
            "passed": await db.count_videos("passed"),
            "failed": await db.count_videos("failed"),
        },
    }

# --- Clip Phase 2 Endpoints ---

@app.get("/")
async def serve_index():
    path = Path(__file__).parent / "static" / "index.html"
    if path.is_file():
        return FileResponse(path)
    return JSONResponse(status_code=404, content={"detail": "Index not found"})

@app.post("/autorun", status_code=202)
async def trigger_autorun(request: Request, background_tasks: BackgroundTasks) -> dict:
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    queries = body.get("queries") or load_queries()
    # Allow empty queries so ClipJobRunner can dynamically generate them via Gemini
    if clip_runner.is_running():
        raise HTTPException(status_code=409, detail="autorun is already running")
    
    task = asyncio.create_task(clip_runner.start(queries))
    clip_runner._current_task = task
    return {"message": "autorun started", "queries": queries}

@app.post("/autorun/stop")
async def stop_autorun():
    if not clip_runner.is_running():
        raise HTTPException(status_code=400, detail="autorun is not running")
    clip_runner.cancel()
    return {"message": "autorun stopped successfully"}

@app.post("/system/stop")
async def stop_system(background_tasks: BackgroundTasks):
    """Kills the Kaggle backend process to save GPU quota."""
    def kill_server():
        # A brutal but effective way to force Kaggle notebook cell to stop
        import time
        time.sleep(1)
        os._exit(0)
    
    background_tasks.add_task(kill_server)
    return {"message": "Kaggle session is shutting down. The web UI will become unresponsive."}

@app.get("/clipjobs")
async def list_clip_jobs(limit: int = 50) -> list[dict]:
    return await db.list_clip_jobs(limit)

@app.get("/clipjobs/{job_id}")
async def get_clip_job(job_id: str) -> dict:
    job = clip_runner.get(job_id)
    if job:
        return job.model_dump()
    job_db = await db.get_clip_job(job_id)
    if job_db:
        return job_db.model_dump()
    raise HTTPException(status_code=404, detail="clip job not found")

@app.get("/finals")
async def list_finals(limit: int = 50, offset: int = 0) -> list[dict]:
    return await db.list_finals(limit, offset)

@app.get("/finals/{youtube_id}")
async def get_final(youtube_id: str) -> dict:
    final = await db.get_final(youtube_id)
    if not final:
        raise HTTPException(status_code=404, detail="final clip not found")
    return final.model_dump()


@app.post("/youtube/oauth")
async def trigger_youtube_oauth():
    """Triggers yt-dlp oauth flow and extracts the device code URL."""
    exe = find_ytdlp()
    if not exe:
        raise HTTPException(status_code=500, detail="yt-dlp not found")
    
    # Run a dummy yt-dlp command just to trigger the oauth flow
    cmd = exe + ["--username", "oauth2", "--password", "", "--dump-json", "https://www.youtube.com/watch?v=BaW_jenozKc"]
    
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT
    )
    
    code = None
    url = None
    
    # Read output line by line looking for the auth message
    pattern = re.compile(r"go to\s+(https?://[^\s]+)\s+and enter code\s+([A-Z0-9-]+)")
    
    # We will wait up to 15 seconds to find the code in the output
    async def read_stdout():
        nonlocal code, url
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode(errors="ignore")
            logger.info(f"ytdlp oauth: {text.strip()}")
            match = pattern.search(text)
            if match:
                url = match.group(1)
                code = match.group(2)
                return

    try:
        await asyncio.wait_for(read_stdout(), timeout=15.0)
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(status_code=500, detail="Timeout waiting for OAuth code from yt-dlp")
    
    if url and code:
        # We leave the process running in the background so it can finish the oauth flow
        # when the user enters the code on their device.
        _background_tasks.add(asyncio.create_task(proc.wait()))
        return {"url": url, "code": code, "message": "Please enter the code at the URL."}
    else:
        proc.kill()
        raise HTTPException(status_code=500, detail="Could not extract OAuth code from yt-dlp output")

def run() -> None:  # pragma: no cover - convenience entrypoint
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port)


if __name__ == "__main__":
    run()
