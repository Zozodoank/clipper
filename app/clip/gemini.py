import asyncio
import base64
import json
import logging
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings
from app.clip.models import SectionPlan, SectionKind

logger = logging.getLogger(__name__)

class GeminiClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=settings.gemini_timeout_sec)
        self.rpm = settings.gemini_rpm
        self._lock = asyncio.Lock()

    async def _wait_pacing(self):
        async with self._lock:
            await asyncio.sleep(60.0 / self.rpm)

    async def _call_generate_content(self, model: str, payload: dict) -> dict:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        params = {}
        if self.settings.gemini_api_key:
            params["key"] = self.settings.gemini_api_key

        retries = self.settings.gemini_max_retries
        for attempt in range(retries):
            await self._wait_pacing()
            try:
                resp = await self.client.post(url, params=params, json=payload)
                if resp.status_code == 429 or resp.status_code >= 500:
                    retry_after = int(resp.headers.get("Retry-After", 2 ** attempt))
                    logger.warning(f"Gemini API returned {resp.status_code}, retrying after {retry_after}s")
                    await asyncio.sleep(retry_after)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPError as e:
                if attempt == retries - 1:
                    logger.error(f"Gemini API failed after {retries} attempts: {e}")
                    raise
                await asyncio.sleep(2 ** attempt)
        return {}

    def _prepare_image_part(self, path: Path) -> dict:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        ext = path.suffix.lower()
        mime = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        return {"inlineData": {"data": data, "mimeType": mime}}

    async def check_metadata_match(self, items: list[dict]) -> list[dict]:
        payload = {
            "contents": [{"parts": [{"text": f"Check these videos: {json.dumps(items)}. Return JSON array with fields 'match' (bool), 'product' (str), 'reason' (str)."}]}],
            "generationConfig": {"responseMimeType": "application/json"}
        }
        res = await self._call_generate_content(self.settings.gemini_model, payload)
        try:
            text = res["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except (KeyError, IndexError, json.JSONDecodeError):
            return [{"match": False, "product": "", "reason": "Failed to parse API response"} for _ in items]

    async def plan_sections(self, product: str, meta: dict, frame_paths: list[Path]) -> list[SectionPlan]:
        parts = [{"text": f"Product: {product}. Plan sections (hook, design, performance, camera, cta). Return JSON array of objects with kind, start, end, confidence."}]
        for fp in frame_paths:
            parts.append(self._prepare_image_part(fp))
        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {"responseMimeType": "application/json"}
        }
        res = await self._call_generate_content(self.settings.gemini_model, payload)
        try:
            text = res["candidates"][0]["content"]["parts"][0]["text"]
            data = json.loads(text)
            return [SectionPlan(**item) for item in data]
        except Exception:
            return []

    async def write_script_and_caption(self, product: str, meta: dict, frame_paths: list[Path], duration: float, sections: list[SectionPlan]) -> dict:
        parts = [{"text": f"Product: {product}. Write script and caption. Duration: {duration}s. Sections: {[s.model_dump() for s in sections]}. Return JSON with 'script' (list of {{section, text}}), 'caption' (str), 'hashtags' (list of str)."}]
        for fp in frame_paths:
            parts.append(self._prepare_image_part(fp))
        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {"responseMimeType": "application/json"}
        }
        res = await self._call_generate_content(self.settings.gemini_model, payload)
        try:
            text = res["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except Exception:
            return {"script": [], "caption": "", "hashtags": []}

    async def synthesize(self, text: str) -> tuple[bytes, Any | None]:
        # Implementation with edge-tts fallback
        # ...
        import edge_tts
        communicate = edge_tts.Communicate(text, self.settings.edge_tts_voice or "id-ID-ArdiNeural")
        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]
        return audio_data, None

    async def generate_smartphone_queries(self) -> list[str]:
        prompt = (
            "Berikan daftar 20 handphone (Brand + Tipe) keluaran terbaru tahun 2025-2026 dengan harga di atas 2 juta Rupiah. "
            "Setiap item harus berformat '[Brand] [Tipe] review'. "
            "PENTING: Jangan berikan daftar rekomendasi seperti '5 rekomendasi', '10 android terbaik'. Setiap query HARUS spesifik 1 merk dan tipe saja. "
            "Kembalikan hanya sebagai JSON array string."
        )
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"}
        }
        try:
            res = await self._call_generate_content(self.settings.gemini_model, payload)
            text = res["candidates"][0]["content"]["parts"][0]["text"]
            data = json.loads(text)
            if isinstance(data, list) and all(isinstance(x, str) for x in data):
                return data
        except Exception as e:
            logger.error(f"Failed to generate random queries: {e}")
        return []
