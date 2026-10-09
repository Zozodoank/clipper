from enum import Enum
from typing import Any
from datetime import datetime
from pydantic import BaseModel

class SectionKind(str, Enum):
    hook = "hook"
    design = "design"
    performance = "performance"
    camera = "camera"
    cta = "cta"

class ClipStatus(str, Enum):
    queued = "queued"
    checking = "checking"
    planning = "planning"
    downloading = "downloading"
    validating = "validating"
    rendering = "rendering"
    voicing = "voicing"
    done = "done"
    error = "error"

class SectionPlan(BaseModel):
    kind: SectionKind
    start: float
    end: float
    confidence: float

class FrameVerdict(BaseModel):
    clean: bool
    faces: bool
    text: bool
    logo: bool
    animation: bool
    overlay: bool

class ClipJob(BaseModel):
    id: str
    query: str
    youtube_id: str | None = None
    attempt: int = 1
    status: ClipStatus = ClipStatus.queued
    step: str = ""
    progress: dict[str, Any] = {}
    sections: list[SectionPlan] = []
    clean_sec: float = 0.0
    error: str = ""
    created_at: datetime | None = None
    finished_at: datetime | None = None

class FinalClip(BaseModel):
    youtube_id: str
    query: str
    title: str
    channel: str
    duration: float
    final_path: str
    subtitle_path: str
    voiceover_path: str
    caption: str
    hashtags: list[str]
    meta_json: dict[str, Any] = {}
    created_at: datetime | None = None
