"""FastAPI server for VLM Oracle running on Kaggle."""
import base64
import io
import json
import logging
from typing import List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="VLM Oracle for Clipper")

# Lazy loading variables
model = None
processor = None

class AnalyzeRequest(BaseModel):
    frames: List[str]  # Base64 encoded images
    mode: str = "strict"

def load_model():
    global model, processor
    if model is None:
        logger.info("Loading Qwen2.5-VL-3B-Instruct model...")
        model_id = "Qwen/Qwen2.5-VL-3B-Instruct"
        try:
            model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                model_id, 
                torch_dtype=torch.float16, 
                device_map="auto"
            )
            processor = AutoProcessor.from_pretrained(model_id)
            logger.info("Model loaded successfully on GPU.")
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise RuntimeError(f"Failed to load VLM: {e}")

@app.on_event("startup")
async def startup_event():
    # Model will be loaded asynchronously or lazy-loaded on first request
    # To save Kaggle startup time, we load it here
    load_model()

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": model is not None}

def analyze_frames_sync(frames_b64: List[str], mode: str) -> List[dict]:
    results = []
    
    system_prompt = (
        "You are a strict video frame validator. Output ONLY a valid JSON object. "
        "Do not include markdown fences like ```json. "
        "The JSON must have these exact boolean keys: 'clean', 'faces', 'text', 'logo', 'animation', 'overlay'."
    )
    
    if mode == "camera":
        user_prompt = (
            "Analyze this frame from a smartphone camera review. "
            "A frame is NOT clean if you see a human face (vlogger), text, logo, animation, or overlay. "
            "It is CLEAN if it only shows the camera interface or what the camera is pointing at (without people). "
            "Is it clean?"
        )
    else:
        user_prompt = (
            "Analyze this frame. "
            "A frame is NOT clean if you see a human face, text, logo, animation, or overlay. "
            "Is it clean?"
        )

    # Process each frame (could be batched for performance, simple loop for now)
    for b64 in frames_b64:
        try:
            img_bytes = base64.b64decode(b64)
            image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            
            messages = [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": image},
                        {"type": "text", "text": user_prompt},
                    ],
                }
            ]
            
            text = processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            image_inputs, video_inputs = process_vision_info(messages)
            inputs = processor(
                text=[text],
                images=image_inputs,
                videos=video_inputs,
                padding=True,
                return_tensors="pt",
            ).to(model.device)
            
            generated_ids = model.generate(**inputs, max_new_tokens=100)
            generated_ids_trimmed = [
                out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
            ]
            output_text = processor.batch_decode(
                generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
            )[0].strip()
            
            # Clean up markdown if any
            if output_text.startswith("```json"):
                output_text = output_text[7:]
            if output_text.endswith("```"):
                output_text = output_text[:-3]
                
            try:
                res = json.loads(output_text.strip())
                # Default logic if model didn't set 'clean' properly
                if "clean" not in res:
                    res["clean"] = not (res.get("faces") or res.get("text") or res.get("logo") or res.get("animation") or res.get("overlay"))
                results.append(res)
            except json.JSONDecodeError:
                logger.error(f"JSON decode failed on output: {output_text}")
                results.append({"clean": False, "error": "parse_failed"})
                
        except Exception as e:
            logger.error(f"Error processing frame: {e}")
            results.append({"clean": False, "error": str(e)})
            
    return results

# Helper for qwen processor
from qwen_vl_utils import process_vision_info

@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    if not model:
        load_model()
    
    # Run heavy computation in thread pool
    import asyncio
    try:
        results = await asyncio.to_thread(analyze_frames_sync, req.frames, req.mode)
        return {"results": results}
    except Exception as e:
        logger.exception("Analyze failed")
        raise HTTPException(status_code=500, detail=str(e))

def start_ngrok():
    import os
    from pyngrok import ngrok
    
    # Try kaggle secrets first, then environment
    auth_token = os.environ.get("NGROK_AUTH_TOKEN")
    if not auth_token:
        try:
            from kaggle_secrets import UserSecretsClient
            auth_token = UserSecretsClient().get_secret("NGROK_AUTH_TOKEN")
        except Exception:
            pass
            
    if auth_token:
        ngrok.set_auth_token(auth_token)
        public_url = ngrok.connect(8000).public_url
        logger.info(f"ngrok connected: {public_url}")
        
        # Write to file so the launcher script can pull it via `kaggle kernels output`
        os.makedirs("/kaggle/working", exist_ok=True)
        with open("/kaggle/working/oracle_url.txt", "w") as f:
            f.write(public_url)
    else:
        logger.warning("No NGROK_AUTH_TOKEN found in env or Kaggle Secrets.")

if __name__ == "__main__":
    import uvicorn
    import threading
    threading.Thread(target=start_ngrok, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)
