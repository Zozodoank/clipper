#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[*] Memperbarui auto_broll_agent.py (Cache Video Bersih + Anti-Stuck + Fix Audio VO)..."

cat << 'PYEOF' > ~/broll-agent/auto_broll_agent.py
import os
import re
import sys
import cv2
import json
import time
import wave
import base64
import shutil
import argparse
import subprocess
import numpy as np
import requests
from tqdm import tqdm

# HANYA Model Gemini 3.1 Flash ke atas (Tanpa 2.5 sama sekali)
TTS_MODELS = [
    "gemini-3.8-flash-tts",
    "gemini-3.7-flash-tts",
    "gemini-3.1-flash-tts",
    "gemini-3.8-flash-preview-tts",
    "gemini-3.7-flash-preview-tts",
    "gemini-3.1-flash-preview-tts"
]

VISION_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.1-flash",
    "gemini-3.8-flash-preview",
    "gemini-3.7-flash-preview",
    "gemini-3.1-flash-preview",
    "gemini-3.1-flash-lite"
]

# Menyimpan daftar model yang habis kuota harian (429) atau 404 agar tidak dipakai berulang
EXHAUSTED_TTS_MODELS = set()
EXHAUSTED_VISION_MODELS = set()

FEATURE_KEYWORDS = [
    "kamera", "layar", "baterai", "chipset", "performa", "desain", "bodi",
    "gaming", "speaker", "charging", "cas", "ram", "storage", "memori",
    "antutu", "fps", "suhu", "panas", "fitur", "spesifikasi", "amoled",
    "ips", "refresh rate", "hz", "megapixel", "mp", "ois", "stabil",
    "camera", "display", "screen", "battery", "performance", "design",
    "processor", "fast charging", "build quality", "benchmark", "zoom"
]

def clean_text_for_tts(text):
    # Hapus simbol markdown, tanda kutip, atau kurung yang membuat TTS bisu/error
    text = re.sub(r'[*_#`~"\'\[\]\(\)<>]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def download_video_and_subs(url, work_dir, skip_download=False):
    video_out = os.path.join(work_dir, "source_video.mp4")
    info_out = os.path.join(work_dir, "source_video.info.json")
    sub_file = None
    for f in os.listdir(work_dir):
        if f.startswith("source_video") and f.endswith(".json3"):
            sub_file = os.path.join(work_dir, f)
            break

    video_title = "Smartphone Review"
    if os.path.exists(info_out):
        try:
            with open(info_out, "r", encoding="utf-8") as f:
                video_title = json.load(f).get("title", video_title)
        except Exception:
            pass

    if skip_download and os.path.exists(video_out):
        print("\n[⚡] Mode --skip-download aktif: Memakai video & cache lokal yang sudah ada...")
        return video_out, sub_file, video_title

    print("\n[*] Mengunduh video 1080p, metadata, dan transkrip dari YouTube...")
    if os.path.exists(video_out):
        os.remove(video_out)

    cmd = [
        "yt-dlp",
        "--ignore-errors",
        "--js-runtimes", "node",
        "--write-info-json",
        "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--write-auto-sub", "--write-sub",
        "--sub-lang", "id,en",
        "--sub-format", "json3",
        "-o", os.path.join(work_dir, "source_video.%(ext)s"),
        url
    ]
    subprocess.run(cmd, check=False)

    if not os.path.exists(video_out):
        print("[*] Mengunduh stream video utama...")
        subprocess.run([
            "yt-dlp", "--js-runtimes", "node", "--write-info-json",
            "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", video_out, url
        ], check=True)

    for f in os.listdir(work_dir):
        if f.startswith("source_video") and f.endswith(".json3"):
            sub_file = os.path.join(work_dir, f)
            break

    if os.path.exists(info_out):
        try:
            with open(info_out, "r", encoding="utf-8") as f:
                video_title = json.load(f).get("title", video_title)
        except Exception:
            pass

    return video_out, sub_file, video_title

def load_transcript_events(sub_file):
    if not sub_file or not os.path.exists(sub_file):
        return []
    try:
        with open(sub_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        parsed = []
        for ev in data.get("events", []):
            segs = ev.get("segs", [])
            text = "".join([s.get("utf8", "") for s in segs]).strip()
            text = " ".join(text.split())
            if text:
                start_s = ev.get("tStartMs", 0) / 1000.0
                dur_s = ev.get("dDurationMs", 4000) / 1000.0
                parsed.append((start_s, start_s + dur_s, text))
        return parsed
    except Exception:
        return []

def get_transcript_slice(events, start_s, end_s):
    lines = []
    for ev_s, ev_e, text in events:
        if ev_e >= (start_s - 3.0) and ev_s <= (end_s + 3.0):
            lines.append(text)
    return " ".join(lines)[:350]

def parse_feature_windows(events, total_duration):
    if not events:
        return [(total_duration * 0.08, total_duration * 0.92)]

    windows = []
    for start_s, end_s, text in events:
        if any(k in text.lower() for k in FEATURE_KEYWORDS):
            w_start = max(5.0, start_s - 2.0)
            w_end = min(total_duration - 5.0, end_s + 4.0)
            windows.append((w_start, w_end))

    if not windows:
        return [(total_duration * 0.08, total_duration * 0.92)]

    windows.sort(key=lambda x: x[0])
    merged = [windows[0]]
    for curr in windows[1:]:
        prev = merged[-1]
        if curr[0] <= prev[1] + 2.0:
            merged[-1] = (prev[0], max(prev[1], curr[1]))
        else:
            merged.append(curr)
    return merged

def is_in_windows(t, windows):
    return any(w_s <= t <= w_e for w_s, w_e in windows)

def crop_center_9_16(frame):
    h, w = frame.shape[:2]
    crop_w = int(h * 9 / 16)
    crop_w = crop_w - (crop_w % 2)
    start_x = int((w - crop_w) / 2)
    return frame[0:h, start_x:start_x + crop_w]

def scan_face_free_segments(video_path, model_path, feature_windows, cache_dir, min_duration=3.0, use_cache=True):
    face_cache_file = os.path.join(cache_dir, "face_free_segments.json")
    if use_cache and os.path.exists(face_cache_file):
        try:
            with open(face_cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached:
                print(f"[⚡ CACHE] Melewati scan wajah! Memuat {len(cached)} segmen bebas wajah dari proses sebelumnya.")
                return [tuple(x) for x in cached]
        except Exception:
            pass

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    ret, sample_frame = cap.read()
    if not ret:
        raise RuntimeError("Gagal membaca video sumber.")

    roi_sample = crop_center_9_16(sample_frame)
    roi_h, roi_w = roi_sample.shape[:2]

    detector = cv2.FaceDetectorYN.create(
        model=model_path, config="", input_size=(roi_w, roi_h),
        score_threshold=0.55, nms_threshold=0.3, top_k=5000
    )

    step_sec = 0.5
    step_frames = max(1, int(fps * step_sec))
    timestamps, face_flags = [], []

    print(f"\n[*] Memindai area 9:16 ({roi_w}x{roi_h}) dengan YuNet ONNX...")
    for f_idx in tqdm(range(0, total_frames, step_frames), desc="Filter Wajah Lokal"):
        t = f_idx / fps
        if not is_in_windows(t, feature_windows):
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
        ret, frame = cap.read()
        if not ret:
            break
        roi = crop_center_9_16(frame)
        _, faces = detector.detect(roi)
        timestamps.append(t)
        face_flags.append(1 if (faces is not None and len(faces) > 0) else 0)

    cap.release()

    smoothed = list(face_flags)
    for i in range(1, len(smoothed) - 1):
        if smoothed[i] == 1 and smoothed[i - 1] == 0 and smoothed[i + 1] == 0:
            smoothed[i] = 0

    candidates = []
    seg_start, prev_t = None, None
    for t, flag in zip(timestamps, smoothed):
        if flag == 0:
            if seg_start is None:
                seg_start = t
            elif prev_t is not None and (t - prev_t) > (step_sec * 1.5):
                if (prev_t - seg_start) >= min_duration:
                    candidates.append((seg_start, prev_t))
                seg_start = t
            prev_t = t
        else:
            if seg_start is not None and prev_t is not None and (prev_t - seg_start) >= min_duration:
                candidates.append((seg_start, prev_t))
            seg_start, prev_t = None, None

    if seg_start is not None and prev_t is not None and (prev_t - seg_start) >= min_duration:
        candidates.append((seg_start, prev_t))

    with open(face_cache_file, "w", encoding="utf-8") as f:
        json.dump(candidates, f)

    print(f"[+] Ditemukan & disimpan ke cache: {len(candidates)} kandidat segmen bebas wajah.")
    return candidates

def build_storyboard_base64(video_path, start_s, end_s):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    mid_s = (start_s + end_s) / 2.0
    crops = []
    for t in [start_s + 0.25, mid_s, max(start_s + 0.3, end_s - 0.25)]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ret, frame = cap.read()
        if ret:
            roi = crop_center_9_16(frame)
            h, w = roi.shape[:2]
            crops.append(cv2.resize(roi, (int(w * (640.0 / h)), 640)))
    cap.release()
    if not crops:
        return None
    _, buf = cv2.imencode(".jpg", np.hstack(crops), [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    return base64.b64encode(buf).decode("utf-8")

def call_gemini_vision_or_script(b64_img, raw_sub, duration_s, video_title, api_key, lang="id", skip_visual_check=False):
    max_words = max(4, int(duration_s * 1.9))

    if lang == "en":
        lang_instruction = (
            f"TASK (COPYRIGHT-SAFE ENGLISH VOICEOVER & CAPTION):\n"
            f"- `vo_script`: Write a natural, engaging smartphone review voiceover sentence in **ENGLISH** (MAXIMUM {max_words} WORDS so it fits comfortably in {duration_s:.1f}s). Plain text only, no quotes or markdown.\n"
            f"- `caption`: Write a catchy 1-2 sentence social media caption in **ENGLISH**.\n"
            f"- `hashtags`: Provide 5-8 relevant trending hashtags."
        )
    else:
        lang_instruction = (
            f"TUGAS (VOICE OVER & CAPTION BAHASA INDONESIA ANTI-HAK CIPTA):\n"
            f"- `vo_script`: Buat satu kalimat narasi voice-over dalam **BAHASA INDONESIA** yang natural dan memodifikasi transkrip asli sesuai visual HP (MAKSIMAL {max_words} KATA agar pas dalam {duration_s:.1f} detik). Hanya teks biasa tanpa tanda kutip/markdown.\n"
            f"- `caption`: Buat caption singkat (1-2 kalimat) menarik dalam **BAHASA INDONESIA**.\n"
            f"- `hashtags`: Buat 5-8 hashtag relevan dalam 1 baris."
        )

    if skip_visual_check:
        # Jika video sudah terverifikasi bersih di cache, langsung buat naskah tanpa verifikasi ulang
        prompt = (
            f"Judul Video Sumber: \"{video_title}\"\n"
            f"Durasi Klip: {duration_s:.1f} detik.\n"
            f"Transkrip asli di detik ini: \"{raw_sub}\"\n"
            "Klip ini SUDAH terverifikasi bersih (set is_product_broll=true, has_face=false, has_editor_overlay=false, reason='Cached clean clip').\n"
            f"{lang_instruction}"
        )
        parts = [{"text": prompt}]
        if b64_img:
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": b64_img}})
    else:
        prompt = (
            f"Judul Video Sumber: \"{video_title}\"\n"
            f"Gambar ini berisi 3 frame berurutan hasil crop 9:16 dari review HP (durasi klip: {duration_s:.1f} detik).\n"
            f"Transkrip asli di detik ini: \"{raw_sub}\"\n\n"
            "TUGAS 1 (FILTER VISUAL KETAT):\n"
            "- has_face = true jika ada wajah manusia.\n"
            "- has_editor_overlay = true HANYA JIKA ada subtitle pembicara, teks spesifikasi tempelan editor, watermark, atau grafis animasi.\n"
            "- has_editor_overlay = false jika teks yang terlihat adalah TEKS FISIK NYATA pada bodi HP, layar UI HP yang menyala, kardus HP, atau background nyata.\n"
            "- is_product_broll = true jika menyorot fisik/fitur HP.\n\n"
            f"{lang_instruction}"
        )
        parts = [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64_img}}]

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.25,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "is_product_broll": {"type": "BOOLEAN"},
                    "has_face": {"type": "BOOLEAN"},
                    "has_editor_overlay": {"type": "BOOLEAN"},
                    "reason": {"type": "STRING"},
                    "vo_script": {"type": "STRING"},
                    "caption": {"type": "STRING"},
                    "hashtags": {"type": "STRING"}
                },
                "required": ["is_product_broll", "has_face", "has_editor_overlay", "reason", "vo_script", "caption", "hashtags"]
            }
        }
    }

    active_models = [m for m in VISION_MODELS if m not in EXHAUSTED_VISION_MODELS]
    if not active_models:
        EXHAUSTED_VISION_MODELS.clear()
        active_models = list(VISION_MODELS)

    for v_model in active_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{v_model}:generateContent?key={api_key}"
        try:
            print(f"    [⏳ Vision/Script] Menghubungi {v_model} (timeout 60s)...", end="\r", flush=True)
            resp = requests.post(url, json=payload, timeout=(15, 60))
            if resp.status_code == 404:
                EXHAUSTED_VISION_MODELS.add(v_model)
                continue
            if resp.status_code == 429:
                err_msg = resp.text[:120].replace("\n", " ")
                print(f"\n    [!] Limit Kuota (429) pada {v_model}. Beralih ke model cadangan berikutnya...")
                EXHAUSTED_VISION_MODELS.add(v_model)
                time.sleep(1.5)
                continue
            resp.raise_for_status()
            text_out = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text_out)
        except requests.exceptions.Timeout:
            print(f"\n    [!] Timeout (>60s) pada {v_model}, beralih ke model berikutnya...")
            continue
        except Exception as e:
            print(f"\n    [!] Kendala pada {v_model}: {e}. Beralih model...")
            time.sleep(1.5)
            continue
    print("\n    [ERROR] Semua model Vision sedang penuh/habis kuota. Menunggu 10 detik...")
    time.sleep(10)
    return None

def generate_gemini_tts(text_script, out_wav, api_key, voice_name="Despina", custom_model=None):
    clean_script = clean_text_for_tts(text_script)
    if not clean_script:
        return False, None

    payload = {
        "contents": [{"parts": [{"text": clean_script}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_name
                    }
                }
            }
        }
    }

    if custom_model:
        models_to_try = [custom_model]
    else:
        models_to_try = [m for m in TTS_MODELS if m not in EXHAUSTED_TTS_MODELS]
        if not models_to_try:
            # Jika semua pernah kena limit, coba ulang seluruh daftar setelah jeda singkat
            EXHAUSTED_TTS_MODELS.clear()
            models_to_try = list(TTS_MODELS)

    for model_name in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        for attempt in range(2):
            try:
                print(f"    [⏳ TTS] Generate suara '{voice_name}' via {model_name} (timeout 75s)...", end="\r", flush=True)
                resp = requests.post(url, json=payload, timeout=(15, 75))
                if resp.status_code == 404:
                    EXHAUSTED_TTS_MODELS.add(model_name)
                    break
                if resp.status_code == 429:
                    print(f"\n    [!] Kuota {model_name} habis/limit (HTTP 429). Langsung ganti ke model TTS berikutnya...")
                    EXHAUSTED_TTS_MODELS.add(model_name)
                    time.sleep(1.5)
                    break
                resp.raise_for_status()
                data = resp.json()
                candidates = data.get("candidates", [])
                if not candidates:
                    print(f"\n    [!] Respons {model_name} kosong, mencoba model lain...")
                    break

                parts = candidates[0].get("content", {}).get("parts", [])
                b64_audio = None
                for p in parts:
                    if "inlineData" in p and "data" in p["inlineData"]:
                        b64_audio = p["inlineData"]["data"]
                        break

                if not b64_audio:
                    print(f"\n    [!] {model_name} tidak mengembalikan data audio, beralih model...")
                    break

                pcm_bytes = base64.b64decode(b64_audio)
                # Validasi wajib: minimal 0.25 detik audio (24000Hz * 2 bytes * 0.25s = 12000 bytes)
                if len(pcm_bytes) < 12000:
                    print(f"\n    [!] Audio dari {model_name} terlalu pendek/rusak ({len(pcm_bytes)} bytes), mengulang...")
                    continue

                # Cek apakah audio tidak bisu (RMS check)
                pcm_arr = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
                rms = np.sqrt(np.mean(pcm_arr**2)) if len(pcm_arr) > 0 else 0
                if rms < 15.0:
                    print(f"\n    [!] Audio dari {model_name} terdeteksi bisu (RMS={rms:.1f}), mencoba model berikutnya...")
                    break

                with wave.open(out_wav, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(24000)
                    wf.writeframes(pcm_bytes)
                print(" " * 80, end="\r")
                return True, model_name

            except requests.exceptions.Timeout:
                print(f"\n    [!] Timeout (>75s) saat menunggu TTS {model_name}. Beralih ke model lain...")
                break
            except Exception as e:
                print(f"\n    [!] Error TTS pada {model_name}: {e}")
                time.sleep(1.5)
    return False, None

def get_media_duration(file_path):
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", file_path
    ]
    try:
        out = subprocess.check_output(cmd).decode().strip()
        return float(out)
    except Exception:
        return 0.0

def extract_clean_base_video(video_path, start_s, end_s, base_clip_path):
    # Simpan potongan video 9:16 bersih (tanpa audio) ke dalam folder clean_cache/
    if os.path.exists(base_clip_path) and get_media_duration(base_clip_path) > 1.5:
        return True
    safe_start = start_s + 0.2
    avail_dur = (end_s - 0.2) - safe_start
    if avail_dur < 1.8:
        return False
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{safe_start:.2f}", "-t", f"{avail_dur:.2f}", "-i", video_path,
        "-vf", "crop=ih*9/16:ih:(iw-ow)/2:0,scale=1080:1920:flags=lanczos,fps=30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-an", base_clip_path
    ]
    subprocess.run(cmd, check=True)
    return os.path.exists(base_clip_path)

def mux_base_clip_with_tts(base_clip_path, wav_path, out_path):
    avail_vid_dur = get_media_duration(base_clip_path)
    audio_dur = get_media_duration(wav_path)
    if avail_vid_dur < 1.5 or audio_dur < 0.2:
        return 0.0

    # Sesuaikan tempo & durasi secara presisi + standarisasi ke Stereo 44100Hz agar 100% berbunyi
    if audio_dur > avail_vid_dur:
        target_dur = avail_vid_dur
        speed_ratio = min(1.45, max(1.0, audio_dur / max(0.5, target_dur - 0.08)))
        af_filter = f"atempo={speed_ratio:.3f},aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad"
    else:
        target_dur = max(2.2, min(avail_vid_dur, audio_dur + 0.2))
        af_filter = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad"

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", base_clip_path,
        "-i", wav_path,
        "-af", af_filter,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        "-t", f"{target_dur:.2f}", out_path
    ]
    subprocess.run(cmd, check=True)
    return get_media_duration(out_path)

def generate_merged_caption_txt(video_title, all_scripts, api_key, lang="id"):
    joined_vo = " ".join(all_scripts)
    if lang == "en":
        prompt = (
            f"Phone Review Title: \"{video_title}\"\n"
            f"Full Shorts Voiceover Script: \"{joined_vo}\"\n\n"
            "Write a short, engaging social media caption (2-3 lines max, hook + call to action) in ENGLISH for this smartphone review video, followed by a blank line and 8-10 highly relevant hashtags."
        )
    else:
        prompt = (
            f"Judul Video Review HP: \"{video_title}\"\n"
            f"Naskah Lengkap Voiceover Video: \"{joined_vo}\"\n\n"
            "Buatkan caption singkat yang menarik (maksimal 2-3 baris, berisi kalimat pancingan/hook + ajakan diskusi/cek keranjang) dalam BAHASA INDONESIA untuk video Shorts/Reels review HP ini, diikuti baris kosong dan 8-10 hashtag populer yang relevan."
        )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.4}
    }

    for v_model in VISION_MODELS:
        if v_model in EXHAUSTED_VISION_MODELS:
            continue
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{v_model}:generateContent?key={api_key}"
        try:
            resp = requests.post(url, json=payload, timeout=(10, 35))
            if resp.status_code in (404, 429):
                EXHAUSTED_VISION_MODELS.add(v_model)
                continue
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception:
            continue

    if lang == "en":
        return f"{joined_vo[:140]}...\n\n#SmartphoneReview #TechShorts #GadgetReview #FYP #Shorts"
    return f"{joined_vo[:140]}...\n\n#ReviewHP #GadgetIndonesia #RekomendasiHP #FYP #Shorts"

def save_matching_txt(video_file_path, caption_text, hashtags_text=""):
    base_no_ext = os.path.splitext(video_file_path)[0]
    txt_path = f"{base_no_ext}.txt"
    content = caption_text.strip()
    if hashtags_text:
        content = f"{content}\n\n{hashtags_text.strip()}"
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content + "\n")
    return txt_path

def format_srt_time(seconds):
    ms = int((seconds % 1) * 1000)
    s = int(seconds)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def write_synced_srt(sub_entries, srt_path):
    idx = 1
    with open(srt_path, "w", encoding="utf-8") as f:
        for start_t, end_t, text in sub_entries:
            words = text.split()
            if not words:
                continue
            chunk_size = 5
            chunks = [" ".join(words[i:i+chunk_size]) for i in range(0, len(words), chunk_size)]
            total_dur = max(0.5, end_t - start_t)
            chunk_dur = total_dur / len(chunks)
            for c_idx, chunk in enumerate(chunks):
                c_start = start_t + (c_idx * chunk_dur)
                c_end = min(end_t - 0.05, c_start + chunk_dur)
                f.write(f"{idx}\n{format_srt_time(c_start)} --> {format_srt_time(c_end)}\n{chunk}\n\n")
                idx += 1

def main():
    parser = argparse.ArgumentParser(description="AI Agent B-Roll 9:16 + Smart Cache + Rotasi Gemini 3.8/3.7/3.1 TTS")
    parser.add_argument("--url", required=True, help="Link YouTube review HP")
    parser.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY"), help="Gemini API Key")
    parser.add_argument("--lang", choices=["id", "en"], default="id", help="Pilihan bahasa Voiceover, Subtitle & Caption: 'id' atau 'en'")
    parser.add_argument("--voice", default="Despina", help="Nama suara Gemini TTS (default: Despina)")
    parser.add_argument("--tts-model", default=None, help="Paksa model spesifik (opsional)")
    parser.add_argument("--min-duration", type=float, default=3.2, help="Durasi minimal per klip (detik)")
    parser.add_argument("--max-clips", type=int, default=12, help="Batas maksimal klip yang digabung")
    parser.add_argument("--skip-download", action="store_true", help="Gunakan video & cache B-Roll bersih yang sudah ada tanpa scan wajah ulang")
    parser.add_argument("--reset-cache", action="store_true", help="Hapus cache video bersih dan scan ulang dari awal")
    parser.add_argument("--merge", action="store_true", help="Otomatis aktif: menggabungkan semua klip bersih")
    args = parser.parse_args()

    if not args.api_key:
        print("[ERROR] Harap masukkan API Key dengan --api-key")
        sys.exit(1)

    lang_label = "BAHASA INDONESIA" if args.lang == "id" else "ENGLISH"
    work_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(work_dir, "face_detection_yunet.onnx")
    out_dir = os.path.join(work_dir, "output_clips")
    cache_dir = os.path.join(work_dir, "clean_cache")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    url_Record_file = os.path.join(cache_dir, "last_url.txt")
    prev_url = ""
    if os.path.exists(url_Record_file):
        with open(url_Record_file, "r", encoding="utf-8") as f:
            prev_url = f.read().strip()

    # Jika ganti link YouTube baru (tanpa --skip-download) atau --reset-cache diminta, bersihkan cache lama
    if args.reset_cache or (not args.skip_download and prev_url != args.url):
        print("[*] Membersihkan cache lama untuk video baru...")
        shutil.rmtree(cache_dir, ignore_errors=True)
        os.makedirs(cache_dir, exist_ok=True)
        with open(url_Record_file, "w", encoding="utf-8") as f:
            f.write(args.url)

    video_path, sub_file, video_title = download_video_and_subs(args.url, work_dir, args.skip_download)
    events = load_transcript_events(sub_file)

    verified_cache_file = os.path.join(cache_dir, "verified_broll.json")
    verified_cache = {}
    if os.path.exists(verified_cache_file):
        try:
            with open(verified_cache_file, "r", encoding="utf-8") as f:
                verified_cache = json.load(f)
        except Exception:
            verified_cache = {}

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_dur = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
    cap.release()

    windows = parse_feature_windows(events, total_dur)
    candidates = scan_face_free_segments(
        video_path, model_path, windows, cache_dir, args.min_duration, use_cache=True
    )

    approved_clips = []
    generated_txt_files = []
    all_vo_scripts = []
    sub_timeline = []
    current_timeline_sec = 0.0

    print(f"\n[*] Memproses Klip B-Roll & Voice Over [{lang_label}] (Suara: {args.voice})...")
    for s_start, s_end in candidates:
        if len(approved_clips) >= args.max_clips:
            break

        sub_segments = []
        curr = s_start
        while (s_end - curr) > 7.0:
            sub_segments.append((curr, curr + 5.0))
            curr += 5.0
        if (s_end - curr) >= args.min_duration:
            sub_segments.append((curr, s_end))

        for sub_s, sub_e in sub_segments:
            if len(approved_clips) >= args.max_clips:
                break

            seg_key = f"{int(sub_s*10)}_{int(sub_e*10)}"
            raw_sub = get_transcript_slice(events, sub_s, sub_e)
            clip_target_dur = (sub_e - sub_s) - 0.4
            base_clip_path = os.path.join(cache_dir, f"base_clean_{seg_key}.mp4")

            # Cek apakah segmen ini sudah pernah diverifikasi di cache
            cached_seg = verified_cache.get(seg_key)
            if cached_seg and cached_seg.get("is_clean") is False:
                print(f" -> [{sub_s:.1f}s - {sub_e:.1f}s] LEWATI (Cache: Ditolak sebelumnya)")
                continue

            if cached_seg and cached_seg.get("is_clean") is True and os.path.exists(base_clip_path):
                print(f" -> [{sub_s:.1f}s - {sub_e:.1f}s] ⚡ PAKAI VIDEO BERSIH CACHE ({os.path.basename(base_clip_path)})")
                # Cek apakah naskah bahasa ini sudah ada di cache
                lang_data = cached_seg.get(f"script_{args.lang}")
                if not lang_data:
                    res = call_gemini_vision_or_script(
                        None, raw_sub, clip_target_dur, video_title, args.api_key, args.lang, skip_visual_check=True
                    )
                    if not res:
                        continue
                    lang_data = {
                        "vo_script": res.get("vo_script", "").strip(),
                        "caption": res.get("caption", "").strip(),
                        "hashtags": res.get("hashtags", "#ReviewHP #Shorts").strip()
                    }
                    cached_seg[f"script_{args.lang}"] = lang_data
                    with open(verified_cache_file, "w", encoding="utf-8") as f:
                        json.dump(verified_cache, f, indent=2)
                vo_script = lang_data["vo_script"]
                clip_caption = lang_data["caption"]
                clip_hashtags = lang_data["hashtags"]
            else:
                b64 = build_storyboard_base64(video_path, sub_s, sub_e)
                if not b64:
                    continue
                res = call_gemini_vision_or_script(
                    b64, raw_sub, clip_target_dur, video_title, args.api_key, args.lang, skip_visual_check=False
                )
                if not res:
                    continue

                is_clean = (
                    res.get("is_product_broll") is True
                    and res.get("has_face") is False
                    and res.get("has_editor_overlay") is False
                )
                status = "LOLOS" if is_clean else "DITOLAK"
                print(f" -> [{sub_s:.1f}s - {sub_e:.1f}s] {status} | {res.get('reason')}")

                verified_cache[seg_key] = {
                    "is_clean": is_clean,
                    "reason": res.get("reason", ""),
                    f"script_{args.lang}": {
                        "vo_script": res.get("vo_script", "").strip(),
                        "caption": res.get("caption", "").strip(),
                        "hashtags": res.get("hashtags", "#ReviewHP #Shorts").strip()
                    }
                }
                with open(verified_cache_file, "w", encoding="utf-8") as f:
                    json.dump(verified_cache, f, indent=2)

                if not is_clean:
                    continue

                # Potong & simpan video 9:16 bersih ke cache agar tidak perlu dianalisa ulang nantinya
                if not extract_clean_base_video(video_path, sub_s, sub_e, base_clip_path):
                    continue

                vo_script = res.get("vo_script", "").strip()
                clip_caption = res.get("caption", vo_script).strip()
                clip_hashtags = res.get("hashtags", "#ReviewHP #Shorts").strip()

            if not vo_script:
                continue

            idx_num = len(approved_clips) + 1
            wav_path = os.path.join(cache_dir, f"tts_{args.lang}_{seg_key}.wav")

            # Jika file WAV untuk segmen & bahasa ini sudah valid di cache, langsung pakai
            if os.path.exists(wav_path) and os.path.getsize(wav_path) >= 12000:
                ok_tts, used_model = True, "Cached-WAV"
            else:
                ok_tts, used_model = generate_gemini_tts(
                    vo_script, wav_path, args.api_key, args.voice, args.tts_model
                )

            if not ok_tts:
                print(f"    [!] Gagal membuat audio TTS pada segmen [{sub_s:.1f}s], lanjut ke segmen berikutnya...")
                continue

            print(f"    🎙️ TTS [{args.lang.upper()}] ({used_model} - {args.voice}): \"{clean_text_for_tts(vo_script)}\"")
            clip_name = f"broll_vo_{args.lang}_{idx_num:02d}_{int(sub_s)}s_{int(sub_e)}s.mp4"
            clip_path = os.path.join(out_dir, clip_name)

            actual_dur = mux_base_clip_with_tts(base_clip_path, wav_path, clip_path)
            if actual_dur > 0:
                approved_clips.append(clip_path)
                all_vo_scripts.append(clean_text_for_tts(vo_script))
                sub_timeline.append((current_timeline_sec, current_timeline_sec + actual_dur, clean_text_for_tts(vo_script)))
                current_timeline_sec += actual_dur

                clip_txt_path = save_matching_txt(clip_path, clip_caption, clip_hashtags)
                generated_txt_files.append(clip_txt_path)

    if not approved_clips:
        print("\n[!] Tidak ada klip yang berhasil dirender.")
        sys.exit(0)

    list_file = os.path.join(out_dir, "concat_list.txt")
    with open(list_file, "w") as f:
        for c in approved_clips:
            f.write(f"file '{os.path.abspath(c)}'\n")

    # PENTING: Re-encode jalur audio saat concat agar tidak ada klip yang bisu akibat timestamp drop
    raw_merged = os.path.join(out_dir, f"merged_no_sub_{args.lang}.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", list_file,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        raw_merged
    ], check=True)

    srt_path = os.path.join(out_dir, f"final_subtitles_{args.lang}.srt")
    write_synced_srt(sub_timeline, srt_path)

    final_output = os.path.join(out_dir, f"FINAL_SHORTS_{args.voice.upper()}_{args.lang.upper()}_SUBBED.mp4")
    print(f"\n[*] Menempelkan subtitle [{lang_label}] ke video gabungan...")
    sub_style = "FontName=Sans,FontSize=14,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Bold=1,Alignment=2,MarginV=55"
    burn_cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", raw_merged,
        "-vf", f"subtitles={srt_path}:force_style='{sub_style}'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy", final_output
    ]
    subprocess.run(burn_cmd, check=True)

    print("[*] Menyusun caption singkat & hashtag (.txt) untuk video gabungan utama...")
    merged_caption_full = generate_merged_caption_txt(video_title, all_vo_scripts, args.api_key, args.lang)
    final_txt_path = save_matching_txt(final_output, merged_caption_full)
    generated_txt_files.append(final_txt_path)

    print(f"\n=====================================================")
    print(f" ✅ SELESAI! Video Shorts & Caption .txt [{lang_label}] Siap Upload:")
    print(f" 🎬 Video Utama  : {final_output}")
    print(f" 📝 Caption Utama: {final_txt_path}")
    print(f" ⏱️ Total Durasi : {current_timeline_sec:.1f} detik ({len(approved_clips)} segmen)")
    print(f"-----------------------------------------------------")
    print(f" Isi {os.path.basename(final_txt_path)}:\n{merged_caption_full}")
    print(f"-----------------------------------------------------")

    target_hp_dir = "/sdcard/Download/Broll_Clips"
    try:
        os.makedirs(target_hp_dir, exist_ok=True)
        shutil.copy(final_output, target_hp_dir)
        shutil.copy(final_txt_path, target_hp_dir)
        shutil.copy(srt_path, target_hp_dir)
        for c in approved_clips:
            shutil.copy(c, target_hp_dir)
        for t_file in generated_txt_files:
            shutil.copy(t_file, target_hp_dir)
        print(f" 📲 Semua file (.mp4 & .txt) otomatis tersalin ke: /sdcard/Download/Broll_Clips/")
    except Exception as e:
        print(f" [!] Info salin ke memori HP: {e}")
    print("=====================================================")

if __name__ == "__main__":
    main()
PYEOF

echo "✅ Pembaruan selesai! Sistem Cache Video Bersih, Rotasi Kuota 3.8->3.7->3.1, & Fix Audio sudah aktif."
