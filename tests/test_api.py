"""API tests with database/search/pipeline swapped for fakes (offline)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import Database
from app.models import JobStatus, SearchJob


class FakeSearchManager:
    async def close(self):
        pass

    def get_health(self):
        return [{"name": "fake", "healthy": True, "cooldown_sec": 0, "failures": 0}]

    async def search_all(self, query):
        return [], "fake"


class FakePipeline:
    async def recheck(self, youtube_id: str) -> dict:
        if youtube_id == "missing00001":
            raise KeyError(youtube_id)
        return {"youtube_id": youtube_id, "status": "passed", "recheck": "ok"}


class FakeRunner:
    def __init__(self):
        self.jobs: dict[str, SearchJob] = {}

    def is_running(self) -> bool:
        return any(j.status == JobStatus.RUNNING for j in self.jobs.values())

    def create_job(self, queries: list[str]) -> SearchJob:
        job = SearchJob(id="job000000001", queries=queries, total_queries=len(queries))
        self.jobs[job.id] = job
        return job

    async def start(self, job: SearchJob) -> None:
        job.status = JobStatus.DONE

    def get(self, job_id: str) -> SearchJob | None:
        return self.jobs.get(job_id)


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "db", Database(tmp_path / "api.db"))
    monkeypatch.setattr(main, "search", FakeSearchManager())
    monkeypatch.setattr(main, "pipeline", FakePipeline())
    monkeypatch.setattr(main, "runner", FakeRunner())
    with TestClient(main.app) as test_client:
        yield test_client


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["engines"][0]["name"] == "fake"
    assert body["daily_limit"] == 20


def test_queries_endpoint(client):
    resp = client.get("/queries")
    assert resp.status_code == 200
    assert isinstance(resp.json()["queries"], list)


def test_search_returns_202_and_job(client):
    resp = client.post("/search", json={})
    assert resp.status_code == 202
    body = resp.json()
    assert body["job_id"]
    assert body["queries"]


def test_search_rejects_empty_queries(client, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "load_queries", lambda: [])
    resp = client.post("/search", json={})
    assert resp.status_code == 400


def test_job_status(client):
    client.post("/search", json={"queries": ["Samsung Galaxy S24"]})
    resp = client.get("/jobs/job000000001")
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"


def test_job_not_found(client):
    resp = client.get("/jobs/doesnotexist")
    assert resp.status_code == 404


def test_videos_empty(client):
    resp = client.get("/videos")
    assert resp.status_code == 200
    body = resp.json()
    assert body["videos"] == []
    assert body["total"] == 0


def test_videos_rejects_bad_status(client):
    resp = client.get("/videos", params={"status": "bogus"})
    assert resp.status_code == 422


def test_recheck_ok(client):
    resp = client.post("/videos/vid00000001/recheck")
    assert resp.status_code == 200
    assert resp.json()["recheck"] == "ok"


def test_recheck_not_found(client):
    resp = client.post("/videos/missing00001/recheck")
    assert resp.status_code == 404


def test_stats(client):
    resp = client.get("/stats")
    assert resp.status_code == 200
    body = resp.json()
    assert body["daily_limit"] == 20
    assert body["daily_used"] == 0
    assert body["videos"]["passed"] == 0


def test_second_search_while_running_returns_409(client, monkeypatch):
    from app import main

    running_runner = FakeRunner()
    job = running_runner.create_job(["q"])
    job.status = JobStatus.RUNNING
    monkeypatch.setattr(main, "runner", running_runner)

    resp = client.post("/search", json={})
    assert resp.status_code == 409
