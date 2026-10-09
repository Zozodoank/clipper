"""Shared abstractions for search engines."""
from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from urllib.parse import unquote

import httpx

_YT_WATCH = re.compile(r"youtube\.com/watch\?v=([\w-]{11})")
_YT_SHORT = re.compile(r"youtu\.be/([\w-]{11})")


class EngineBlockedError(Exception):
    """Engine unreachable or blocked (TLS interception, block page, 403/429)."""


@dataclass
class SearchResult:
    """A normalized YouTube video hit."""

    url: str
    title: str = ""

    @property
    def youtube_id(self) -> str:
        match = _YT_WATCH.search(self.url)
        if match:
            return match.group(1)
        match = _YT_SHORT.search(self.url)
        return match.group(1) if match else ""


def extract_youtube_ids(text: str) -> list[str]:
    """Return deduped YouTube video IDs found in text (handles percent-encoding)."""
    decoded = unquote(text)
    ids: list[str] = []
    seen: set[str] = set()
    for regex in (_YT_WATCH, _YT_SHORT):
        for match in regex.finditer(decoded):
            video_id = match.group(1)
            if video_id not in seen:
                seen.add(video_id)
                ids.append(video_id)
    return ids


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


class SearchEngine(ABC):
    """Contract every search engine implements."""

    name: str = "base"

    def build_query(self, term: str) -> str:
        """Wrap the raw brand+type term with the YouTube site filter.

        Engines that already search YouTube natively (rapidapi, ytsearch)
        override this to return the term unchanged.
        """
        return f"site:youtube.com {term}"

    @abstractmethod
    async def search(self, query: str, client: httpx.AsyncClient) -> list[SearchResult]:
        """Search for the raw query term and return normalized YouTube results."""

    @abstractmethod
    async def health_check(self, client: httpx.AsyncClient) -> bool:
        """Cheap reachability probe."""
