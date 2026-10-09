import asyncio
import base64
import json
import logging
from pathlib import Path

import httpx
from app.config import Settings

logger = logging.getLogger(__name__)

class VlmUnavailableError(Exception):
    pass

class FrameAnalyzer:
    async def analyze_batch(self, frame_paths: list[Path], mode: str) -> list[dict]:
        raise NotImplementedError()

class OracleAnalyzer(FrameAnalyzer):
    def __init__(self, oracle_url: str, timeout: float):
        self.url = oracle_url.rstrip("/") + "/analyze"
        self.timeout = timeout
        self.client = httpx.AsyncClient(timeout=timeout)

    async def analyze_batch(self, frame_paths: list[Path], mode: str) -> list[dict]:
        # Encode frames to base64 to send to Oracle
        frames_b64 = []
        for p in frame_paths:
            with open(p, "rb") as f:
                frames_b64.append(base64.b64encode(f.read()).decode("utf-8"))
        
        payload = {"frames": frames_b64, "mode": mode}
        try:
            resp = await self.client.post(self.url, json=payload)
            resp.raise_for_status()
            return resp.json().get("results", [])
        except Exception as e:
            logger.error(f"OracleAnalyzer error: {e}")
            # Fallback to dirty if error
            return [{"clean": False} for _ in frame_paths]

class TransformersAnalyzer(FrameAnalyzer):
    def __init__(self):
        self._model = None
        self._processor = None
        self._lock = asyncio.Lock()

    def _load(self):
        if self._model is not None:
            return
        import torch
        from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
        logger.info("Loading Qwen2.5-VL-3B-Instruct model...")
        model_id = "Qwen/Qwen2.5-VL-3B-Instruct"
        self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            model_id, torch_dtype=torch.float16, device_map="auto"
        )
        self._processor = AutoProcessor.from_pretrained(model_id)

    def _analyze_sync(self, frame_paths: list[Path], mode: str) -> list[dict]:
        self._load()
        from PIL import Image
        from qwen_vl_utils import process_vision_info
        import json

        results = []
        system_prompt = "You are a strict video frame validator. Output ONLY a valid JSON object without markdown fences. Exact boolean keys: 'clean', 'faces', 'text', 'logo', 'animation', 'overlay'."
        
        user_prompt = "Analyze this frame. Is it clean?"
        if mode == "camera":
            user_prompt = "Analyze this smartphone camera review frame. NOT clean if human face, text, logo, animation, or overlay. CLEAN if only camera interface or subject without people. Is it clean?"

        for p in frame_paths:
            try:
                image = Image.open(p).convert("RGB")
                messages = [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [{"type": "image", "image": image}, {"type": "text", "text": user_prompt}],
                    }
                ]
                text = self._processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                image_inputs, video_inputs = process_vision_info(messages)
                inputs = self._processor(
                    text=[text], images=image_inputs, videos=video_inputs, padding=True, return_tensors="pt"
                ).to(self._model.device)
                
                generated_ids = self._model.generate(**inputs, max_new_tokens=100)
                generated_ids_trimmed = [out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)]
                out_text = self._processor.batch_decode(generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0].strip()
                
                if out_text.startswith("```json"): out_text = out_text[7:]
                if out_text.endswith("```"): out_text = out_text[:-3]
                
                res = json.loads(out_text.strip())
                if "clean" not in res:
                    res["clean"] = not (res.get("faces") or res.get("text") or res.get("logo") or res.get("animation") or res.get("overlay"))
                results.append(res)
            except Exception as e:
                logger.error(f"TransformersAnalyzer error on {p.name}: {e}")
                results.append({"clean": False})
        return results

    async def analyze_batch(self, frame_paths: list[Path], mode: str) -> list[dict]:
        async with self._lock:
            return await asyncio.to_thread(self._analyze_sync, frame_paths, mode)

class MockAnalyzer(FrameAnalyzer):
    async def analyze_batch(self, frame_paths: list[Path], mode: str) -> list[dict]:
        return [{"clean": True, "faces": False, "text": False, "logo": False, "animation": False, "overlay": False} for _ in frame_paths]

def get_analyzer(settings: Settings) -> FrameAnalyzer:
    provider = settings.vlm_provider

    if provider == "oracle":
        if not settings.vlm_oracle_url:
            raise VlmUnavailableError("Oracle URL not set in vlm_oracle_url")
        logger.info("Using OracleAnalyzer at %s", settings.vlm_oracle_url)
        return OracleAnalyzer(settings.vlm_oracle_url, settings.vlm_timeout_sec or 240.0)

    if provider in ("transformers", "auto"):
        try:
            import torch
            if torch.cuda.is_available():
                return TransformersAnalyzer()
        except ImportError:
            pass
        if provider == "transformers":
            logger.warning("transformers provider requested but torch/CUDA unavailable, falling back to mock.")
            return MockAnalyzer()

    if provider == "mock":
        return MockAnalyzer()

    if settings.vlm_oracle_url:  # auto mode without GPU: use remote oracle if configured
        logger.info("Using OracleAnalyzer at %s (fallback)", settings.vlm_oracle_url)
        return OracleAnalyzer(settings.vlm_oracle_url, settings.vlm_timeout_sec or 240.0)

    logger.warning("Provider %s not fully implemented or available, falling back to mock.", provider)
    return MockAnalyzer()
