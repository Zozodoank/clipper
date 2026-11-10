import os
import re
import sys
import ast
import cv2
import json
import time
import wave
import random
import base64
import shutil
import hashlib
import argparse
import subprocess
import numpy as np
import requests
from tqdm import tqdm

# Daftar fallback awal (akan diperkaya otomatis dari server Google saat startup)
TTS_MODELS = [
    "gemini-3.8-flash-tts",
    "gemini-3.7-flash-tts",
    "gemini-3.1-flash-tts",
    "gemini-3.8-flash-preview-tts",
    "gemini-3.7-flash-preview-tts",
    "gemini-3.1-flash-preview-tts",
    "gemini-2.5-flash-preview-tts"
]

VISION_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
    "gemini-flash-latest"
]

CHAPTER_CONFIG = [
    {
        "id": "body_ip",
        "title": "Bodi, Dimensi & Ketahanan (IP Rating)",
        "keywords": ["desain", "bodi", "body", "dimensi", "tipis", "tebal", "gram", "bobot", "ip5", "ip6", "tahan air", "debu", "warna", "backdoor", "frame", "fisik", "jatuh", "wastafel", "air", "tahan", "uji", "tes"],
        "scene_templates": [
            {
                "scene_id": "body_ip_1",
                "visual_focus": "Fisik bodi belakang, ketebalan frame, warna unit HP, dan genggaman tangan",
                "keywords": ["desain", "bodi", "body", "dimensi", "tipis", "tebal", "gram", "bobot", "warna", "backdoor", "frame", "fisik", "stylish", "mewah"]
            },
            {
                "scene_id": "body_ip_2",
                "visual_focus": "Ketahanan fisik, sertifikasi IP Rating (IP64/IP68/IP69), uji siram/rendam air atau tahan banting",
                "keywords": ["ip5", "ip6", "ip68", "ip69", "ip64", "ip54", "tahan air", "debu", "jatuh", "wastafel", "air", "tahan", "banting", "uji", "tes", "sertifikasi"]
            }
        ]
    },
    {
        "id": "screen_os",
        "title": "Fitur Layar & Sistem Operasi (OS)",
        "keywords": ["layar", "screen", "amoled", "ips", "oled", "inci", "inch", "hz", "refresh", "nits", "bezel", "android", "os", "ui", "hyperos", "oneui", "antarmuka"],
        "scene_templates": [
            {
                "scene_id": "screen_os_1",
                "visual_focus": "Tampilan panel layar depan menyala, bezel, ukuran inci, refresh rate (Hz), dan kecerahan",
                "keywords": ["layar", "screen", "amoled", "ips", "oled", "inci", "inch", "hz", "refresh", "nits", "bezel", "terang", "panel", "visual"]
            },
            {
                "scene_id": "screen_os_2",
                "visual_focus": "Navigasi antarmuka sistem operasi (OS/UI), layar beranda, atau menu Tentang Ponsel",
                "keywords": ["android", "os", "ui", "hyperos", "oneui", "funtouch", "coloros", "realme", "antarmuka", "sistem", "operasi", "fitur", "menu"]
            }
        ]
    },
    {
        "id": "perf_mem",
        "title": "Dapur Pacu (Chipset) & Kapasitas Memori",
        "keywords": ["chipset", "prosesor", "snapdragon", "dimensity", "helio", "unisoc", "exynos", "ram", "lpddr", "internal", "storage", "ufs", "emmc", "microsd", "sdcard", "slot", "antutu", "gaming", "performa"],
        "scene_templates": [
            {
                "scene_id": "perf_mem_1",
                "visual_focus": "Performa chipset/prosesor, skor benchmark AnTuTu, atau cuplikan tes gaming",
                "keywords": ["chipset", "prosesor", "snapdragon", "dimensity", "helio", "unisoc", "exynos", "antutu", "gaming", "performa", "skor", "game", "lancarnya"]
            },
            {
                "scene_id": "perf_mem_2",
                "visual_focus": "Spesifikasi kapasitas RAM (LPDDR), memori internal (UFS/eMMC), atau slot SIM/microSD",
                "keywords": ["ram", "lpddr", "internal", "storage", "ufs", "emmc", "microsd", "sdcard", "slot", "gb", "memori", "penyimpanan", "ekspansi"]
            }
        ]
    },
    {
        "id": "bat_feat",
        "title": "Baterai, Charging & Fitur Pendukung",
        "keywords": ["baterai", "battery", "mah", "charging", "cas", "watt", "nfc", "speaker", "stereo", "fingerprint", "sidik jari", "gyro", "sensor", "audio", "jack"],
        "scene_templates": [
            {
                "scene_id": "bat_feat_1",
                "visual_focus": "Baterai berkapasitas besar (mAh) dan pengisian daya cepat (Watt / Flash Charge / kabel charger)",
                "keywords": ["baterai", "battery", "mah", "charging", "cas", "watt", "flash", "charge", "supervooc", "daya", "awet", "pengisian"]
            },
            {
                "scene_id": "bat_feat_2",
                "visual_focus": "Fitur pendukung seperti NFC, speaker stereo, sensor sidik jari (fingerprint) di layar/samping",
                "keywords": ["nfc", "speaker", "stereo", "fingerprint", "sidik jari", "gyro", "sensor", "audio", "jack", "lengkap", "fitur"]
            }
        ]
    },
    {
        "id": "camera",
        "title": "Kamera Depan Belakang Lengkap & Rekaman Video",
        "keywords": ["kamera", "camera", "megapixel", "mp", "mpx", "ois", "eis", "selfie", "depan", "belakang", "ultrawide", "telephoto", "perekaman", "rekam", "fps", "1080p", "4k", "foto", "video", "lensa"],
        "scene_templates": [
            {
                "scene_id": "camera_1",
                "visual_focus": "Modul lensa kamera belakang utama & kamera depan beserta hasil foto",
                "keywords": ["kamera", "camera", "utama", "belakang", "megapixel", "mp", "mpx", "ois", "sony", "ultrawide", "depan", "selfie", "lensa", "foto"]
            },
            {
                "scene_id": "camera_2",
                "visual_focus": "Antarmuka perekaman video atau sampel hasil rekaman video depan & belakang (1080p/4K FPS)",
                "keywords": ["perekaman", "rekam", "video", "fps", "1080p", "4k", "60fps", "30fps", "full hd", "eis", "stabil", "sampel"]
            }
        ]
    },
    {
        "id": "cta",
        "title": "Kesimpulan & CTA Soft Selling",
        "keywords": ["kesimpulan", "harga", "worth", "beli", "tertarik", "rekomendasi", "pilihan", "kesimpulannya"],
        "scene_templates": [
            {
                "scene_id": "cta_1",
                "visual_focus": "Tampilan keseluruhan unit HP yang elegan sebagai kesimpulan & rekomendasi akhir",
                "keywords": ["kesimpulan", "solusi", "solid", "harga", "worth", "beli", "tertarik", "rekomendasi", "pilihan", "kesimpulannya", "layak", "unggul"]
            }
        ]
    }
]

def discover_available_models(api_key):
    """
    Mendeteksi secara otomatis seluruh model Gemini 3.x aktif di server Google
    untuk API Key ini (membuang model 2.5 usang, model khusus image/banana/transcribe/customtools)
    agar fallback selalu cepat, stabil, dan 100% mendukung JSON & Vision.
    """
    global VISION_MODELS, TTS_MODELS
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code != 200:
            return
        models_data = resp.json().get("models", [])
        found_vision = []
        found_tts = []

        skip_words = [
            "embedding", "aqa", "imagen", "veo", "bisheng",
            "robotics", "computer-use", "learnlm", "thinking", "audio",
            "image", "banana", "transcribe", "customtools", "2.5", "gemma",
            " omni", "omni-", "argon", "lite-preview"
        ]

        for m in models_data:
            name = m.get("name", "").replace("models/", "")
            methods = m.get("supportedGenerationMethods", [])
            if "generateContent" not in methods:
                continue
            low = name.lower()
            if "tts" in low:
                found_tts.append(name)
                continue
            if any(sw in low for sw in skip_words):
                continue
            if low.startswith("gemini-"):
                found_vision.append(name)

        def score_vision_model(m_name):
            s = m_name.lower()
            # Prioritaskan model 3.5-flash-lite, 3.1-flash-lite, flash-lite-latest yang kuotanya paling longgar & bebas 503,
            # diikuti model 3.8/3.7/3.6/3.5 flash reguler sebagai cadangan.
            if s == "gemini-3.5-flash-lite":
                return 1
            if s == "gemini-3.1-flash-lite":
                return 2
            if s == "gemini-flash-lite-latest":
                return 3
            if s == "gemini-3.8-flash":
                return 4
            if s == "gemini-3.7-flash":
                return 5
            if s == "gemini-3.6-flash":
                return 6
            if s == "gemini-3.5-flash":
                return 7
            if s == "gemini-3-flash-preview":
                return 8
            if s == "gemini-flash-latest":
                return 9
            if "lite" in s:
                return 12
            if "flash" in s:
                return 15
            return 30

        if found_vision:
            found_vision.sort(key=score_vision_model)
            VISION_MODELS = list(dict.fromkeys(found_vision))
            print(f"[+] Berhasil mendeteksi {len(VISION_MODELS)} model AI aktif untuk Fallback: {', '.join(VISION_MODELS[:6])}...", flush=True)

        if found_tts:
            merged_tts = list(dict.fromkeys(TTS_MODELS + found_tts))
            TTS_MODELS = merged_tts
    except Exception:
        pass

def extract_video_id(url):
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else hashlib.md5(url.encode()).hexdigest()[:11]

def check_video_info(video_path):
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,height", "-of", "json",
        video_path
    ]
    try:
        data = json.loads(subprocess.check_output(cmd).decode())
        stream = data.get("streams", [{}])[0]
        return stream.get("codec_name", "").lower(), int(stream.get("height", 0))
    except Exception:
        return "", 0

def ensure_1080p_h264(video_path):
    codec, _ = check_video_info(video_path)
    if "av1" in codec or "av01" in codec:
        print(f"\n[!] Mengonversi video ({codec.upper()}) ke H.264 1080p...", flush=True)
        temp_h264 = video_path + ".h264.mp4"
        subprocess.run([
            "ffmpeg", "-nostdin", "-y", "-loglevel", "fatal", "-i", video_path,
            "-vf", "scale=-2:1080", "-c:v", "libx264", "-preset", "superfast", "-crf", "19",
            "-c:a", "copy", temp_h264
        ], check=True)
        os.replace(temp_h264, video_path)

def download_video_and_subs(url, work_dir, skip_download=False):
    video_out = os.path.join(work_dir, "source_video.mp4")
    info_out = os.path.join(work_dir, "source_video.info.json")
    vid_id = extract_video_id(url)

    sub_file = None
    for f in os.listdir(work_dir):
        if f.startswith("source_video") and f.endswith(".json3"):
            sub_file = os.path.join(work_dir, f)
            break

    video_title = "Smartphone Review"
    video_desc = ""
    cached_id = None
    if os.path.exists(info_out):
        try:
            with open(info_out, "r", encoding="utf-8") as f:
                info_data = json.load(f)
                video_title = info_data.get("title", video_title)
                video_desc = info_data.get("description", "")[:5000]
                cached_id = info_data.get("id")
        except Exception:
            pass

    if os.path.exists(video_out) and (skip_download or cached_id == vid_id):
        _, height = check_video_info(video_out)
        print(f"\n[*] Menggunakan video lokal ({video_title} - {height}p)...", flush=True)
        ensure_1080p_h264(video_out)
        return video_out, sub_file, video_title, video_desc, vid_id

    print("\n[*] Mengunduh video 1080p H.264 dan transkrip dari YouTube...", flush=True)
    if os.path.exists(video_out):
        os.remove(video_out)

    cmd = [
        "yt-dlp",
        "--ignore-errors",
        "--js-runtimes", "node",
        "--write-info-json",
        "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "--merge-output-format", "mp4",
        "--write-auto-sub", "--write-sub",
        "--sub-lang", "id,en",
        "--sub-format", "json3",
        "-o", os.path.join(work_dir, "source_video.%(ext)s"),
        url
    ]
    subprocess.run(cmd, check=False)

    if not os.path.exists(video_out):
        subprocess.run([
            "yt-dlp", "--js-runtimes", "node", "--write-info-json",
            "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=1080]",
            "--merge-output-format", "mp4",
            "-o", video_out, url
        ], check=True)

    ensure_1080p_h264(video_out)

    for f in os.listdir(work_dir):
        if f.startswith("source_video") and f.endswith(".json3"):
            sub_file = os.path.join(work_dir, f)
            break

    if os.path.exists(info_out):
        try:
            with open(info_out, "r", encoding="utf-8") as f:
                info_data = json.load(f)
                video_title = info_data.get("title", video_title)
                video_desc = info_data.get("description", "")[:5000]
        except Exception:
            pass

    return video_out, sub_file, video_title, video_desc, vid_id

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

def build_timestamped_transcript_digest(events, max_chars=16000):
    if not events:
        return ""
    blocks = []
    bucket_start = None
    bucket_end = None
    bucket_texts = []

    for s, e, txt in events:
        if bucket_start is None:
            bucket_start = s
            bucket_end = e
            bucket_texts = [txt]
        elif (e - bucket_start) <= 18.0:
            bucket_end = e
            bucket_texts.append(txt)
        else:
            joined = " ".join(bucket_texts)
            blocks.append(f"[{int(bucket_start)}s-{int(bucket_end)}s] {joined}")
            bucket_start = s
            bucket_end = e
            bucket_texts = [txt]

    if bucket_texts and bucket_start is not None:
        blocks.append(f"[{int(bucket_start)}s-{int(bucket_end)}s] {' '.join(bucket_texts)}")

    full_str = "\n".join(blocks)
    return full_str[:max_chars]

def get_transcript_slice(events, start_s, end_s):
    lines = []
    for ev_s, ev_e, text in events:
        if ev_e >= (start_s - 3.0) and ev_s <= (end_s + 3.0):
            lines.append(text)
    return " ".join(lines)[:380]

def crop_center_9_16(frame):
    h, w = frame.shape[:2]
    crop_w = int(h * 9 / 16)
    crop_w = crop_w - (crop_w % 2)
    start_x = int((w - crop_w) / 2)
    return frame[0:h, start_x:start_x + crop_w]

def get_or_scan_face_free_segments(video_path, model_path, total_dur, vid_id, work_dir, min_duration=2.0, force_rescan=False):
    cache_path = os.path.join(work_dir, "face_scan_cache.json")
    if not force_rescan and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cache = json.load(f)
            if cache.get("vid_id") == vid_id and cache.get("version") == 2:
                raw_cands = cache.get("candidates", [])
                # Tambahkan margin aman 0.35s di awal & akhir tiap segmen agar tidak menyentuh transisi wajah
                filtered = [
                    (float(s) + 0.35, float(e) - 0.35)
                    for s, e in raw_cands
                    if (float(e) - float(s) - 0.70) >= min_duration and float(s) >= 20.0
                ]
                if len(filtered) >= 8:
                    print(f"[+] Memuat {len(filtered)} segmen bebas wajah (dengan margin aman 0.35s) dari Cache v2.", flush=True)
                    return filtered
        except Exception:
            pass

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    detect_w, detect_h = 270, 480
    detector = cv2.FaceDetectorYN.create(
        model=model_path, config="", input_size=(detect_w, detect_h),
        score_threshold=0.40, nms_threshold=0.3, top_k=5000
    )
    step_sec = 0.4
    step_frames = max(1, int(fps * step_sec))
    timestamps, face_flags = [], []

    print("\n[*] Memindai seluruh segmen bebas wajah dengan YuNet ONNX Ketat (Disimpan ke Cache v2)...", flush=True)
    for f_idx in tqdm(range(total_frames), desc="Filter Wajah Lokal"):
        if not cap.grab():
            break
        if f_idx % step_frames != 0:
            continue
        t = f_idx / fps
        if t < 15.0 or t > (total_dur - 8.0):
            continue
        ret, frame = cap.retrieve()
        if not ret or frame is None:
            continue
        roi = crop_center_9_16(frame)
        roi_small = cv2.resize(roi, (detect_w, detect_h), interpolation=cv2.INTER_AREA)
        _, faces = detector.detect(roi_small)
        timestamps.append(t)
        face_flags.append(1 if (faces is not None and len(faces) > 0) else 0)
    cap.release()

    # JANGAN PERNAH menghapus flag wajah (1 -> 0)! Sebaliknya, perluas flag wajah (dilasi 1 langkah)
    # agar frame di dekat kemunculan wajah ikut ditandai tidak aman.
    dilated = list(face_flags)
    for i in range(len(face_flags)):
        if face_flags[i] == 1:
            if i > 0:
                dilated[i - 1] = 1
            if i + 1 < len(face_flags):
                dilated[i + 1] = 1

    all_candidates = []
    seg_start, prev_t = None, None
    for t, flag in zip(timestamps, dilated):
        if flag == 0:
            if seg_start is None:
                seg_start = t
            elif prev_t is not None and (t - prev_t) > (step_sec * 1.5):
                if (prev_t - seg_start) >= 2.2:
                    all_candidates.append((seg_start + 0.25, prev_t - 0.25))
                seg_start = t
            prev_t = t
        else:
            if seg_start is not None and prev_t is not None and (prev_t - seg_start) >= 2.2:
                all_candidates.append((seg_start + 0.25, prev_t - 0.25))
            seg_start, prev_t = None, None

    if seg_start is not None and prev_t is not None and (prev_t - seg_start) >= 2.2:
        all_candidates.append((seg_start + 0.25, prev_t - 0.25))

    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"vid_id": vid_id, "version": 2, "candidates": all_candidates}, f)
    except Exception:
        pass

    return [(s, e) for s, e in all_candidates if (e - s) >= min_duration and s >= 20.0]

def repair_json_string(s):
    """Memperbaiki kesalahan sintaks JSON umum dari LLM (trailing comma, komentar, newline mentah, kutip dalam string)."""
    # Hapus komentar satu baris // di luar URL dan komentar blok /* */
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)
    s = re.sub(r"(?<![:\w])//[^\n]*", "", s)
    # Hapus trailing comma sebelum } atau ]
    s = re.sub(r",\s*([}\]])", r"\1", s)

    # Perbaiki karakter kontrol / newline mentah dan tanda kutip ganda yang tidak di-escape di dalam nilai string JSON
    out = []
    in_str = False
    esc = False
    n = len(s)
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                out.append(ch)
                esc = False
            elif ch == "\\":
                out.append(ch)
                esc = True
            elif ch == '"':
                # Cek apakah kutip ini penutup string JSON yang sah (diikuti oleh :, ,, }, ], atau whitespace lalu salah satunya)
                j = i + 1
                while j < n and s[j] in " \t\r\n":
                    j += 1
                if j >= n or s[j] in ":,}]":
                    in_str = False
                    out.append(ch)
                else:
                    # Kutip di tengah kalimat (misal: 6,7" atau julukan "Flagship"), escape otomatis!
                    out.append('\\"')
            elif ch in "\r\n":
                out.append(" ")
            elif ord(ch) < 32:
                out.append(" ")
            else:
                out.append(ch)
        else:
            if ch == '"':
                in_str = True
            out.append(ch)
    fixed = "".join(out)
    fixed = re.sub(r",\s*([}\]])", r"\1", fixed)
    return fixed

def normalize_parsed_json_to_dict(parsed):
    """Menormalkan hasil parse JSON (baik list maupun nested wrapper dict) menjadi dict level atas yang diharapkan."""
    if isinstance(parsed, list):
        if len(parsed) == 1 and isinstance(parsed[0], dict):
            parsed = parsed[0]
        elif len(parsed) > 0 and all(isinstance(x, dict) for x in parsed):
            merged = {}
            for item in parsed:
                cid = item.get("id") or item.get("chapter_id") or item.get("key")
                if cid:
                    merged[str(cid)] = item
                else:
                    merged.update(item)
            if merged:
                parsed = merged
    if isinstance(parsed, dict):
        # Jika dibungkus dalam key tunggal seperti {"chapters": {...}} atau {"result": {...}} atau {"data": {...}}
        expected = {"body_ip", "screen_os", "perf_mem", "bat_feat", "camera", "cta", "is_product_broll"}
        if not (set(parsed.keys()) & expected):
            for v in parsed.values():
                if isinstance(v, dict) and (set(v.keys()) & expected):
                    return v
                if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                    sub = normalize_parsed_json_to_dict(v)
                    if isinstance(sub, dict) and (set(sub.keys()) & expected):
                        return sub
    return parsed

def salvage_chapters_by_regex(raw_txt, total_dur=600.0):
    """Penyelamat darurat berbasis regex jika struktur kurung kurawal JSON terpotong di tengah jalan."""
    alias_map = {
        "body_ip": ["body_ip", "design", "body"],
        "screen_os": ["screen_os", "screen", "display"],
        "perf_mem": ["perf_mem", "performance", "chipset"],
        "bat_feat": ["bat_feat", "battery"],
        "camera": ["camera"],
        "cta": ["cta", "conclusion"]
    }
    all_key_names = "|".join([a for sub in alias_map.values() for a in sub] + ["caption", "hashtags"])
    salvaged = {}
    step = max(30.0, (total_dur - 45.0) / 6.0)
    for idx, (canon_k, aliases) in enumerate(alias_map.items()):
        def_s = 35.0 + idx * step
        def_e = min(total_dur - 10.0, def_s + step)
        for k in aliases:
            pat = rf'"{k}"\s*:\s*\{{(.*?)(?="(?:{all_key_names})"\s*:|\Z)'
            m = re.search(pat, raw_txt, flags=re.DOTALL)
            if not m:
                continue
            blk = m.group(1)
            s_m = re.search(r'"start_sec"\s*:\s*([0-9.]+)', blk)
            e_m = re.search(r'"end_sec"\s*:\s*([0-9.]+)', blk)
            sc_m = re.search(r'"script"\s*:\s*"([^"\n\r}]+)', blk)
            if sc_m:
                salvaged[canon_k] = {
                    "start_sec": float(s_m.group(1)) if s_m else def_s,
                    "end_sec": float(e_m.group(1)) if e_m else def_e,
                    "script": sc_m.group(1).strip().rstrip('",'),
                    "scenes": []
                }
                break
    if len(salvaged) >= 2:
        cap_m = re.search(r'"caption"\s*:\s*"([^"]+)"', raw_txt)
        tag_m = re.search(r'"hashtags"\s*:\s*"([^"]+)"', raw_txt)
        if cap_m:
            salvaged["caption"] = cap_m.group(1).strip()
        if tag_m:
            salvaged["hashtags"] = tag_m.group(1).strip()
        return salvaged
    return None

def extract_json_object(raw_txt):
    """Mengekstrak dan memperbaiki objek JSON secara berlapis (5-Stage Resilient JSON Parser)."""
    if not raw_txt or not str(raw_txt).strip():
        raise ValueError("Empty response text")

    txt = str(raw_txt).strip()
    txt = re.sub(r"^```(?:json)?\s*", "", txt, flags=re.IGNORECASE)
    txt = re.sub(r"\s*```$", "", txt)
    txt = txt.strip()

    # Stage 1: Direct parse
    try:
        return normalize_parsed_json_to_dict(json.loads(txt))
    except Exception:
        pass

    # Stage 2: Ambil blok kurung kurawal {...} atau [...] terluar lalu perbaiki sintaks
    candidates_str = [txt]
    first_brace = txt.find("{")
    last_brace = txt.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        candidates_str.insert(0, txt[first_brace:last_brace + 1])

    for cand in candidates_str:
        repaired = repair_json_string(cand)
        try:
            return normalize_parsed_json_to_dict(json.loads(repaired))
        except Exception:
            pass
        # Stage 3: Coba ast.literal_eval (dengan konversi true/false/null -> True/False/None)
        try:
            py_cand = re.sub(r"\btrue\b", "True", repaired, flags=re.IGNORECASE)
            py_cand = re.sub(r"\bfalse\b", "False", py_cand, flags=re.IGNORECASE)
            py_cand = re.sub(r"\bnull\b", "None", py_cand, flags=re.IGNORECASE)
            val = ast.literal_eval(py_cand)
            if isinstance(val, (dict, list)):
                return normalize_parsed_json_to_dict(val)
        except Exception:
            pass

    # Stage 4: Jika respons untuk check_clean_broll_segment (boolean fields)
    if "is_product_broll" in txt:
        ipb = bool(re.search(r'"?is_product_broll"?\s*:\s*true', txt, re.IGNORECASE))
        hf = bool(re.search(r'"?has_face"?\s*:\s*true', txt, re.IGNORECASE))
        heo = bool(re.search(r'"?has_editor_overlay"?\s*:\s*true', txt, re.IGNORECASE))
        hsp = bool(re.search(r'"?has_subscribe_popup"?\s*:\s*true', txt, re.IGNORECASE))
        isi = bool(re.search(r'"?is_static_image"?\s*:\s*true', txt, re.IGNORECASE))
        rs_m = re.search(r'"?reason"?\s*:\s*"([^"]*)"', txt, re.IGNORECASE)
        return {
            "is_product_broll": ipb,
            "has_face": hf,
            "has_editor_overlay": heo or hsp,
            "has_subscribe_popup": hsp,
            "is_static_image": isi,
            "reason": rs_m.group(1) if rs_m else "Parsed via regex fallback"
        }

    # Stage 5: Regex salvage untuk 6 Bab
    salvaged = salvage_chapters_by_regex(txt)
    if salvaged:
        return salvaged

    raise ValueError("Unable to parse JSON from response")

def call_gemini_json(payload, api_key):
    """
    Sistem Fallback Multi-Model Instan + Filter Thought Parts + Auto-Repair JSON:
    - Jika model terkena 429/503 (Limit/Sibuk), langsung pindah ke model berikutnya dan menggeser model sibuk ke urutan belakang.
    - Mengabaikan part `thought` pada model Gemini 2.5/3.x dan mengambil part teks JSON yang sebenarnya.
    """
    global VISION_MODELS
    last_err = ""

    for round_idx in range(2):
        models_snapshot = list(VISION_MODELS)
        for v_model in models_snapshot:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{v_model}:generateContent?key={api_key}"
            curr_payload = json.loads(json.dumps(payload))

            for attempt in range(2):
                try:
                    resp = requests.post(url, json=curr_payload, timeout=40)

                    if resp.status_code == 404:
                        last_err = f"{v_model} (404)"
                        if v_model in VISION_MODELS and len(VISION_MODELS) > 1:
                            VISION_MODELS.remove(v_model)
                        break

                    if resp.status_code == 400:
                        gen_cfg = curr_payload.get("generationConfig", {})
                        if "responseSchema" in gen_cfg or "responseMimeType" in gen_cfg:
                            gen_cfg.pop("responseSchema", None)
                            gen_cfg.pop("responseMimeType", None)
                            continue
                        last_err = f"{v_model} (400)"
                        if v_model in VISION_MODELS and len(VISION_MODELS) > 1:
                            VISION_MODELS.remove(v_model)
                        break

                    if resp.status_code in (429, 503):
                        last_err = f"{v_model} ({resp.status_code} Rate Limit)"
                        if v_model in VISION_MODELS and len(VISION_MODELS) > 1:
                            VISION_MODELS.remove(v_model)
                            VISION_MODELS.append(v_model)
                        next_m = VISION_MODELS[0]
                        print(f"    [!] {v_model} penuh ({resp.status_code}) -> Fallback instan ke {next_m}...", flush=True)
                        time.sleep(0.8)
                        break

                    resp.raise_for_status()
                    cand = resp.json().get("candidates", [{}])[0]
                    parts = cand.get("content", {}).get("parts", [])
                    text_parts = [p.get("text", "") for p in parts if "text" in p and not p.get("thought")]
                    if not text_parts:
                        text_parts = [p.get("text", "") for p in parts if "text" in p]
                    raw_txt = "\n".join(t for t in text_parts if t).strip()

                    parsed = extract_json_object(raw_txt)
                    if not isinstance(parsed, dict) or not parsed:
                        raise ValueError("Parsed JSON is not a non-empty dict")

                    if v_model in VISION_MODELS and VISION_MODELS[0] != v_model:
                        VISION_MODELS.remove(v_model)
                        VISION_MODELS.insert(0, v_model)
                    return parsed

                except Exception as e:
                    last_err = f"{v_model}: {e}"
                    if attempt == 0:
                        time.sleep(0.5)
                        continue
                    break

        if round_idx == 0:
            print("    [!] Semua model sedang sibuk, menunggu 4 detik sebelum putaran kedua...", flush=True)
            time.sleep(4)

    print(f"    [!] Detail kendala terakhir: {last_err}", flush=True)
    return None

ENGLISH_CTA_VARIATIONS = [
    (
        "Gaya Antusias & Energetic: Kesimpulan 4-5 kata keunggulan HP + ajakan seperti "
        "'Smash that like button and subscribe for more daily tech reviews!'"
    ),
    (
        "Gaya Pertanyaan Interaktif: Kesimpulan singkat nilai HP + ajakan seperti "
        "'Would you rock this phone? Hit like and subscribe so you never miss our next gadget test!'"
    ),
    (
        "Gaya Komunitas Tech: Kesimpulan singkat performa HP + ajakan seperti "
        "'Drop a like if you found this helpful, and subscribe to join our tech squad today!'"
    ),
    (
        "Gaya Singkat & Punchy: Kesimpulan padat 4-5 kata + ajakan seperti "
        "'Tap like right now and subscribe for more honest smartphone breakdowns!'"
    ),
    (
        "GayaRekomendasi Pro: Kesimpulan singkat kelayakan beli + ajakan seperti "
        "'Give this video a thumbs up and hit subscribe to stay ahead on the latest flagship tech!'"
    ),
    (
        "Gaya Viral Shorts: Kesimpulan singkat + ajakan seperti "
        "'Double tap to like and hit that subscribe button for your daily dose of smartphone reviews!'"
    ),
    (
        "Gaya Tech Enthusiast: Kesimpulan singkat + ajakan seperti "
        "'Love this upgrade? Leave a like and subscribe right now for more hands-on gadget comparisons!'"
    ),
    (
        "Gaya Smart Buyer: Kesimpulan singkat + ajakan seperti "
        "'Before you scroll away, hit that like button and subscribe for more quick tech verdicts!'"
    ),
]

ENGLISH_CTA_FALLBACK_TEMPLATES = [
    "This flagship packs serious value, so smash that like button and subscribe for more daily tech reviews!",
    "An absolute powerhouse for the price, hit like and subscribe so you never miss our next gadget test!",
    "Truly a standout smartphone this year, drop a like and subscribe to join our tech community today!",
    "Incredible specs from top to bottom, tap like right now and subscribe for more honest phone breakdowns!",
    "Easily one of the smartest picks right now, give this a thumbs up and subscribe for more flagship tech!",
    "That wraps up our quick breakdown, double tap to like and hit subscribe for your daily dose of tech!",
    "A massive upgrade where it counts, leave a like and subscribe right now for more hands-on reviews!",
    "Before you scroll to the next video, hit that like button and subscribe for more fast tech verdicts!"
]

def pick_english_cta_style_and_fallback(video_title=""):
    """Memilih gaya variasi CTA Bahasa Inggris (Like & Subscribe) yang selalu berbeda di setiap video/eksekusi."""
    seed_val = int(time.time() * 1000) ^ int(hashlib.md5(video_title.encode("utf-8", errors="ignore")).hexdigest()[:8], 16)
    rng = random.Random(seed_val)
    idx = rng.randrange(len(ENGLISH_CTA_VARIATIONS))
    return idx, ENGLISH_CTA_VARIATIONS[idx], ENGLISH_CTA_FALLBACK_TEMPLATES[idx]

def _remove_leading_word_repetition(text):
    """
    Menghapus pengulangan kata yang sama di awal kalimat kedua setelah tanda koma/titik.
    Contoh: 'Baterai badak, baterai awet seharian' -> 'Baterai badak, awet seharian'
    Juga menghapus pengulangan kata jika klausa terakhir kalimat pertama diulang di awal kalimat kedua.
    """
    # Pisah di koma/tanda titik koma pertama
    split_match = re.split(r'([,;])\s*', text, maxsplit=1)
    if len(split_match) < 3:
        return text
    part1, sep, part2 = split_match[0], split_match[1], split_match[2]
    words1 = [w.lower().strip(".,!?;:") for w in part1.split() if w]
    words2 = part2.split()
    if not words1 or not words2:
        return text
    # Hapus kata-kata awal part2 yang sudah ada di akhir part1
    last3_words1 = set(words1[-3:])
    cleaned2 = []
    skip_mode = True
    for w in words2:
        bare = w.lower().strip(".,!?;:")
        if skip_mode and bare in last3_words1:
            continue  # lewati kata duplikat di awal part2
        skip_mode = False
        cleaned2.append(w)
    if not cleaned2:
        return text
    # Pastikan huruf awal part2 kapital
    result_part2 = " ".join(cleaned2)
    if result_part2:
        result_part2 = result_part2[0].upper() + result_part2[1:]
    return f"{part1}{sep} {result_part2}"


def ensure_english_like_and_subscribe_cta(cta_script, fallback_template):
    """Memastikan naskah CTA Bahasa Inggris 100% mengandung ajakan Like dan Subscribe dengan kalimat bervariasi."""
    txt = sanitize_subtitle_text(cta_script)
    if not txt:
        return fallback_template
    low = txt.lower()
    has_sub  = "subscribe" in low
    has_like = ("like" in low) or ("thumbs up" in low) or ("double tap" in low)
    if has_sub and has_like:
        return _remove_leading_word_repetition(txt)
    # Jika kalimat pertama adalah kesimpulan namun belum ada like+subscribe lengkap, gabungkan klausa pertama dengan akhiran bervariasi
    first_clause = re.split(r"[.!?]", txt)[0].strip().rstrip(",;:")
    suffix_match = re.split(r",\s*", fallback_template, maxsplit=1)
    varied_suffix = suffix_match[1] if len(suffix_match) > 1 else "hit that like button and subscribe for more tech reviews!"
    if first_clause and len(first_clause.split()) <= 9:
        combined = f"{first_clause}, {varied_suffix}"
        return _remove_leading_word_repetition(combined)
    return _remove_leading_word_repetition(fallback_template)

INDONESIAN_CTA_VARIATIONS = [
    (
        "Gaya Soft Selling Afiliasi Standar: Kesimpulan singkat keunggulan utama HP (4-5 kata) + ajakan ramah seperti "
        "'Tertarik meminangnya? Cek harga promo dan link pembelian resminya sekarang juga!'"
    ),
    (
        "Gaya Rekomendasi Worth-It: Kesimpulan singkat nilai jual HP + ajakan soft selling seperti "
        "'Sangat layak masuk daftar incaranmu tahun ini, yuk cek penawaran terbaiknya lewat link yang tersedia!'"
    ),
    (
        "Gaya Solusi Upgrade: Kesimpulan singkat spesifikasi unggulan + ajakan soft selling seperti "
        "'Pilihan tepat buat kamu yang cari upgrade HP awet, langsung amankan unitnya di link pembelian ya!'"
    ),
    (
        "Gaya Afiliasi Elegan: Kesimpulan singkat performa & kamera + ajakan soft selling seperti "
        "'Paket komplit yang sulit ditolak di kelas harganya, cek ketersediaan stok dan promonya sekarang!'"
    )
]

INDONESIAN_CTA_FALLBACK_TEMPLATES = [
    "Dengan segala keunggulan yang ditawarkan, smartphone ini sangat layak dimiliki, cek harga promo dan link pembeliannya sekarang!",
    "Paket spesifikasi yang sangat komplit di kelas harganya, langsung cek ketersediaan stok dan penawaran terbaiknya sekarang juga!",
    "Pilihan paling solid untuk upgrade smartphone kamu tahun ini, yuk amankan unit resminya lewat link pembelian yang tersedia!",
    "Perpaduan performa, layar, dan kamera yang sangat seimbang, cek info harga terbaru dan promo resminya sekarang juga!"
]

UNWANTED_HALLUCINATION_PATTERNS = [
    r"\b(?:buat|untuk|bagi|cocok\s+buat|cocok\s+untuk|anak|mahasiswa|sambil|pas|saat)?\s*kuliah\s+sore\b",
    r"\bkuliah\s+sore\b",
    r"\bkuliah\s+malam\b",
    r"\bkuliah\s+pagi\b",
    r"\banak\s+kuliahan?\b"
]

def pick_indonesian_cta_style_and_fallback(video_title=""):
    """Memilih variasi CTA soft-selling afiliasi Bahasa Indonesia yang bersih dan natural."""
    seed_val = int(time.time() * 1000) ^ int(hashlib.md5(video_title.encode("utf-8", errors="ignore")).hexdigest()[:8], 16)
    rng = random.Random(seed_val)
    idx = rng.randrange(len(INDONESIAN_CTA_VARIATIONS))
    return idx, INDONESIAN_CTA_VARIATIONS[idx], INDONESIAN_CTA_FALLBACK_TEMPLATES[idx]

def ensure_indonesian_affiliate_soft_selling_cta(cta_script, fallback_template):
    """Memastikan CTA Bahasa Indonesia tetap bersih, bebas frasa aneh ('kuliah sore'), dan bernuansa soft-selling afiliasi standar."""
    txt = sanitize_subtitle_text(cta_script)
    if not txt or len(txt.split()) < 6:
        return fallback_template
    # Jika terdeteksi kata aneh atau terlalu pendek setelah sanitasi, gunakan klausa pertama + akhiran soft selling
    low = txt.lower()
    has_soft_cta = any(k in low for k in ["cek", "link", "tertarik", "layak", "pilihan", "rekomendasi", "komentar", "incaran", "promo", "harga", "miliki", "pinang"])
    if has_soft_cta:
        return _remove_leading_word_repetition(txt)
    first_clause = re.split(r"[.!?]", txt)[0].strip().rstrip(",;:")
    suffix_match = re.split(r",\s*", fallback_template, maxsplit=1)
    soft_suffix = suffix_match[-1] if len(suffix_match) > 1 else "cek harga promo dan link pembeliannya sekarang!"
    if first_clause and len(first_clause.split()) <= 9:
        combined = f"{first_clause}, {soft_suffix}"
        return _remove_leading_word_repetition(combined)
    return _remove_leading_word_repetition(fallback_template)

def analyze_native_transcript_and_build_chapters(video_title, video_desc, timestamped_transcript, total_dur, api_key, lang="id"):
    short_transcript = timestamped_transcript[:15000] if timestamped_transcript else "(Transkrip tidak tersedia, gunakan spesifikasi asli HP pada judul)"
    lang_label = "Bahasa Inggris (English)" if lang == "en" else "Bahasa Indonesia"
    inch_rule = "kata 'inch'" if lang == "en" else "kata 'inci'"

    var_idx, en_cta_style, en_cta_fallback = pick_english_cta_style_and_fallback(video_title)
    id_idx, id_cta_style, id_cta_fallback = pick_indonesian_cta_style_and_fallback(video_title)
    if lang == "en":
        cta_instruction = (
            "6. `cta`: Kesimpulan super singkat keunggulan HP (4-5 kata) + AJAKAN WAJIB untuk LIKE dan SUBSCRIBE "
            f"dalam Bahasa Inggris dengan diksi yang unik dan segar (1 Adegan, 12-16 kata). Gunakan inspirasi gaya #{var_idx + 1} ini "
            f"(parafrasekan dengan kreatif sesuai nama/keunggulan HP agar setiap video punya kalimat unik): {en_cta_style}"
        )
        cta_simple_hint = (
            "Khusus key `cta`, WAJIB berisi kesimpulan singkat + ajakan kreatif untuk LIKE dan SUBSCRIBE dalam Bahasa Inggris "
            f"(contoh gaya: {en_cta_fallback})."
        )
    else:
        cta_instruction = (
            "6. `cta`: Kesimpulan singkat keunggulan utama HP & ajakan CTA afiliasi standar soft selling di akhir "
            f"(1 Adegan, 11-15 kata). Gunakan gaya soft selling standar ini: {id_cta_style} "
            "DILARANG KERAS menambahkan istilah mengada-ada di luar spesifikasi HP seperti 'kuliah sore', 'anak kos', dsb."
        )
        cta_simple_hint = (
            "Khusus key `cta`, gunakan kesimpulan singkat + CTA afiliasi standar soft selling (contoh: "
            f"{id_cta_fallback}). Jangan gunakan tanda kutip di dalam nilai string dan jangan mengarang istilah seperti 'kuliah sore'."
        )

    if lang == "en":
        thumb_lang_rules = [
            "- `thumbnail_badge`, `thumbnail_headline`, and `thumbnail_specs` MUST BE 100% IN ENGLISH! DO NOT use any Indonesian words (such as 'LAYAR', 'BATERAI', 'KAMERA', 'HARGA', 'LAYAK', 'TAHAN AIR', 'KENCANG', 'STABIL').",
            "- `thumbnail_badge`: 2-3 punchy uppercase ENGLISH words (e.g. \"HONEST REVIEW!\", \"PRICE DROP!\", \"FLAGSHIP KILLER!\", \"WORTH BUYING?!\").",
            "- `thumbnail_headline`: 3-5 uppercase ENGLISH words with phone model + English hook (e.g. \"GALAXY S25 FE WORTH IT?!\", \"OPPO A6 PRO TOTAL BEAST!\").",
            "- `thumbnail_specs`: 3 short technical highlights in ENGLISH separated by ` • ` (e.g. \"120Hz AMOLED • Exynos 2400e • IP68 Waterproof\")."
        ]
    else:
        thumb_lang_rules = [
            "- Nilai `thumbnail_badge` berisi 2-3 kata huruf kapital singkat yang menarik perhatian dalam Bahasa Indonesia (contoh: \"TURUN HARGA!\" / \"SPEK FLAGSHIP!\" / \"REVIEW JUJUR!\").",
            "- Nilai `thumbnail_headline` berisi 3-5 kata huruf kapital singkat berupa nama seri HP + daya tarik utama dalam Bahasa Indonesia (contoh: \"SAMSUNG S25 FE MASIH LAYAK?!\").",
            "- Nilai `thumbnail_specs` berisi 3 poin spesifikasi inti singkat yang dipisahkan tanda ` • ` dalam Bahasa Indonesia (contoh: \"AMOLED 120Hz • Exynos 2400e • Tahan Air IP68\")."
        ]

    prompt = "\n".join([
        f"Judul Video Review: \"{video_title}\"",
        f"Durasi Total Video Sumber: {int(total_dur)} detik",
        f"Deskripsi Video: \"{video_desc[:2000]}\"",
        "",
        "Transkrip Voiceover Asli Video (dengan penanda detik):",
        short_transcript,
        "",
        "TUGAS ANALISIS VOICEOVER BAWAAN & PENYUSUNAN 6 BAB + SUB-ADEGAN VISUAL PRO-CLIPPER:",
        f"Analisa transkrip asli di atas, lalu petakan rentang waktu detik (`start_sec` dan `end_sec`) di video sumber serta tulis naskah voiceover **{lang_label}** untuk 6 BAB berikut beserta pemecahan sub-adegan (`scenes`) di dalamnya:",
        "1. `body_ip`: WAJIB diawali hook 1 kalimat singkat yang menggebrak dan langsung menyebut nama seri HP (contoh hook Bahasa Indonesia: 'Ini dia si jagoan baru yang bikin flagship lain ketar-ketir!' / contoh hook Bahasa Inggris: 'This beast just changed the game for mid-range phones!') + nama HP + desain bodi/ketebalan/bobot (Adegan 1) DAN sertifikasi ketahanan air/debu IP rating asli (Adegan 2) (total 15-17 kata).",
        "2. `screen_os`: Spesifikasi asli panel layar, ukuran inci, refresh rate (Hz), kecerahan (Adegan 1) DAN versi OS/UI bawaan (Adegan 2) (total 14-16 kata).",
        "3. `perf_mem`: Seri chipset asli & performa (Adegan 1) DAN kapasitas & jenis RAM (LPDDR), memori internal (UFS/eMMC), serta slot microSD (Adegan 2) (total 16-18 kata).",
        "4. `bat_feat`: Kapasitas baterai (mAh) & kecepatan charging (Watt) (Adegan 1) DAN fitur NFC, speaker stereo, serta sensor sidik jari (Adegan 2) (total 14-16 kata).",
        "5. `camera`: Resolusi kamera belakang utama (OIS/non-OIS) & kamera depan/selfie (Adegan 1) DAN kemampuan perekaman video depan & belakang maksimal beserta FPS asli (Adegan 2) (total 20-23 kata).",
        cta_instruction,
        "",
        "ATURAN WAJIB:",
        f"- Seluruh teks `script`, `caption`, `hashtags`, `thumbnail_badge`, `thumbnail_headline`, dan `thumbnail_specs` WAJIB 100% ditulis dalam **{lang_label}**.",
        "- Total gabungan kata dari seluruh `script` ke-6 bab WAJIB sekitar 90-100 kata agar seluruh kalimat hingga akhir CTA selesai diucapkan dengan utuh (< 55 detik).",
        f"- Jangan gunakan tanda kutip ganda (\") di dalam isi kalimat `script` atau `visual_focus` (gunakan {inch_rule} untuk ukuran layar).",
        "- Semua angka spesifikasi & FPS rekaman video wajib 100% asli dari transkrip/deskripsi.",
        "- JANGAN PERNAH menyalin candaan tidak relevan dari transkrip reviewer atau menambahkan kata seperti 'kuliah sore', 'anak kuliah', atau profesi spesifik yang tidak berhubungan dengan spesifikasi teknis HP.",
        "- HOOK WAJIB KUAT: Kalimat PERTAMA dari `script` bab body_ip HARUS berupa hook 1 kalimat singkat yang menggebrak dan langsung menyebut nama HP — DILARANG memulai dengan 'Halo', 'Hai', 'Yuk', 'Oke', 'Jadi', 'Nah', atau sapaan generik.",
        "- CTA ANTI-DUPLIKASI: Pastikan TIDAK ADA pengulangan kata yang sama berurutan di kalimat CTA (contoh salah: 'Baterai badak, baterai awet' — hapus kata duplikat).",
        "- Kembalikan HANYA objek JSON murni dengan key persis: body_ip, screen_os, perf_mem, bat_feat, camera, cta, caption, hashtags, thumbnail_badge, thumbnail_headline, thumbnail_specs.",
        "- Nilai `hashtags` WAJIB berupa string berisi 5-7 hashtag relevan yang SETIAP katanya diawali tanda pagar `#` (contoh: \"#SamsungS25FE #ReviewHP #GadgetIndonesia #Shorts\").",
        *thumb_lang_rules,
        "- Setiap bab (body_ip s/d cta) wajib memiliki key:",
        "  * `start_sec` (angka detik awal bab di video sumber)",
        "  * `end_sec` (angka detik akhir bab di video sumber)",
        "  * `script` (teks narasi utuh bab tersebut)",
        "  * `scenes` (array berisi 1-2 objek sub-adegan: `{\"scene_id\": \"...\", \"visual_focus\": \"...\", \"start_sec\": ..., \"end_sec\": ..., \"script\": \"potongan klausa narasi adegan ini\"}`). Pastikan gabungan `script` pada `scenes` sama persis dengan `script` babnya!"
    ])

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.35 if lang == "en" else 0.2,
            "responseMimeType": "application/json"
        }
    }
    res = call_gemini_json(payload, api_key)
    res = normalize_parsed_json_to_dict(res) if res else None

    # Jika skema bersarang gagal atau key bab kurang dari 4, coba prompt JSON datar sederhana (scenes akan dipecah otomatis oleh ensure_chapter_scenes)
    keys = ["body_ip", "screen_os", "perf_mem", "bat_feat", "camera", "cta"]
    if not isinstance(res, dict) or sum(1 for k in keys if k in res) < 4:
        print("    [!] Mencoba skema JSON ringkas untuk memastikan validitas 100%...", flush=True)
        simple_prompt = "\n".join([
            f"Judul Video: \"{video_title}\" (Durasi: {int(total_dur)}s)",
            f"Deskripsi: \"{video_desc[:1500]}\"",
            "Transkrip:",
            short_transcript[:10000],
            "",
            "Susun JSON murni dengan key persis: body_ip, screen_os, perf_mem, bat_feat, camera, cta, caption, hashtags, thumbnail_badge, thumbnail_headline, thumbnail_specs.",
            f"Setiap key bab (body_ip s/d cta) berisi objek: {{\"start_sec\": angka, \"end_sec\": angka, \"script\": \"narasi {lang_label} 15-20 kata sesuai spesifikasi asli di transkrip\"}}.",
            "HOOK WAJIB: script bab body_ip HARUS diawali hook 1 kalimat menggebrak yang langsung menyebut nama HP — DILARANG memulai dengan Halo/Hai/Yuk/Oke/Jadi.",
            "CTA ANTI-DUPLIKASI: Tidak boleh ada pengulangan kata berurutan di kalimat CTA.",
            cta_simple_hint
        ])
        simple_payload = {
            "contents": [{"parts": [{"text": simple_prompt}]}],
            "generationConfig": {"temperature": 0.25 if lang == "en" else 0.15, "responseMimeType": "application/json"}
        }
        res = call_gemini_json(simple_payload, api_key)
        res = normalize_parsed_json_to_dict(res) if res else None

    if not isinstance(res, dict):
        return None

    step = max(30.0, (total_dur - 45.0) / 6.0)
    for idx, k in enumerate(keys):
        default_s = 35.0 + idx * step
        default_e = min(total_dur - 10.0, default_s + step)
        val = res.get(k)
        if not isinstance(val, dict):
            res[k] = {"start_sec": default_s, "end_sec": default_e, "script": str(val or ""), "scenes": []}
        else:
            try:
                res[k]["start_sec"] = float(val.get("start_sec") or default_s)
            except Exception:
                res[k]["start_sec"] = default_s
            try:
                res[k]["end_sec"] = float(val.get("end_sec") or default_e)
            except Exception:
                res[k]["end_sec"] = default_e
            res[k]["script"] = sanitize_subtitle_text(val.get("script") or "")
            if not isinstance(val.get("scenes"), list):
                res[k]["scenes"] = []

    if "cta" in res and isinstance(res["cta"], dict):
        if lang == "en":
            enforced_cta = ensure_english_like_and_subscribe_cta(res["cta"].get("script", ""), en_cta_fallback)
        else:
            enforced_cta = ensure_indonesian_affiliate_soft_selling_cta(res["cta"].get("script", ""), id_cta_fallback)
        res["cta"]["script"] = enforced_cta
        if isinstance(res["cta"].get("scenes"), list) and len(res["cta"]["scenes"]) > 0 and isinstance(res["cta"]["scenes"][0], dict):
            res["cta"]["scenes"][0]["script"] = enforced_cta
    return res

def sanitize_subtitle_text(raw_text):
    text = str(raw_text or "").strip().strip('"').strip("'")
    text = re.sub(r"^(voice\s*over|narasi|naskah|script|vo|teks|bab\s*\d+|adegan\s*\d+)\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\*+", "", text)
    for pat in UNWANTED_HALLUCINATION_PATTERNS:
        text = re.sub(pat, "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    return " ".join(text.split())

def find_keyword_time_window_in_transcript(events, keywords, fallback_start, fallback_end, total_dur):
    """Mencari rentang detik spesifik di transkrip asli yang paling padat mengandung kata kunci sub-adegan."""
    if not events or not keywords:
        return fallback_start, fallback_end
    matched_times = []
    for ev_s, ev_e, txt in events:
        if ev_s < 20.0 or ev_s > (total_dur - 8.0):
            continue
        low_t = txt.lower()
        if any(kw in low_t for kw in keywords):
            matched_times.append((ev_s, ev_e))
    if not matched_times:
        return fallback_start, fallback_end
    in_chap = [(s, e) for s, e in matched_times if (fallback_start - 35.0) <= s <= (fallback_end + 35.0)]
    chosen = in_chap if in_chap else matched_times
    s_min = max(20.0, min(s for s, _ in chosen) - 6.0)
    e_max = min(total_dur - 8.0, max(e for _, e in chosen) + 10.0)
    if (e_max - s_min) < 12.0:
        e_max = min(total_dur - 8.0, s_min + 18.0)
    return s_min, e_max

def split_script_into_n_clauses(script_text, target_n):
    """Memecah kalimat bab menjadi N klausa adegan secara cerdas pada tanda baca atau kata penghubung alami."""
    clean_s = sanitize_subtitle_text(script_text)
    if target_n <= 1 or not clean_s:
        return [clean_s] if clean_s else [""]

    words = clean_s.split()
    if len(words) < 7:
        return [clean_s]

    # Cari titik potong terbaik di sekitar pertengahan kalimat (30% - 70% posisi kata)
    conjunctions = {
        "tapi", "namun", "berkat", "dengan", "didukung", "dipadu", "serta",
        "lengkap", "ditambah", "hadir", "menggunakan", "membawa", "dan", "untuk",
        "and", "but", "while", "with", "featuring", "paired", "plus", "running", "powered", "delivering"
    }
    best_split_idx = None
    best_score = -999.0
    n_w = len(words)
    mid_w = n_w / 2.0

    for i in range(max(3, int(n_w * 0.28)), min(n_w - 3, int(n_w * 0.75)) + 1):
        prev_word = words[i - 1]
        curr_word = re.sub(r"[^a-zA-Z0-9]", "", words[i]).lower()
        dist_penalty = abs(i - mid_w) * 0.45
        score = -dist_penalty
        if prev_word.endswith((".", "!", "?", ";", ":")):
            score += 8.0
        elif prev_word.endswith(","):
            score += 6.0
        if curr_word in conjunctions:
            score += 4.5
        if score > best_score:
            best_score = score
            best_split_idx = i

    if best_split_idx is None:
        best_split_idx = max(3, n_w // 2)

    part1 = " ".join(words[:best_split_idx]).strip()
    part2 = " ".join(words[best_split_idx:]).strip()
    return [p for p in (part1, part2) if p]

def ensure_chapter_scenes(chap_cfg, chap_data, events, total_dur):
    """
    Memastikan setiap bab memiliki daftar sub-adegan (`scenes`) yang lengkap:
    - Memiliki klausa VO (`script`), `visual_focus`, `keywords`, dan rentang `start_sec`..`end_sec` spesifik.
    - Jika AI belum memecah `scenes` atau hanya mengembalikan 1 item padahal template memiliki 2 sub-adegan,
      pecah klausa VO secara otomatis pada titik jeda kalimat/konjungsi dan petakan ke transkrip asli.
    """
    templates = chap_cfg.get("scene_templates", [])
    target_n = max(1, len(templates))
    chap_s = float(chap_data.get("start_sec", 40.0))
    chap_e = float(chap_data.get("end_sec", min(total_dur - 10.0, chap_s + 90.0)))
    chap_script = sanitize_subtitle_text(chap_data.get("script", ""))

    raw_scenes = chap_data.get("scenes", [])
    valid_raw = []
    if isinstance(raw_scenes, list):
        for sc in raw_scenes:
            if isinstance(sc, dict) and sanitize_subtitle_text(sc.get("script", "")):
                valid_raw.append(sc)

    if len(valid_raw) >= target_n:
        clauses = [sanitize_subtitle_text(sc.get("script", "")) for sc in valid_raw[:target_n]]
        if len(valid_raw) > target_n:
            extra = " ".join(sanitize_subtitle_text(sc.get("script", "")) for sc in valid_raw[target_n:])
            clauses[-1] = f"{clauses[-1]} {extra}".strip()
    else:
        base_text = chap_script if chap_script else " ".join(sanitize_subtitle_text(sc.get("script", "")) for sc in valid_raw)
        clauses = split_script_into_n_clauses(base_text, target_n)

    built_scenes = []
    for idx, cl_text in enumerate(clauses):
        tmpl = templates[min(idx, len(templates) - 1)] if templates else {
            "scene_id": f"{chap_cfg['id']}_{idx+1}",
            "visual_focus": chap_cfg["title"],
            "keywords": chap_cfg["keywords"]
        }
        raw_sc = valid_raw[idx] if idx < len(valid_raw) else {}
        kws = list(dict.fromkeys((raw_sc.get("keywords") or []) + tmpl.get("keywords", [])))

        sub_span = max(15.0, (chap_e - chap_s) / max(1, len(clauses)))
        def_s = chap_s + idx * sub_span
        def_e = min(total_dur - 8.0, def_s + sub_span)

        try:
            sc_s = float(raw_sc.get("start_sec") or def_s)
            sc_e = float(raw_sc.get("end_sec") or def_e)
        except Exception:
            sc_s, sc_e = def_s, def_e

        # Pertajam rentang detik sub-adegan berdasarkan kemunculan kata kunci di transkrip asli
        kw_s, kw_e = find_keyword_time_window_in_transcript(events, kws, sc_s, sc_e, total_dur)

        # Pastikan klausa memiliki tanda baca akhir agar TTS memberi jeda napas alami
        if cl_text and cl_text[-1] not in ".!?,;:":
            cl_text += "," if idx < len(clauses) - 1 else "."

        built_scenes.append({
            "scene_id": tmpl.get("scene_id", f"{chap_cfg['id']}_{idx+1}"),
            "chapter_id": chap_cfg["id"],
            "chapter_title": chap_cfg["title"],
            "visual_focus": str(raw_sc.get("visual_focus") or tmpl.get("visual_focus") or chap_cfg["title"]),
            "keywords": kws,
            "start_sec": kw_s,
            "end_sec": kw_e,
            "script": cl_text
        })

    # Rekonsiliasi script bab agar 100% identik dengan gabungan klausa sub-adegan
    rejoined_chap_script = " ".join(sc["script"] for sc in built_scenes).strip()
    if rejoined_chap_script and rejoined_chap_script[-1] not in ".!?":
        rejoined_chap_script += "."
    chap_data["script"] = rejoined_chap_script
    chap_data["scenes"] = built_scenes
    return built_scenes

def request_tts_pcm_bytes(prompt_text, api_key, voice_name, models_to_try):
    clean_voice = str(voice_name or "Despina").strip().capitalize()
    payload = {
        "contents": [{"parts": [{"text": prompt_text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": clean_voice}
                }
            }
        }
    }
    for model_name in models_to_try:
        if not model_name:
            continue
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        for attempt in range(2):
            try:
                resp = requests.post(url, json=payload, timeout=60)
                if resp.status_code == 404:
                    break
                if resp.status_code == 429:
                    print(f"    [!] TTS {model_name} limit (429) -> Fallback ke model TTS berikutnya...", flush=True)
                    time.sleep(1.5)
                    break
                resp.raise_for_status()
                data = resp.json()
                raw_bytes = base64.b64decode(data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
                pcm_bytes = raw_bytes[44:] if raw_bytes[:4] == b"RIFF" else raw_bytes
                if len(pcm_bytes) % 2 != 0:
                    pcm_bytes = pcm_bytes[:-1]
                return pcm_bytes, model_name
            except Exception:
                time.sleep(1.5)
    return None, None

def is_pcm_tail_cut_off(pcm_bytes, sr=24000):
    """Mendeteksi apakah akhir audio TTS terpotong di tengah kata (karena batas buffer ~61.2s Gemini TTS)."""
    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
    dur = len(samples) / float(sr)
    if len(samples) < sr:
        return False
    hop = int(sr * 0.01)
    n_win = len(samples) // hop
    rms = np.sqrt(np.mean(samples[:n_win * hop].reshape((n_win, hop)) ** 2, axis=1))
    thresh = max(90.0, np.percentile(rms, 10) + (np.percentile(rms, 95) - np.percentile(rms, 10)) * 0.08)
    # Jika 80ms terakhir masih memiliki energi suara tinggi atau durasi mentok di batas ~60.8s+
    tail_rms = float(np.mean(rms[-8:]))
    return (tail_rms > thresh * 1.35) or (dur >= 60.5 and float(np.max(rms[-15:])) > thresh)

def stitch_clean_cta_onto_body(body_and_cta_pcm, cta_pcm, chapter_scripts, sr=24000):
    """
    Memotong bagian CTA yang terpotong di ujung `body_and_cta_pcm` tepat pada jeda hening sebelum Bab 6 (CTA),
    lalu menyambungkan `cta_pcm` yang utuh + bantalan hening 0.45s di akhir.
    """
    samples = np.frombuffer(body_and_cta_pcm, dtype=np.int16).astype(np.float32)
    hop = int(sr * 0.01)
    n_win = len(samples) // hop
    rms = np.sqrt(np.mean(samples[:n_win * hop].reshape((n_win, hop)) ** 2, axis=1))
    if len(rms) >= 5:
        rms = np.convolve(rms, np.ones(5) / 5.0, mode="same")
    thresh = max(90.0, np.percentile(rms, 10) + (np.percentile(rms, 95) - np.percentile(rms, 10)) * 0.075)
    is_sp = (rms > thresh).astype(np.int32)

    weights = [estimate_spoken_weight(cs, ".") for cs in chapter_scripts]
    body_frac = sum(weights[:-1]) / max(1.0, sum(weights))
    approx_cut_s = (len(samples) / float(sr)) * body_frac

    # Cari lembah hening terbaik di sekitar batas Bab 5 -> Bab 6
    best_cut_win = int(round(approx_cut_s / 0.01))
    best_score = 999.0
    in_sil, s0 = False, 0
    for i in range(int(n_win * 0.65), n_win - 10):
        if is_sp[i] == 0:
            if not in_sil:
                in_sil, s0 = True, i
        else:
            if in_sil:
                sil_len = i - s0
                if sil_len >= 8:
                    mid_w = (s0 + i) // 2
                    mid_s = mid_w * 0.01
                    dist = abs(mid_s - approx_cut_s)
                    if dist <= 6.5:
                        score = dist - (sil_len * 0.01 * 2.0)
                        if score < best_score:
                            best_score = score
                            best_cut_win = mid_w
                in_sil = False

    body_int16 = np.frombuffer(body_and_cta_pcm, dtype=np.int16)[:best_cut_win * hop]
    cta_int16 = np.frombuffer(cta_pcm, dtype=np.int16)

    # Trim hening berlebih di awal CTA baru
    cta_f = cta_int16.astype(np.float32)
    c_win = len(cta_f) // hop
    if c_win > 5:
        c_rms = np.sqrt(np.mean(cta_f[:c_win * hop].reshape((c_win, hop)) ** 2, axis=1))
        c_sp = np.where(c_rms > 90.0)[0]
        if len(c_sp) > 0:
            start_pad_win = max(0, int(c_sp[0]) - 5)
            end_pad_win = min(c_win, int(c_sp[-1]) + 8)
            cta_int16 = cta_int16[start_pad_win * hop:end_pad_win * hop]

    pause_between = np.zeros(int(sr * 0.28), dtype=np.int16)
    tail_pad = np.zeros(int(sr * 0.45), dtype=np.int16)
    combined = np.concatenate([body_int16, pause_between, cta_int16, tail_pad])
    return combined.tobytes()

def generate_single_gemini_tts_chapters(chapter_scripts, out_wav, api_key, voice_name="Despina", custom_model=None):
    models_to_try = [custom_model] if custom_model else list(TTS_MODELS)
    cleaned_chaps = []
    for s in chapter_scripts:
        cs = sanitize_subtitle_text(s)
        if cs and cs[-1] not in ".!?":
            cs += "."
        cleaned_chaps.append(cs)

    # Gunakan spasi tunggal antar-bab (bukan \n\n) agar Gemini TTS tidak menyisipkan jeda hening > 1 detik per bab
    joined_prompt_text = " ".join(cleaned_chaps)
    pcm_bytes, used_model = request_tts_pcm_bytes(joined_prompt_text, api_key, voice_name, models_to_try)
    if not pcm_bytes:
        return False, None

    # Cek apakah kalimat terakhir (CTA) terpotong akibat batas durasi maksimum (~61.2s) Gemini TTS
    if len(cleaned_chaps) >= 2 and is_pcm_tail_cut_off(pcm_bytes, 24000):
        print("    [!] Terdeteksi ujung audio CTA terpotong batas buffer TTS -> Menambal audio Bab 6 (CTA) secara utuh...", flush=True)
        cta_pcm, _ = request_tts_pcm_bytes(cleaned_chaps[-1], api_key, voice_name, [used_model] + models_to_try)
        if cta_pcm:
            pcm_bytes = stitch_clean_cta_onto_body(pcm_bytes, cta_pcm, cleaned_chaps, 24000)

    # Pastikan selalu ada bantalan hening minimal 0.40 detik di ujung akhir WAV agar kata terakhir tidak pernah terpenggal
    tail_silence = np.zeros(int(24000 * 0.40), dtype=np.int16).tobytes()
    pcm_bytes = pcm_bytes + tail_silence

    with wave.open(out_wav, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm_bytes)
    return True, used_model

def expand_indo_tech_for_timing(text):
    s = text.upper()
    repls = [
        (r"\b1080P\b", "SERIBU DELAPAN PULUH PE"),
        (r"\b720P\b", "TUJUH RATUS DUA PULUH PE"),
        (r"\b4K\b", "EMPAT KA"),
        (r"\b2K\b", "DUA KA"),
        (r"\b8K\b", "DELAPAN KA"),
        (r"\bLPDDR4X\b", "EL PE DE DE ER EMPAT EKS"),
        (r"\bLPDDR5X\b", "EL PE DE DE ER LIMA EKS"),
        (r"\bLPDDR5\b", "EL PE DE DE ER LIMA"),
        (r"\bLPDDR4\b", "EL PE DE DE ER EMPAT"),
        (r"\bUFS\b", "YU EF ES"),
        (r"\bEMMC\b", "I EM EM SI"),
        (r"\bNON-OIS\b", "NON O I ES"),
        (r"\bOIS\b", "O I ES"),
        (r"\bEIS\b", "E I ES"),
        (r"\bNFC\b", "EN EF SI"),
        (r"\bFPS\b", "EF PE ES"),
        (r"\bMAH\b", "MILI AMPER"),
        (r"\bGB\b", "GIGABAIT"),
        (r"\bTB\b", "TERABAIT"),
        (r"\bMPX\b", "MEGAPIKSEL"),
        (r"\bMP\b", "MEGAPIKSEL"),
        (r"\bHZ\b", "HERTZ"),
        (r"\bW\b", "WATT"),
        (r"\bIP68\b", "I PE ENAM DELAPAN"),
        (r"\bIP69\b", "I PE ENAM SEMBILAN"),
        (r"\bIP67\b", "I PE ENAM TUJUH"),
        (r"\bIP65\b", "I PE ENAM LIMA"),
        (r"\bIP64\b", "I PE ENAM EMPAT"),
        (r"\bIP54\b", "I PE LIMA EMPAT"),
        (r"\bIP53\b", "I PE LIMA TIGA"),
        (r"\bSD\s*CARD\b", "ES DE KARD"),
        (r"\bMICROSD\b", "MIKRO ES DE"),
        (r"\b5000\b", "LIMA RIBU"),
        (r"\b6000\b", "ENAM RIBU"),
        (r"\b7000\b", "TUJUH RIBU"),
        (r"\b1000\b", "SERIBU"),
        (r"\b512\b", "LIMA RATUS DUA BELAS"),
        (r"\b256\b", "DUA RATUS LIMA PULUH ENAM"),
        (r"\b128\b", "SERATUS DUA PULUH DELAPAN"),
        (r"\b144\b", "SERATUS EMPAT PULUH EMPAT"),
        (r"\b120\b", "SERATUS DUA PULUH"),
        (r"\b108\b", "SERATUS DELAPAN"),
        (r"\b100\b", "SERATUS"),
        (r"\b90\b", "SEMBILAN PULUH"),
        (r"\b67\b", "ENAM PULUH TUJUH"),
        (r"\b64\b", "ENAM PULUH EMPAT"),
        (r"\b60\b", "ENAM PULUH"),
        (r"\b50\b", "LIMA PULUH"),
        (r"\b48\b", "EMPAT PULUH DELAPAN"),
        (r"\b45\b", "EMPAT PULUH LIMA"),
        (r"\b33\b", "TIGA PULUH TIGA"),
        (r"\b32\b", "TIGA PULUH DUA"),
        (r"\b30\b", "TIGA PULUH"),
        (r"\b24\b", "DUA PULUH EMPAT"),
        (r"\b18\b", "DELAPAN BELAS"),
        (r"\b16\b", "ENAM BELAS"),
        (r"\b13\b", "TIGA BELAS"),
        (r"\b12\b", "DUA BELAS"),
    ]
    for pat, rep in repls:
        s = re.sub(pat, rep, s)
    digit_map = {
        "0": " NOL ", "1": " SATU ", "2": " DUA ", "3": " TIGA ", "4": " EMPAT ",
        "5": " LIMA ", "6": " ENAM ", "7": " TUJUH ", "8": " DELAPAN ", "9": " SEMBILAN "
    }
    for d, w in digit_map.items():
        s = s.replace(d, w)
    return s

def estimate_spoken_weight(text_chunk, raw_punct=""):
    s = text_chunk.upper()
    digits = len(re.findall(r"\d", s))
    units_found = len(re.findall(r"\b(GB|TB|MAH|MP|MPX|W|HZ|FPS|OIS|4K|1080P|LPDDR4X|LPDDR5X)\b", s))
    
    spoken_expanded = expand_indo_tech_for_timing(text_chunk)
    vowels = len(re.findall(r"[AEIOU]", spoken_expanded))
    letters = len(re.sub(r"[^A-Z]", "", spoken_expanded))
    
    weight = max(2.2, vowels * 1.55 + letters * 0.28 + (digits * 1.4) + (units_found * 1.8))
    
    if raw_punct in ".!?":
        weight += 3.0
    elif raw_punct in ",;:":
        weight += 1.4
    return weight

def split_clause_into_2_3_words(clause_text):
    words = [w.strip() for w in clause_text.split() if w.strip()]
    if not words:
        return []
    chunks = []
    n = len(words)
    idx = 0
    while idx < n:
        rem = n - idx
        if rem <= 3:
            chunks.append(" ".join(words[idx:n]))
            break
        elif rem == 4:
            chunks.append(" ".join(words[idx:idx + 2]))
            chunks.append(" ".join(words[idx + 2:idx + 4]))
            break
        else:
            cand_3 = " ".join(words[idx:idx + 3])
            if len(cand_3) <= 17 and not re.search(r"\d+.*?\d+", cand_3):
                chunks.append(cand_3)
                idx += 3
            else:
                chunks.append(" ".join(words[idx:idx + 2]))
                idx += 2
    return chunks

def format_ass_time(seconds):
    seconds = max(0.0, seconds)
    cs = int(round((seconds % 1) * 100))
    if cs >= 100:
        seconds += 1
        cs = 0
    s = int(seconds)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"

def format_srt_time(seconds):
    seconds = max(0.0, seconds)
    ms = int(round((seconds % 1) * 1000))
    if ms >= 1000:
        seconds += 1
        ms = 0
    s = int(seconds)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def analyze_wav_scenes_and_build_subtitles(chapters_with_scenes, wav_path, ass_path, srt_backup_path, sync_json_path=None):
    """
    Smart Acoustic Scene Aligner:
    1. Mendeteksi Major Valleys (>= 80ms hening) untuk batas antar-Bab dan Micro Valleys (>= 30ms hening / lembah energi RMS lokal)
       untuk batas antar Sub-Adegan di dalam Bab.
    2. Menyusun chunk subtitle 2-3 kata di dalam setiap Sub-Adegan sehingga TIDAK ADA subtitle yang menyeberangi batas adegan.
    3. Jika sebuah Sub-Adegan berdurasi > 3.15s, membaginya menjadi 2 cut visual yang titik potongnya DIKUNCI PERSIS
       pada jeda di antara dua chunk subtitle 2-3 kata (tidak pernah memotong di tengah kata/subtitle).
    """
    with wave.open(wav_path, "rb") as wf:
        sr = wf.getframerate()
        n_frames = wf.getnframes()
        raw_pcm = wf.readframes(n_frames)

    samples = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32)
    audio_dur = len(samples) / float(sr)

    hop = max(1, int(sr * 0.01))
    num_win = max(1, len(samples) // hop)
    trimmed = samples[:num_win * hop].reshape((num_win, hop))
    rms = np.sqrt(np.mean(trimmed ** 2, axis=1))
    if len(rms) >= 5:
        rms = np.convolve(rms, np.ones(5) / 5.0, mode="same")

    noise_floor = np.percentile(rms, 10)
    peak_val = np.percentile(rms, 95)
    thresh = max(90.0, noise_floor + (peak_val - noise_floor) * 0.075)
    is_speech = (rms > thresh).astype(np.int32)

    # Jembatani celah mikro <= 30ms agar plosif konsonan tidak salah dianggap jeda kalimat,
    # tetapi biarkan jeda >= 40ms tetap terlihat untuk deteksi Micro Valley antar-klausa adegan
    last_on = -100
    for i in range(num_win):
        if is_speech[i] == 1:
            if 0 < (i - last_on) <= 3:
                is_speech[last_on:i] = 1
            last_on = i

    speech_indices = np.where(is_speech == 1)[0]
    first_speech_idx = int(speech_indices[0]) if len(speech_indices) > 0 else 0
    last_speech_idx = int(speech_indices[-1]) if len(speech_indices) > 0 else num_win - 1

    # JANGAN PERNAH memotong durasi di bawah panjang audio asli (hapus batas min 59.5s agar CTA di akhir 100% utuh!)
    last_speech_sec = (last_speech_idx + 1) * 0.01
    target_final_dur = max(audio_dur + 0.55, last_speech_sec + 0.80)

    major_valleys = []
    micro_valleys = []
    in_sil = False
    sil_start = 0
    for i in range(first_speech_idx, last_speech_idx + 1):
        if is_speech[i] == 0:
            if not in_sil:
                in_sil = True
                sil_start = i
        else:
            if in_sil:
                sil_len = i - sil_start
                v_obj = {
                    "start_s": sil_start * 0.01,
                    "end_s": i * 0.01,
                    "mid_s": ((sil_start + i) / 2.0) * 0.01,
                    "dur_s": sil_len * 0.01,
                    "used": False
                }
                if sil_len >= 8:
                    major_valleys.append(v_obj)
                    micro_valleys.append(dict(v_obj))
                elif sil_len >= 3:
                    micro_valleys.append(v_obj)
                in_sil = False

    active_weights = np.where(is_speech == 1, 1.0, 0.10)
    active_weights[:first_speech_idx] = 0.0
    if last_speech_idx + 1 < num_win:
        active_weights[last_speech_idx + 1:] = 0.0
    cum_speech = np.cumsum(active_weights)
    total_speech_units = max(1.0, float(cum_speech[-1]))

    def speech_fraction_to_time(frac):
        target_u = np.clip(frac, 0.0, 1.0) * total_speech_units
        idx = int(np.searchsorted(cum_speech, target_u))
        return min(num_win - 1, max(0, idx)) * 0.01

    def time_to_speech_fraction(sec):
        idx = min(num_win - 1, max(0, int(round(sec / 0.01))))
        return float(cum_speech[idx]) / total_speech_units

    def find_local_rms_dip(expected_s, min_s, max_s):
        """Mencari titik energi suara terendah (lembah mikro antar-kata) jika pembicara menyambung klausa tanpa jeda panjang."""
        lo = max(0, int(round(max(min_s, expected_s - 0.55) / 0.01)))
        hi = min(num_win - 1, int(round(min(max_s, expected_s + 0.55) / 0.01)))
        if hi <= lo + 2:
            return max(min_s, min(max_s, expected_s))
        window_rms = rms[lo:hi + 1]
        norm_rms = window_rms / max(1.0, float(np.max(window_rms)))
        idxs = np.arange(lo, hi + 1) * 0.01
        dist_pen = np.abs(idxs - expected_s) * 0.55
        best_local = int(np.argmin(norm_rms + dist_pen))
        return (lo + best_local) * 0.01

    # Tahap A: Kunci batas waktu eksak antar 6 Bab menggunakan Major Valleys
    chapter_scripts = [c["script"] for c in chapters_with_scenes]
    chap_weights = [estimate_spoken_weight(cs, ".") for cs in chapter_scripts]
    total_chap_w = max(1.0, sum(chap_weights))

    chap_boundaries = [0.0]
    cum_cw = 0.0
    for b_idx in range(len(chapter_scripts) - 1):
        cum_cw += chap_weights[b_idx]
        exp_frac = cum_cw / total_chap_w
        exp_sec = speech_fraction_to_time(exp_frac)
        prev_bound = chap_boundaries[-1]

        best_v = None
        best_score = 999.0
        for v in major_valleys:
            if v["used"] or v["mid_s"] <= (prev_bound + 2.8):
                continue
            dist = abs(v["mid_s"] - exp_sec)
            if dist <= 2.2:
                score = dist - (v["dur_s"] * 1.6)
                if score < best_score:
                    best_score = score
                    best_v = v

        if best_v is not None:
            best_v["used"] = True
            chap_boundaries.append(best_v["mid_s"])
        else:
            dip_s = find_local_rms_dip(exp_sec, prev_bound + 2.8, target_final_dur - 2.5)
            chap_boundaries.append(dip_s)

    chap_boundaries.append(target_final_dur)

    # Tahap B: Di dalam setiap Bab, kunci batas waktu eksak per Sub-Adegan dan bangun Subtitle + Visual Cuts yang terkunci
    timed_subtitles = []
    all_visual_cuts = []
    sync_report = []

    for c_idx, chap_obj in enumerate(chapters_with_scenes):
        c_win_start = chap_boundaries[c_idx]
        c_win_end = chap_boundaries[c_idx + 1]
        scenes = chap_obj.get("scenes", [])
        if not scenes:
            continue

        # Hitung batas waktu tiap Sub-Adegan di dalam Bab ini
        sc_weights = [
            estimate_spoken_weight(sc["script"], sc["script"][-1] if sc["script"] and sc["script"][-1] in ".!?,;:" else ",")
            for sc in scenes
        ]
        tot_sc_w = max(1.0, sum(sc_weights))
        chap_f0 = time_to_speech_fraction(c_win_start)
        chap_f1 = max(chap_f0 + 0.001, time_to_speech_fraction(c_win_end))

        scene_boundaries = [c_win_start]
        cum_sw = 0.0
        for s_idx in range(len(scenes) - 1):
            cum_sw += sc_weights[s_idx]
            exp_sf = chap_f0 + (chap_f1 - chap_f0) * (cum_sw / tot_sc_w)
            exp_s_sec = speech_fraction_to_time(exp_sf)
            prev_s_bound = scene_boundaries[-1]
            min_allowed = prev_s_bound + 1.45
            max_allowed = c_win_end - 1.35

            best_sv = None
            best_sscore = 999.0
            for mv in micro_valleys:
                if mv["used"] or mv["mid_s"] < min_allowed or mv["mid_s"] > max_allowed:
                    continue
                dist = abs(mv["mid_s"] - exp_s_sec)
                if dist <= 1.15:
                    score = dist - (mv["dur_s"] * 1.4)
                    if score < best_sscore:
                        best_sscore = score
                        best_sv = mv

            if best_sv is not None:
                best_sv["used"] = True
                scene_boundaries.append(best_sv["mid_s"])
            else:
                dip_sec = find_local_rms_dip(exp_s_sec, min_allowed, max_allowed)
                scene_boundaries.append(dip_sec)

        scene_boundaries.append(c_win_end)

        # Tahap C: Untuk setiap Sub-Adegan, bangun chunk subtitle 2-3 kata dan tentukan titik potong visual (cut)
        for s_idx, sc_obj in enumerate(scenes):
            sc_start = scene_boundaries[s_idx]
            sc_end = scene_boundaries[s_idx + 1]
            sc_dur = max(0.5, sc_end - sc_start)

            i0 = max(0, int(round(sc_start / 0.01)))
            i1 = min(num_win - 1, int(round(sc_end / 0.01)))
            local_speech = np.where(is_speech[i0:i1 + 1] == 1)[0]
            if len(local_speech) > 0:
                sp_start = max(sc_start, (i0 + int(local_speech[0])) * 0.01)
                sp_end = min(sc_end - 0.02, (i0 + int(local_speech[-1]) + 1) * 0.01)
                if sp_end <= sp_start + 0.15:
                    sp_start = sc_start + 0.03
                    sp_end = max(sp_start + 0.25, sc_end - 0.03)
            else:
                sp_start = sc_start + 0.03
                sp_end = max(sp_start + 0.25, sc_end - 0.03)

            clean_sc_text = sanitize_subtitle_text(sc_obj.get("script", ""))
            punct = clean_sc_text[-1] if clean_sc_text and clean_sc_text[-1] in ".!?,;:" else ""
            ch_list = split_clause_into_2_3_words(clean_sc_text)
            if not ch_list:
                ch_list = [clean_sc_text or chap_obj["title"]]
            ch_weights = [
                estimate_spoken_weight(ch, punct if j == len(ch_list) - 1 else "")
                for j, ch in enumerate(ch_list)
            ]

            f_s = time_to_speech_fraction(sp_start)
            f_e = max(f_s + 0.0005, time_to_speech_fraction(sp_end))
            tot_w = max(1.0, sum(ch_weights))
            loc_w = 0.0

            scene_sub_items = []
            for j_idx, (ch_str, cw) in enumerate(zip(ch_list, ch_weights)):
                cf0 = f_s + (f_e - f_s) * (loc_w / tot_w)
                loc_w += cw
                cf1 = f_s + (f_e - f_s) * (loc_w / tot_w)

                t0 = sp_start if j_idx == 0 else speech_fraction_to_time(cf0)
                t1 = sp_end if j_idx == len(ch_list) - 1 else speech_fraction_to_time(cf1)
                t0 = max(sp_start, t0)
                t1 = max(t0 + 0.13, min(sp_end, t1))

                disp = re.sub(r"[.!?,;:]+$", "", ch_str).strip().upper()
                if disp:
                    scene_sub_items.append((t0, t1, disp))
                    timed_subtitles.append((t0, t1, disp))

            # Penentuan Cut Visual Cerdas di dalam Sub-Adegan:
            # Bagi Sub-Adegan menjadi N cut visual (target ~1.8s - 2.8s per cut) di mana setiap titik pergantian cut
            # DIKUNCI PERSIS di batas selesai chunk subtitle 2-3 kata (tidak pernah memotong di tengah kata/subtitle)!
            scene_cuts = []
            target_n_cuts = max(1, min(len(scene_sub_items), int(round(sc_dur / 2.25))))
            if target_n_cuts >= 2 and len(scene_sub_items) >= target_n_cuts:
                split_points = [sc_start]
                sub_groups = []
                prev_idx = 0
                for g_i in range(1, target_n_cuts):
                    cut_sub_idx = int(round(g_i * len(scene_sub_items) / float(target_n_cuts)))
                    cut_sub_idx = max(prev_idx + 1, min(len(scene_sub_items) - (target_n_cuts - g_i), cut_sub_idx))
                    t_bound = (scene_sub_items[cut_sub_idx - 1][1] + scene_sub_items[cut_sub_idx][0]) / 2.0
                    if (t_bound - split_points[-1]) >= 1.15 and (sc_end - t_bound) >= 1.15:
                        split_points.append(t_bound)
                        sub_groups.append(scene_sub_items[prev_idx:cut_sub_idx])
                        prev_idx = cut_sub_idx
                split_points.append(sc_end)
                sub_groups.append(scene_sub_items[prev_idx:])

                if len(sub_groups) == len(split_points) - 1:
                    for g_idx, grp in enumerate(sub_groups):
                        c_s = split_points[g_idx]
                        c_e = split_points[g_idx + 1]
                        scene_cuts.append({
                            "cut_start_s": c_s,
                            "cut_end_s": c_e,
                            "duration_s": c_e - c_s,
                            "spoken_text": " ".join(x[2] for x in grp)
                        })

            if not scene_cuts:
                scene_cuts.append({
                    "cut_start_s": sc_start,
                    "cut_end_s": sc_end,
                    "duration_s": sc_dur,
                    "spoken_text": " ".join(x[2] for x in scene_sub_items)
                })

            sc_obj["audio_start_s"] = round(sc_start, 3)
            sc_obj["audio_end_s"] = round(sc_end, 3)
            sc_obj["audio_dur_s"] = round(sc_dur, 3)
            sc_obj["visual_cuts"] = scene_cuts

            for cut_i, cut_info in enumerate(scene_cuts, 1):
                all_visual_cuts.append({
                    "chap_idx": c_idx + 1,
                    "scene_idx": s_idx + 1,
                    "cut_in_scene_idx": cut_i,
                    "chapter_id": chap_obj["id"],
                    "chapter_title": chap_obj["title"],
                    "scene_id": sc_obj["scene_id"],
                    "visual_focus": sc_obj["visual_focus"],
                    "keywords": sc_obj["keywords"],
                    "source_start_sec": sc_obj["start_sec"],
                    "source_end_sec": sc_obj["end_sec"],
                    "scene_vo_script": sc_obj["script"],
                    "cut_spoken_text": cut_info["spoken_text"],
                    "audio_start_s": cut_info["cut_start_s"],
                    "audio_end_s": cut_info["cut_end_s"],
                    "duration_s": cut_info["duration_s"]
                })

            sync_report.append({
                "chapter_index": c_idx + 1,
                "chapter_id": chap_obj["id"],
                "scene_id": sc_obj["scene_id"],
                "visual_focus": sc_obj["visual_focus"],
                "vo_clause": sc_obj["script"],
                "source_video_zone": [round(sc_obj["start_sec"], 1), round(sc_obj["end_sec"], 1)],
                "audio_window_sec": [round(sc_start, 3), round(sc_end, 3)],
                "audio_duration_sec": round(sc_dur, 3),
                "subtitles": [
                    {"start": round(t0, 3), "end": round(t1, 3), "text": txt}
                    for t0, t1, txt in scene_sub_items
                ],
                "visual_cuts": [
                    {
                        "start": round(c["cut_start_s"], 3),
                        "end": round(c["cut_end_s"], 3),
                        "duration": round(c["duration_s"], 3),
                        "spoken_text": c["spoken_text"]
                    }
                    for c in scene_cuts
                ]
            })

    ass_header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: YellowBox1080,Sans,54,&H00000000,&H00000000,&H0000E5FF,&H0000E5FF,-1,0,0,0,100,100,1,0,3,14,0,2,45,45,285,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    ass_events = []
    srt_lines = []
    for idx, (st, et, text_up) in enumerate(timed_subtitles, 1):
        pop_tag = r"{\fscx112\fscy112\t(0,65,\fscx100\fscy100)}"
        ass_events.append(f"Dialogue: 0,{format_ass_time(st)},{format_ass_time(et)},YellowBox1080,,0,0,0,,{pop_tag} {text_up} ")
        srt_lines.append(f"{idx}\n{format_srt_time(st)} --> {format_srt_time(et)}\n{text_up}\n\n")

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_header + "\n".join(ass_events) + "\n")
    with open(srt_backup_path, "w", encoding="utf-8") as f:
        f.writelines(srt_lines)

    if sync_json_path:
        with open(sync_json_path, "w", encoding="utf-8") as f:
            json.dump({
                "total_audio_dur_sec": round(audio_dur, 3),
                "target_final_dur_sec": round(target_final_dur, 3),
                "total_scenes": len(sync_report),
                "total_visual_cuts": len(all_visual_cuts),
                "scenes": sync_report
            }, f, indent=2, ensure_ascii=False)

    chapter_durations = [chap_boundaries[i + 1] - chap_boundaries[i] for i in range(len(chapter_scripts))]
    return chapter_durations, target_final_dur, all_visual_cuts

def has_animated_subscribe_badge(frames_bgr):
    """
    Mendeteksi kemunculan animasi tombol Subscribe YouTube / pop-up lower-third channel
    yang bergerak masuk/keluar pada rentang frame:
    1. Mendeteksi kotak/pil warna merah digital murni (#FF0000 / #CC0000) dengan teks putih tajam di dalamnya
       yang muncul pada area overlay (y: 42%..95%) dan memiliki variasi kemunculan antar-frame (animasi pop-up).
    2. Mendeteksi kartu pop-up lower-third putih/hitam solid digital dengan tombol merah di dalamnya.
    """
    if not frames_bgr:
        return False

    red_badge_ratios = []
    white_card_with_red = []

    for fr in frames_bgr:
        if fr is None or fr.size == 0:
            continue
        h, w = fr.shape[:2]
        # Area tempat tombol subscribe / pop-up channel biasanya bergerak (tengah-bawah hingga bawah)
        roi = fr[int(h * 0.42):int(h * 0.95), int(w * 0.04):int(w * 0.96)]
        if roi.size == 0:
            continue
        rh, rw = roi.shape[:2]
        roi_area = float(max(1, rh * rw))

        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        # Merah YouTube digital (#FF0000 / #CC0000): Hue 0..8 atau 172..180, Sat sangat tinggi (>= 165), Val >= 150
        m1 = cv2.inRange(hsv, np.array([0, 165, 150], dtype=np.uint8), np.array([8, 255, 255], dtype=np.uint8))
        m2 = cv2.inRange(hsv, np.array([172, 165, 150], dtype=np.uint8), np.array([180, 255, 255], dtype=np.uint8))
        red_mask = cv2.bitwise_or(m1, m2)

        # Putih murni digital untuk teks "SUBSCRIBE" / "DISUBSCRIBE" atau background pop-up
        white_mask = cv2.inRange(hsv, np.array([0, 0, 220], dtype=np.uint8), np.array([180, 32, 255], dtype=np.uint8))

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
        red_closed = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(red_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        frame_best_badge_ratio = 0.0
        has_sharp_badge = False

        for cnt in contours:
            x, y, cw, ch = cv2.boundingRect(cnt)
            box_area = float(cw * ch)
            frac = box_area / roi_area
            # Ukuran wajar tombol subscribe di frame vertikal (0.6% s/d 18% dari area ROI)
            if frac < 0.006 or frac > 0.18:
                continue
            aspect = cw / float(max(1, ch))
            # Bentuk tombol / pil horizontal (rasio lebar:tinggi antara 1.6 s/d 6.8)
            if not (1.6 <= aspect <= 6.8):
                continue

            sub_red = red_mask[y:y + ch, x:x + cw]
            sub_white = white_mask[y:y + ch, x:x + cw]
            red_fill = float(np.count_nonzero(sub_red)) / box_area
            white_fill = float(np.count_nonzero(sub_white)) / box_area

            # Tombol Subscribe merah solid memiliki warna merah dominan (42%..92%) + huruf putih di tengah (2.5%..38%)
            if 0.42 <= red_fill <= 0.92 and 0.025 <= white_fill <= 0.38:
                # Cek keseragaman warna merah (grafis digital memiliki standar deviasi saturasi sangat rendah dibanding objek fisik)
                sub_hsv = hsv[y:y + ch, x:x + cw]
                sat_vals = sub_hsv[:, :, 1][sub_red > 0]
                if sat_vals.size > 20 and float(np.std(sat_vals)) < 26.0:
                    frame_best_badge_ratio = max(frame_best_badge_ratio, frac)
                    if float(np.std(sat_vals)) < 14.0 and red_fill >= 0.55 and 0.04 <= white_fill <= 0.30:
                        has_sharp_badge = True

        red_badge_ratios.append(frame_best_badge_ratio)
        white_card_with_red.append(has_sharp_badge)

    if not red_badge_ratios:
        return False

    max_r = max(red_badge_ratios)
    min_r = min(red_badge_ratios)
    # Jika ada tombol grafis merah super-tajam khas YouTube, atau tombol merah bergerak masuk/keluar antar-frame
    if any(white_card_with_red) and max_r >= 0.008:
        return True
    if max_r >= 0.009 and (max_r - min_r) >= 0.005:
        return True
    return False

def is_static_still_sequence(frames_bgr, min_motion_mad=1.85):
    """
    Mendeteksi apakah serangkaian frame merupakan GAMBAR STATIS / FOTO DIAM / SLIDE / SCREENSHOT
    (tidak ada pergerakan video nyata antar-frame).
    Mengembalikan True jika rata-rata perubahan piksel di area tengah sangat rendah (< min_motion_mad)
    ATAU jika hampir seluruh pasangan frame berurutan nyaris identik (< 1.25).
    Catatan: Fungsi ini HANYA diaktifkan untuk bab SELAIN Kamera (`not is_camera_chap`).
    """
    if not frames_bgr or len(frames_bgr) < 3:
        return False

    grays = []
    for fr in frames_bgr:
        if fr is None or fr.size == 0:
            continue
        h, w = fr.shape[:2]
        # Fokus pada area tengah (y: 12%..88%, x: 8%..92%) agar tidak tertipu kedipan watermark di pojok
        roi = fr[int(h * 0.12):int(h * 0.88), int(w * 0.08):int(w * 0.92)]
        g = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        g = cv2.resize(g, (160, 284), interpolation=cv2.INTER_AREA)
        g = cv2.GaussianBlur(g, (3, 3), 0)
        grays.append(g.astype(np.float32))

    if len(grays) < 3:
        return False

    step_diffs = []
    for i in range(len(grays) - 1):
        mad = float(np.mean(np.abs(grays[i + 1] - grays[i])))
        step_diffs.append(mad)

    # Gunakan rata-rata tanpa 1 outlier tertinggi (mengantisipasi jika tepat ada 1 pergantian slide di tengah)
    sorted_diffs = sorted(step_diffs)
    core_diffs = sorted_diffs[:-1] if len(sorted_diffs) >= 3 else sorted_diffs
    mean_core_mad = float(np.mean(core_diffs))
    span_mad = float(np.mean(np.abs(grays[-1] - grays[0])))

    if mean_core_mad < min_motion_mad and span_mad < (min_motion_mad * 1.45):
        return True
    if sum(1 for d in step_diffs if d < 1.25) >= max(2, len(step_diffs) - 1):
        return True
    return False

def verify_clip_100pct_face_free(clip_path, detector, step=3, is_camera_chap=False):
    """
    Memindai file klip MP4 yang sudah dipotong untuk menjamin:
    - 0% frame wajah (YuNet ONNX)
    - 0% animasi tombol Subscribe YouTube
    - Bukan gambar statis / foto diam jika berada di luar Bab Kamera (`not is_camera_chap`)
    """
    if not os.path.exists(clip_path):
        return True
    cap = cv2.VideoCapture(clip_path)
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    is_clean = True
    sampled_small = []
    for idx in range(0, max(1, n_frames), step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, fr = cap.read()
        if not ret or fr is None:
            continue
        sm = cv2.resize(fr, (270, 480), interpolation=cv2.INTER_AREA)
        if detector is not None:
            _, faces = detector.detect(sm)
            if faces is not None and len(faces) > 0:
                is_clean = False
                break
        sampled_small.append(sm)
    cap.release()
    if not is_clean:
        return False
    if sampled_small and has_animated_subscribe_badge(sampled_small):
        return False
    if not is_camera_chap and len(sampled_small) >= 4:
        # Ambil 6 sampel merata dari seluruh durasi klip untuk cek gambar statis
        pick_idx = np.linspace(0, len(sampled_small) - 1, min(6, len(sampled_small)), dtype=int)
        motion_samples = [sampled_small[i] for i in pick_idx]
        if is_static_still_sequence(motion_samples):
            return False
    return True

def verify_source_window_clean(video_path, seg_start, exact_dur, detector, samples=7, is_camera_chap=False):
    """
    Memverifikasi segmen kandidat langsung dari video sumber (sebelum dipotong 1080p)
    untuk memastikan 0% frame wajah (YuNet), 0% animasi tombol Subscribe YouTube,
    dan bukan gambar statis (untuk bab selain Kamera).
    """
    cap = cv2.VideoCapture(video_path)
    sampled_small = []
    is_clean = True
    times = np.linspace(seg_start, max(seg_start + 0.2, seg_start + exact_dur - 0.05), samples)
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000.0)
        ret, fr = cap.read()
        if not ret or fr is None:
            continue
        h, w = fr.shape[:2]
        cw = int(h * 9 / 16)
        x0 = max(0, (w - cw) // 2)
        crop = fr[:, x0:x0 + cw]
        sm = cv2.resize(crop, (270, 480), interpolation=cv2.INTER_AREA)
        if detector is not None:
            _, faces = detector.detect(sm)
            if faces is not None and len(faces) > 0:
                is_clean = False
                break
        sampled_small.append(sm)
    cap.release()
    if not is_clean:
        return False
    if sampled_small and has_animated_subscribe_badge(sampled_small):
        return False
    if not is_camera_chap and len(sampled_small) >= 4 and is_static_still_sequence(sampled_small):
        return False
    return True

def extract_storyboard_and_hist(video_path, start_s, end_s, detector=None, is_camera_chap=False):
    span = max(0.5, end_s - start_s)
    sample_times = [
        start_s + 0.12,
        start_s + span * 0.32,
        start_s + span * 0.52,
        start_s + span * 0.74,
        max(start_s + 0.25, end_s - 0.10)
    ]
    crops = []
    mid_hist = None
    for idx, t in enumerate(sample_times):
        cmd = [
            "ffmpeg", "-nostdin", "-loglevel", "fatal",
            "-ss", f"{t:.2f}", "-i", video_path,
            "-vf", "crop=ih*9/16:ih:(iw-ow)/2:0,scale=360:640",
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"
        ]
        try:
            raw_jpg = subprocess.check_output(cmd, timeout=10)
            arr = np.frombuffer(raw_jpg, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is not None:
                if detector is not None:
                    sm = cv2.resize(img, (270, 480), interpolation=cv2.INTER_AREA)
                    _, faces = detector.detect(sm)
                    if faces is not None and len(faces) > 0:
                        return None, None
                # Sertakan SEMUA 5 frame sampel ke dalam storyboard agar animasi Subscribe yang muncul
                # sesaat di tengah/akhir klip pasti terlihat oleh Gemini Vision & detektor lokal!
                crops.append(img)
                if idx == 2:
                    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
                    mid_hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
                    cv2.normalize(mid_hist, mid_hist, 0, 1, cv2.NORM_MINMAX)
        except Exception:
            continue
    if not crops:
        return None, None
    if has_animated_subscribe_badge(crops):
        return None, None
    # Tolak otomatis jika gambar statis / foto diam / screenshot pada bab SELAIN Kamera!
    if not is_camera_chap and is_static_still_sequence(crops):
        return None, None
    _, buf = cv2.imencode(".jpg", np.hstack(crops), [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    return base64.b64encode(buf).decode("utf-8"), mid_hist

def is_visually_duplicate(curr_hist, prev_hists, threshold=0.87):
    if curr_hist is None or not prev_hists:
        return False
    for ph in prev_hists[-6:]:
        if ph is not None:
            if cv2.compareHist(curr_hist, ph, cv2.HISTCMP_CORREL) >= threshold:
                return True
    return False

def check_clean_broll_segment(b64_img, raw_sub, chapter_title, is_camera_chap, api_key, visual_focus="", scene_vo=""):
    if is_camera_chap:
        # ATURAN KHUSUS BAB KAMERA (JANGAN UBAH!): Wajib meloloskan sampel foto/video, aplikasi kamera, atau modul lensa!
        cam_rule = "BAB KAMERA: Set is_product_broll = true JIKA gambar menampilkan modul kamera, antarmuka aplikasi kamera, ATAU hasil jepretan foto/video (pemandangan, bangunan, tanaman, objek luar). Jangan tolak pemandangan/objek luar karena itu adalah sampel kamera!"
        static_rule = "6. is_static_image = false (khusus Bab Kamera, sampel foto statis/jepretan kamera DIPERBOLEHKAN penuh)."
    else:
        cam_rule = "Set is_product_broll = true HANYA JIKA merupakan REKAMAN VIDEO BERGERAK NYATA yang menampilkan fisik unit handphone (bodi, layar menyala sedang disentuh/digerakkan, atau tes ketahanan fisik HP) dan BUKAN dus/kotak."
        static_rule = "6. is_static_image = true JIKA kelima frame menampilkan GAMBAR STATIS / FOTO DIAM / SLIDE PRESENTASI / SCREENSHOT / SKOR ANTUTU DIAM / TABEL SPESIFIKASI tanpa pergerakan video nyata (atau hanya efek zoom/pan lambat pada foto diam). Untuk bab selain Kamera, gambar statis WAJIB DITOLAK!"

    focus_line = f"Fokus Visual Sub-Adegan: {visual_focus}" if visual_focus else f"Target Bab Visual: {chapter_title}"
    vo_line = f"Kalimat Voiceover Adegan Ini: \"{scene_vo}\"" if scene_vo else ""

    prompt = "\n".join([
        "Gambar ini adalah gabungan 5 frame berurutan (kiri ke kanan) dari sebuah potongan video.",
        f"Target Bab Visual: {chapter_title}",
        focus_line,
        vo_line,
        f"Transkrip Asli di detik ini: \"{raw_sub}\"",
        "",
        "ATURAN VALIDASI KETAT (PERIKSA KELIMA FRAME DARI KIRI KE KANAN):",
        f"1. {cam_rule}",
        "2. Set is_product_broll = false JIKA gambar adalah dus/kotak HP, monitor PC, toko online, atau foto diam di luar bab kamera.",
        "3. has_face = true JIKA ada wajah manusia (wajah reviewer/orang) di SALAH SATU dari 5 frame. WAJIB TOLAK jika ada wajah.",
        "4. has_subscribe_popup = true JIKA di SALAH SATU dari 5 frame terdapat animasi tombol SUBSCRIBE YouTube (merah/putih/hitam), ikon lonceng notifikasi, animasi kursor/tangan mengklik tombol Subscribe/Like, pop-up nama channel YouTube, atau banner ajakan Subscribe/Like/Follow yang bergerak masuk.",
        "5. has_editor_overlay = true JIKA ada teks besar editor, tabel spesifikasi layar penuh, screenshot marketplace, watermark besar, ATAU animasi tombol Subscribe/Like/Lonceng YouTube.",
        static_rule,
        "7. reason = alasan singkat 1 kalimat.",
        "Kembalikan HANYA format JSON murni dengan key: is_product_broll (boolean), has_face (boolean), has_subscribe_popup (boolean), has_editor_overlay (boolean), is_static_image (boolean), reason (string)."
    ])

    payload = {
        "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64_img}}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }
    return call_gemini_json(payload, api_key)

SUBSCRIBE_BLACKLIST_KEYWORDS = [
    "subscribe", "subrek", "langganan", "lonceng", "notifikasi",
    "like dan", "jangan lupa like", "klik tombol", "share ke", "kolom komentar",
    "link pembelian", "di deskripsi", "cek deskripsi", "giveaway"
]

def collect_candidates_for_scene(scene_info, chap_cfg, chap_start_s, chap_end_s, face_free_segs, events, used_windows, total_dur=600.0):
    """
    Mengumpulkan kandidat segmen B-Roll bebas wajah yang paling relevan dengan Sub-Adegan spesifik:
    - Menolak segmen yang berada di zona rawan animasi Subscribe (awal video < 38s atau outro > total_dur - 25s)
      maupun segmen yang transkrip aslinya mengucapkan ajakan Subscribe/Like/Lonceng.
    - Tier 1: Berada di zona detik sub-adegan DAN transkrip mengandung kata kunci spesifik sub-adegan.
    - Tier 2: Transkrip mengandung kata kunci sub-adegan ATAU berada di dalam zona detik sub-adegan.
    - Tier 3: Berada di zona detik bab induk atau kata kunci bab induk.
    - Tier 4: Cadangan global bebas wajah.
    """
    tier1_exact = []
    tier2_scene = []
    tier3_chap = []
    tier4_backup = []

    sc_kws = scene_info.get("keywords") or chap_cfg["keywords"]
    chap_kws = chap_cfg["keywords"]
    sc_s = float(scene_info.get("source_start_sec", chap_start_s))
    sc_e = float(scene_info.get("source_end_sec", chap_end_s))
    req_dur = max(2.1, min(3.6, float(scene_info.get("duration_s", 2.2)) + 0.12))

    safe_min_sec = 38.0 if total_dur > 140.0 else 15.0
    safe_max_sec = max(safe_min_sec + 30.0, total_dur - 25.0) if total_dur > 140.0 else total_dur - 5.0

    for s_start, s_end in face_free_segs:
        curr = max(s_start, safe_min_sec)
        seg_limit = min(s_end, safe_max_sec)
        while (seg_limit - curr) >= req_dur:
            slice_end = min(seg_limit, curr + max(2.5, req_dur))
            mid_t = (curr + slice_end) / 2.0
            if any(abs(mid_t - u) < 1.8 for u in used_windows):
                curr += 2.2
                continue

            # Periksa transkrip dengan konteks +/- 4 detik di sekitar kandidat untuk mendeteksi momen reviewer minta subscribe
            sub_context = get_transcript_slice(events, max(0.0, curr - 4.0), slice_end + 4.0).lower()
            if any(bad_kw in sub_context for bad_kw in SUBSCRIBE_BLACKLIST_KEYWORDS):
                curr += 2.5
                continue

            sub_txt = get_transcript_slice(events, curr, slice_end).lower()
            in_sc_range = (sc_s - 10.0) <= mid_t <= (sc_e + 10.0)
            in_chap_range = (chap_start_s - 15.0) <= mid_t <= (chap_end_s + 15.0)
            has_sc_kw = any(k in sub_txt for k in sc_kws)
            has_chap_kw = any(k in sub_txt for k in chap_kws)

            if in_sc_range and has_sc_kw:
                tier1_exact.append((curr, slice_end))
            elif has_sc_kw or in_sc_range:
                tier2_scene.append((curr, slice_end))
            elif in_chap_range or has_chap_kw:
                tier3_chap.append((curr, slice_end))
            else:
                tier4_backup.append((curr, slice_end))
            curr += 2.3

    def downsample(lst, limit):
        if len(lst) <= limit:
            return lst
        idx = np.linspace(0, len(lst) - 1, limit, dtype=int)
        return [lst[i] for i in idx]

    return (
        downsample(tier1_exact, 8)
        + downsample(tier2_scene, 8)
        + downsample(tier3_chap, 6)
        + downsample(tier4_backup, 6)
    )

def cut_exact_broll_clip_1080p(video_path, seg_start, exact_dur, out_path):
    cmd = [
        "ffmpeg", "-nostdin", "-y", "-loglevel", "fatal",
        "-ss", f"{seg_start:.3f}", "-i", video_path, "-t", f"{exact_dur:.3f}",
        "-vf", "crop=ih*9/16:ih:(iw-ow)/2:0,scale=1080:1920:flags=lanczos,fps=30,format=yuv420p,setpts=PTS-STARTPTS",
        "-an",
        "-c:v", "libx264", "-preset", "superfast", "-crf", "19",
        "-g", "30", "-video_track_timescale", "30000",
        out_path
    ]
    subprocess.run(cmd, check=True)

def normalize_hashtags(raw_hashtags, lang="id"):
    """Memastikan setiap hashtag selalu diawali tanda pagar '#' dan diformat rapi."""
    default_tags = "#SmartphoneReview #TechShorts #GadgetReview #Shorts" if lang == "en" else "#ReviewHP #GadgetIndonesia #Smartphone #Shorts"
    if isinstance(raw_hashtags, list):
        raw_str = " ".join(str(x) for x in raw_hashtags if x)
    else:
        raw_str = str(raw_hashtags or "").strip()

    if not raw_str:
        return default_tags

    tokens = re.split(r"[\s,;]+", raw_str)
    formatted = []
    seen = set()
    for tok in tokens:
        clean_tok = re.sub(r"^#+", "", tok.strip())
        clean_tok = re.sub(r"[^a-zA-Z0-9_]", "", clean_tok)
        if not clean_tok:
            continue
        low = clean_tok.lower()
        if low not in seen:
            seen.add(low)
            formatted.append(f"#{clean_tok}")

    return " ".join(formatted) if formatted else default_tags

def save_matching_txt(video_file_path, caption_text, hashtags_text="", lang="id"):
    base_no_ext = os.path.splitext(video_file_path)[0]
    txt_path = f"{base_no_ext}.txt"
    clean_cap = str(caption_text or "").strip()
    clean_tags = normalize_hashtags(hashtags_text, lang=lang)
    content = f"{clean_cap}\n\n{clean_tags}" if clean_tags else clean_cap
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content + "\n")
    return txt_path

THUMBNAIL_PALETTES = [
    {
        "name": "Cyber Red & White",
        "badge_bg_bgr": (20, 20, 210),          # merah solid
        "badge_border_bgr": (255, 255, 255),
        "accent_bgr": (0, 220, 255),              # kuning-oranye
        "ass_line1_primary": "&H00FFFFFF",
        "ass_line2_primary": "&H0000DCFF",
        "ass_badge_primary": "&H00FFFFFF",
        "ass_spec_primary": "&H00AAEEFF",
        "gradient_bottom_bgr": (0, 0, 0),
    },
    {
        "name": "Electric Gold & Black",
        "badge_bg_bgr": (10, 160, 255),          # oranye-amber
        "badge_border_bgr": (0, 220, 255),
        "accent_bgr": (0, 220, 255),              # kuning neon
        "ass_line1_primary": "&H00FFFFFF",
        "ass_line2_primary": "&H00FFDC00",
        "ass_badge_primary": "&H00FFFFFF",
        "ass_spec_primary": "&H0070E8FF",
        "gradient_bottom_bgr": (10, 10, 20),
    },
    {
        "name": "Neon Cyan & Lime",
        "badge_bg_bgr": (200, 55, 0),            # biru-teal solid
        "badge_border_bgr": (40, 255, 140),
        "accent_bgr": (40, 255, 140),             # hijau neon
        "ass_line1_primary": "&H00FFFFFF",
        "ass_line2_primary": "&H002CFF8C",
        "ass_badge_primary": "&H00FFFFFF",
        "ass_spec_primary": "&H00B0FFE0",
        "gradient_bottom_bgr": (0, 15, 10),
    },
    {
        "name": "Purple Haze & Cyan",
        "badge_bg_bgr": (200, 30, 180),          # ungu solid
        "badge_border_bgr": (255, 220, 255),
        "accent_bgr": (255, 100, 220),            # magenta/pink neon
        "ass_line1_primary": "&H00FFFFFF",
        "ass_line2_primary": "&H00DC64FF",
        "ass_badge_primary": "&H00FFFFFF",
        "ass_spec_primary": "&H00FFB8FF",
        "gradient_bottom_bgr": (10, 0, 20),
    },
    {
        "name": "Platinum & Ice Blue",
        "badge_bg_bgr": (140, 100, 60),          # biru-slate solid
        "badge_border_bgr": (220, 220, 255),
        "accent_bgr": (220, 200, 255),            # lavender terang
        "ass_line1_primary": "&H00FFFFFF",
        "ass_line2_primary": "&H00DCC8FF",
        "ass_badge_primary": "&H00FFFFFF",
        "ass_spec_primary": "&H00EEE0FF",
        "gradient_bottom_bgr": (5, 0, 15),
    },
]

# Layout variasi thumbnail (posisi zona teks Y, ukuran font relatif, posisi badge)
THUMBNAIL_LAYOUTS = [
    # Layout A: teks di bawah (default klasik)
    {
        "name": "bottom_text",
        "badge_y_range": (1235, 1315),
        "line1_y": 1415,
        "line2_y": 1545,
        "specs_y": 1682,
        "specs_bar_y": (1645, 1720),
        "frame_y_vignette_top_end": 360,
        "frame_y_vignette_bot_start": 1100,
        "line1_fontsize": 92,
        "line2_fontsize": 100,
    },
    # Layout B: teks di bawah lebih besar (bold impact)
    {
        "name": "bold_impact",
        "badge_y_range": (1180, 1265),
        "line1_y": 1370,
        "line2_y": 1510,
        "specs_y": 1660,
        "specs_bar_y": (1625, 1700),
        "frame_y_vignette_top_end": 300,
        "frame_y_vignette_bot_start": 1050,
        "line1_fontsize": 102,
        "line2_fontsize": 110,
    },
    # Layout C: teks di atas (phone showcase di bawah)
    {
        "name": "top_text",
        "badge_y_range": (100, 180),
        "line1_y": 285,
        "line2_y": 420,
        "specs_y": 545,
        "specs_bar_y": (510, 585),
        "frame_y_vignette_top_end": 640,
        "frame_y_vignette_bot_start": 1600,
        "line1_fontsize": 92,
        "line2_fontsize": 100,
    },
]

def extract_short_phone_name(video_title):
    """Mengekstrak nama seri HP singkat (2-4 kata) yang bersih dari kata-kata Bahasa Indonesia pada judul video."""
    known_brands = {
        "samsung", "galaxy", "iphone", "xiaomi", "redmi", "poco", "oppo", "vivo", "iqoo",
        "realme", "infinix", "tecno", "itel", "honor", "asus", "rog", "zenfone", "huawei",
        "motorola", "moto", "nothing", "google", "pixel", "oneplus", "nubia", "zflip", "zfold",
        "sony", "xperia", "nokia", "sharp", "aquos", "meizu"
    }
    indo_title_stopwords = {
        "di", "ke", "dari", "dan", "atau", "yang", "ini", "itu", "untuk", "buat", "dengan",
        "tahun", "bulan", "hari", "harga", "turun", "naik", "murah", "mahal", "terbaik",
        "terbaru", "masih", "layak", "beli", "dibeli", "jangan", "wajib", "tahu", "jujur",
        "review", "unboxing", "indonesia", "resmi", "garansi", "spek", "spesifikasi", "dewa",
        "hp", "smartphone", "ponsel", "flagship", "killer", "jutaan", "ribuan", "cuma", "hanya",
        "bikin", "kaget", "parah", "banget", "paling", "worth", "it", "vs", "lawan", "tes", "uji"
    }
    model_suffixes = {
        "fe", "pro", "max", "ultra", "plus", "mini", "lite", "neo", "gt", "se", "5g", "4g",
        "note", "fold", "flip", "edge", "play", "power", "turbo", "prime", "air", "s", "a", "c", "i", "e", "x", "z"
    }
    clean = re.sub(r"[^\w\s\+]", " ", str(video_title or ""))
    words = [w for w in clean.split() if w]
    start_idx = None
    for i, w in enumerate(words):
        if w.lower() in known_brands:
            start_idx = i
            break
    if start_idx is not None:
        picked = []
        for w in words[start_idx:start_idx + 6]:
            low = w.lower()
            if low in indo_title_stopwords:
                break
            # Hentikan jika bertemu angka tahun 2024..2030 setelah nama model sudah terkumpul >= 2 kata
            if re.match(r"^202[4-9]$|^203\d$", low) and len(picked) >= 2:
                break
            if (
                low in known_brands
                or low in model_suffixes
                or any(ch.isdigit() for ch in low)
                or (len(picked) < 3 and len(low) <= 6)
            ):
                picked.append(w)
            else:
                break
        if picked and picked[0].lower() == "samsung" and len(picked) >= 3 and picked[1].lower() == "galaxy":
            picked = picked[1:4]
        if picked:
            return " ".join(picked[:4]).upper()
    return "FLAGSHIP PHONE"

INDONESIAN_TO_ENGLISH_THUMB_MAP = [
    (r"\bTAHAN\s+BANTING\b", "DROP RESISTANT"),
    (r"\bTAHAN\s+AIR\s+DAN\s+DEBU\b", "WATER & DUST RESISTANT"),
    (r"\bTAHAN\s+AIR\b", "WATERPROOF"),
    (r"\bANTI\s+AIR\b", "WATERPROOF"),
    (r"\bTURUN\s+HARGA\b", "PRICE DROP"),
    (r"\bHARGA\s+MIRING\b", "BEST VALUE"),
    (r"\bMASIH\s+LAYAK\b", "WORTH IT"),
    (r"\bWAJIB\s+BELI\b", "MUST BUY"),
    (r"\bREVIEW\s+JUJUR\b", "HONEST REVIEW"),
    (r"\bBATERAI\s+BADAK\b", "MASSIVE BATTERY"),
    (r"\bBATERAI\s+AWET\b", "ALL-DAY BATTERY"),
    (r"\bBATERAI\s+JUMBO\b", "HUGE BATTERY"),
    (r"\bPENGISIAN\s+CEPAT\b", "FAST CHARGING"),
    (r"\bCAS\s+CEPAT\b", "FAST CHARGING"),
    (r"\bKAMERA\s+UTAMA\b", "MAIN CAMERA"),
    (r"\bKAMERA\s+JERNIH\b", "CLEAR CAMERA"),
    (r"\bKAMERA\s+STABIL\b", "STABLE CAMERA"),
    (r"\bKAMERA\s+TAJAM\b", "SHARP CAMERA"),
    (r"\bCHIPSET\s+KENCANG\b", "FAST CHIPSET"),
    (r"\bPERFORMA\s+NGEBUT\b", "FAST PERFORMANCE"),
    (r"\bPERFORMA\s+TINGGI\b", "HIGH PERFORMANCE"),
    (r"\bLAYAR\s+LENGKUNG\b", "CURVED DISPLAY"),
    (r"\bLAYAR\s+CERAH\b", "BRIGHT DISPLAY"),
    (r"\bLAYAR\s+MULUS\b", "SMOOTH DISPLAY"),
    (r"\bSPEAKER\s+STEREO\b", "STEREO SPEAKERS"),
    (r"\bSIDIK\s+JARI\b", "FINGERPRINT"),
    (r"\bMEMORI\s+LEGA\b", "LARGE STORAGE"),
    (r"\bDESAIN\s+MEWAH\b", "LUXURY DESIGN"),
    (r"\bDESAIN\s+TIPIS\b", "SLIM DESIGN"),
    (r"\bBODI\s+TIPIS\b", "SLIM BODY"),
    (r"\bLAYAR\b", "DISPLAY"),
    (r"\bBATERAI\b", "BATTERY"),
    (r"\bKAMERA\b", "CAMERA"),
    (r"\bPERFORMA\b", "PERFORMANCE"),
    (r"\bDESAIN\b", "DESIGN"),
    (r"\bBODI\b", "BODY"),
    (r"\bHARGA\b", "PRICE"),
    (r"\bSPEK\b", "SPECS"),
    (r"\bSPESIFIKASI\b", "SPECS"),
    (r"\bKENCANG\b", "FAST"),
    (r"\bNGEBUT\b", "FAST"),
    (r"\bAWET\b", "LONG-LASTING"),
    (r"\bSTABIL\b", "STABLE"),
    (r"\bTAJAM\b", "SHARP"),
    (r"\bJERNIH\b", "CLEAR"),
    (r"\bMEWAH\b", "PREMIUM"),
    (r"\bTIPIS\b", "SLIM"),
    (r"\bKOKOH\b", "DURABLE"),
    (r"\bKUAT\b", "STRONG"),
    (r"\bINCI\b", "INCH"),
    (r"\bJUTAAN\b", "BUDGET"),
    (r"\bTERBAIK\b", "BEST"),
    (r"\bTERBARU\b", "NEW"),
]

INDONESIAN_DETECTION_WORDS = {
    "MASIH", "LAYAK", "HARGA", "TURUN", "SPEK", "SPESIFIKASI", "JUJUR", "WAJIB", "BELI", "DIBELI",
    "TAHU", "JAWARA", "LAYAR", "BATERAI", "KAMERA", "KENCANG", "STABIL", "TAHAN", "AIR", "DEBU",
    "BANTING", "BADAK", "JUMBO", "AWET", "CEPAT", "CAS", "PENGISIAN", "PERFORMA", "NGEBUT",
    "DESAIN", "BODI", "TIPIS", "MEWAH", "KOKOH", "JERNIH", "TAJAM", "INCI", "JUTAAN", "MURAH",
    "MAHAL", "TERBAIK", "TERBARU", "DENGAN", "UNTUK", "BUAT", "YANG", "INI", "ITU", "DAN", "ATAU",
    "DI", "KE", "DARI", "TAHUN", "RESMI", "GARANSI", "HP", "PONSEL", "CANGGIH", "MANTAP", "KEREN",
    "BANGET", "PARAH", "CUMA", "HANYA", "PALING", "SOLUSI", "PILIHAN", "REKOMENDASI"
}

def translate_or_clean_english_thumb_text(text_up):
    """Menerjemahkan istilah spesifikasi Bahasa Indonesia ke Bahasa Inggris dan menghapus sisa kata Bahasa Indonesia."""
    s = str(text_up or "").upper()
    for pat, rep in INDONESIAN_TO_ENGLISH_THUMB_MAP:
        s = re.sub(pat, rep, s, flags=re.IGNORECASE)
    # Hapus kata tersisa yang masih terdeteksi Bahasa Indonesia
    cleaned_tokens = []
    for tok in s.split():
        bare = re.sub(r"[^A-Z0-9]", "", tok)
        if bare in INDONESIAN_DETECTION_WORDS:
            continue
        cleaned_tokens.append(tok)
    return " ".join(cleaned_tokens).strip()

def has_indonesian_words(text_up):
    tokens = [re.sub(r"[^A-Z0-9]", "", w) for w in str(text_up or "").upper().split()]
    return any(t in INDONESIAN_DETECTION_WORDS for t in tokens if t)

def extract_english_specs_from_plan(plan):
    """Mengekstrak 3 poin spesifikasi teknis Bahasa Inggris langsung dari naskah VO bahasa Inggris jika perlu."""
    joined_en = " ".join(
        str(plan.get(k, {}).get("script", ""))
        for k in ("screen_os", "perf_mem", "bat_feat", "camera", "body_ip")
        if isinstance(plan.get(k), dict)
    )
    found = []
    # Cari pola teknis umum: Hz, mAh, W, MP, IP68/IP69, chipset
    hz_m = re.search(r"\b(120|144|90)\s*(?:HZ|HERTZ)\b", joined_en, re.I)
    if hz_m:
        found.append(f"{hz_m.group(1)}HZ DISPLAY")
    elif "amoled" in joined_en.lower():
        found.append("AMOLED DISPLAY")

    chip_m = re.search(r"\b(SNAPDRAGON\s+\w+|DIMENSITY\s+\w+|EXYNOS\s+\w+|HELIO\s+\w+|APPLE\s+A\d+\w*|TENSOR\s+\w+)\b", joined_en, re.I)
    if chip_m:
        found.append(chip_m.group(1).upper())

    ip_m = re.search(r"\b(IP6[45789]|IP5[34])\b", joined_en, re.I)
    if ip_m:
        found.append(f"{ip_m.group(1).upper()} RATED")

    bat_m = re.search(r"\b([4567]\d00)\s*MAH\b", joined_en, re.I)
    if bat_m and len(found) < 3:
        found.append(f"{bat_m.group(1)}MAH BATTERY")

    mp_m = re.search(r"\b(50|64|108|200)\s*(?:MP|MEGAPIXEL)", joined_en, re.I)
    if mp_m and len(found) < 3:
        found.append(f"{mp_m.group(1)}MP CAMERA")

    defaults = ["120HZ DISPLAY", "FAST CHIPSET", "PRO CAMERA", "ALL-DAY BATTERY"]
    for d in defaults:
        if len(found) >= 3:
            break
        if d not in found:
            found.append(d)
    return " • ".join(found[:3])

def ensure_dynamic_thumbnail_copy(plan, video_title, lang="id"):
    """
    Menyiapkan dan memvalidasi teks dinamis untuk Thumbnail Video Short sesuai bahasa (`id` / `en`):
    - `badge`: Lencana atas 2-3 kata (mis. 'REVIEW JUJUR!' / 'HONEST REVIEW!')
    - `line1` & `line2`: Headline utama 2 baris (nama HP + hook memikat)
    - `specs`: Pita ringkasan 3 poin spesifikasi inti (100% sesuai bahasa yang dipilih)
    """
    phone_name = extract_short_phone_name(video_title)
    seed_val = int(time.time() * 1000) ^ int(hashlib.md5(str(video_title).encode("utf-8", errors="ignore")).hexdigest()[:8], 16)
    rng = random.Random(seed_val)

    id_badges = [
        "REVIEW JUJUR!", "SPEK FLAGSHIP!", "PALING WORTH IT!", "TURUN HARGA!",
        "WAJIB TAHU!", "REVIEW KILAT!", "HARGA NGERI!", "SPEK GILA!",
        "MUST WATCH!", "JANGAN LEWATKAN!", "BELI ATAU TIDAK?!", "RATING DEWA!"
    ]
    en_badges = [
        "HONEST REVIEW!", "FLAGSHIP KILLER!", "WORTH BUYING?!", "PRICE DROP!",
        "FULL BREAKDOWN!", "MUST WATCH!", "BEST VALUE!", "REAL VERDICT!",
        "SPECS INSANE!", "BUY OR SKIP?!", "QUICK VERDICT!", "INSANE DEAL!"
    ]
    id_hooks = [
        "MASIH LAYAK?!", "SPEKNYA NGERI!", "JAWARA BARU!", "WAJIB BELI?!",
        "SAINGI FLAGSHIP?!", "HARGA MIRING!", "KAMERA DEWA?!", "PERFORMA MONSTER!",
        "HP TERBAIK?!", "WORTH IT BANGET!", "BATERAI BADAK!", "LAYAR JUARA!"
    ]
    en_hooks = [
        "WORTH IT?!", "TOTAL BEAST!", "BEST VALUE?!", "GAME CHANGER!",
        "INSANE SPECS!", "BUY OR SKIP?!", "REAL KING?!", "MUST BUY!",
        "LEGIT BEAST!", "CAMERA KING?!", "BATTERY MONSTER!", "INSANE DEAL!"
    ]

    raw_badge = sanitize_subtitle_text(plan.get("thumbnail_badge", "")).upper()
    raw_head = sanitize_subtitle_text(plan.get("thumbnail_headline", "")).upper()
    raw_specs = sanitize_subtitle_text(plan.get("thumbnail_specs", "")).upper()

    if lang == "en":
        raw_badge = translate_or_clean_english_thumb_text(raw_badge)
        if not raw_badge or has_indonesian_words(raw_badge) or len(raw_badge) < 4:
            raw_badge = rng.choice(en_badges)

        # Untuk bahasa Inggris, paksa Baris 1 selalu nama seri HP bersih & Baris 2 hook Bahasa Inggris murni
        raw_head_clean = translate_or_clean_english_thumb_text(raw_head)
        # Hapus kata-kata nama HP dari raw_head_clean untuk melihat apakah ada hook Bahasa Inggris yang bagus
        phone_tokens = set(phone_name.split())
        hook_candidates = [w for w in raw_head_clean.split() if re.sub(r"[^A-Z0-9]", "", w) not in phone_tokens]
        hook_str = " ".join(hook_candidates[:3]).strip()
        if not hook_str or has_indonesian_words(hook_str) or len(hook_str) < 4:
            hook_str = rng.choice(en_hooks)
        elif hook_str[-1] not in "!?":
            hook_str += "!"
        line1 = phone_name[:20]
        line2 = hook_str[:20]

        # Terjemahkan & bersihkan specs Bahasa Inggris
        raw_specs_en = translate_or_clean_english_thumb_text(raw_specs)
        spec_parts = [p.strip() for p in re.split(r"[•|/,\-]+", raw_specs_en) if p.strip() and not has_indonesian_words(p)]
        if len(spec_parts) >= 2:
            final_specs = " • ".join(spec_parts[:3])[:44]
        else:
            final_specs = extract_english_specs_from_plan(plan)[:44]
    else:
        if not raw_badge:
            raw_badge = rng.choice(id_badges)
        if not raw_head:
            raw_head = f"{phone_name} {rng.choice(id_hooks)}"

        head_words = [w for w in raw_head.split() if w]
        if len(head_words) <= 2:
            line1 = phone_name[:20]
            line2 = raw_head if raw_head != phone_name else rng.choice(id_hooks)
        else:
            mid = max(2, min(3, (len(head_words) + 1) // 2))
            line1 = " ".join(head_words[:mid])[:20]
            line2 = " ".join(head_words[mid:mid + 3])[:20]
            if not line2:
                line2 = rng.choice(id_hooks)

        if not raw_specs or len(raw_specs) < 6:
            final_specs = "LAYAR 120HZ • CHIPSET KENCANG • KAMERA STABIL"
        else:
            spec_parts = [p.strip() for p in re.split(r"[•|/,\-]+", raw_specs) if p.strip()]
            final_specs = (" • ".join(spec_parts[:3]) if len(spec_parts) >= 2 else raw_specs)[:44]

    raw_badge = " ".join(raw_badge.split()[:3])
    if raw_badge and raw_badge[-1] not in "!?":
        raw_badge += "!"

    palette = rng.choice(THUMBNAIL_PALETTES)
    layout = rng.choice(THUMBNAIL_LAYOUTS)
    return {
        "badge": raw_badge,
        "line1": line1,
        "line2": line2,
        "specs": final_specs.upper(),
        "palette": palette,
        "layout": layout
    }

def _score_frame_for_thumbnail(frame, clip_idx, detector):
    """
    Mengembalikan skor ketajaman & kecerahan frame untuk seleksi thumbnail.
    Mengembalikan (skor, gray_roi) atau (None, None) jika frame tidak memenuhi syarat.
    """
    if detector is not None:
        sm = cv2.resize(frame, (270, 480), interpolation=cv2.INTER_AREA)
        _, faces = detector.detect(sm)
        if faces is not None and len(faces) > 0:
            return None, None
        if has_animated_subscribe_badge([sm]):
            return None, None

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    center_roi = gray[int(h * 0.12):int(h * 0.78), int(w * 0.10):int(w * 0.90)]
    sharpness = float(cv2.Laplacian(center_roi, cv2.CV_64F).var())
    mean_bri = float(np.mean(center_roi))

    bri_factor = 1.0
    if mean_bri < 45.0 or mean_bri > 220.0:
        bri_factor = 0.45
    elif 75.0 <= mean_bri <= 185.0:
        bri_factor = 1.20

    chap_bonus = 1.35 if clip_idx < 4 else 1.0
    score = sharpness * bri_factor * chap_bonus
    return score, center_roi


def _estimate_vertical_phone_score(frame):
    """
    Memperkirakan seberapa vertikal dan utuh HP yang terlihat di frame menggunakan
    analisis kontur dan aspek rasio objek dominan di tengah frame.
    Skor lebih tinggi = HP lebih cenderung terlihat vertikal & utuh.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]

    # Fokus pada zona tengah bawah (area showcase HP, hindari text overlay)
    roi = gray[int(h * 0.05):int(h * 0.70), int(w * 0.10):int(w * 0.90)]

    # Deteksi tepi dengan Canny lalu cari kontur
    blurred = cv2.GaussianBlur(roi, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 120)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return 0.0

    # Cari kontur paling besar (kemungkinan adalah bodi HP)
    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)
    roi_area = roi.shape[0] * roi.shape[1]
    if roi_area == 0 or area < (roi_area * 0.03):
        return 0.0

    # Bounding rect dari kontur terbesar
    x, y, bw, bh = cv2.boundingRect(largest)
    if bw == 0:
        return 0.0

    aspect_ratio = bh / float(bw)  # > 1.5 artinya cenderung vertikal

    # Skor vertikal: semakin tinggi aspek rasio (> 1.6), semakin baik
    if aspect_ratio >= 1.8:
        vert_score = 1.0
    elif aspect_ratio >= 1.5:
        vert_score = 0.75
    elif aspect_ratio >= 1.0:
        vert_score = 0.3
    else:
        # Sangat horisontal (landscape) - penalti berat
        vert_score = 0.05

    # Skor area: HP yang mengisi sebagian besar frame mendapat bonus
    fill_ratio = area / roi_area
    fill_score = min(1.0, fill_ratio * 2.5)

    return (vert_score * 0.7 + fill_score * 0.3)


def _pick_best_vertical_back_frame_with_gemini(candidates_b64_list, api_key):
    """
    Meminta Gemini Vision memilih frame terbaik yang menampilkan bagian belakang HP
    secara vertikal dan utuh dari daftar kandidat (maks 9 frame).
    Mengembalikan indeks terpilih (0-based) atau None jika gagal.
    """
    if not api_key or not candidates_b64_list:
        return None

    n = len(candidates_b64_list)
    prompt = (
        f"You are given {n} candidate video frames numbered 1 to {n}. "
        "Each frame is a screenshot from a smartphone review video. "
        "Your task: pick the SINGLE BEST frame that shows "
        "(1) the BACK SIDE of the smartphone (rear camera module visible, NOT the front screen), "
        "(2) the ENTIRE phone body visible (not cropped or macro close-up), "
        "(3) the phone in a VERTICAL / UPRIGHT portrait orientation (taller than wide), "
        "(4) clean background with good lighting. "
        "If none show the full vertical back, pick the closest one. "
        "Reply with ONLY a JSON object: {\"best\": <number 1 to N>}. "
        "No explanation."
    )

    # Bangun payload multi-gambar
    parts = [{"text": prompt}]
    for i, b64_data in enumerate(candidates_b64_list):
        parts.append({
            "inline_data": {
                "mime_type": "image/jpeg",
                "data": b64_data
            }
        })
        parts.append({"text": f"Frame {i + 1}:"})

    payload = {"contents": [{"parts": parts}]}
    headers = {"Content-Type": "application/json"}

    # Coba model vision yang tersedia
    for model in VISION_MODELS[:4]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=25)
            if resp.status_code != 200:
                continue
            data = resp.json()
            raw_text = ""
            for cand in data.get("candidates", []):
                for part in cand.get("content", {}).get("parts", []):
                    raw_text += part.get("text", "")
            parsed = extract_json_object(raw_text)
            if parsed and "best" in parsed:
                idx = int(parsed["best"]) - 1
                if 0 <= idx < n:
                    print(f"      [Thumbnail] Gemini ({model}) memilih frame #{idx + 1} sebagai kandidat terbaik (belakang HP vertikal).", flush=True)
                    return idx
        except Exception as e:
            print(f"      [Thumbnail] Gemini Vision ({model}) error: {e}", flush=True)
            continue
    return None


def select_best_thumbnail_frame(all_final_clips, detector=None, api_key=None):
    """
    Memilih frame 1080x1920 yang menampilkan BAGIAN BELAKANG HP secara VERTIKAL dan UTUH
    dari klip-klip B-Roll (mengutamakan Bab 1 body_ip = tampak belakang HP yang paling ikonik).

    Tahap seleksi:
    1. Kumpulkan kandidat tajam & bebas wajah dari 10 klip pertama (Bab 1 & 2 prioritas).
    2. Skoring geometri lokal (aspek rasio kontur = mendeteksi vertikal vs horisontal).
    3. Gemini Vision memilih kandidat terbaik dari top-9 (back + vertikal + utuh).
    4. Fallback: frame dengan skor geometri + ketajaman tertinggi.
    """
    candidate_frames = []   # list of (score, vert_score, frame)
    candidate_b64s = []     # base64 JPEG untuk Gemini Vision

    # Klip prioritas: 10 pertama (body_ip & screen_os ada di sini)
    priority_clips = all_final_clips[:10] if len(all_final_clips) >= 4 else all_final_clips

    for clip_idx, clip_path in enumerate(priority_clips):
        if not os.path.exists(clip_path):
            continue
        cap = cv2.VideoCapture(clip_path)
        n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if n_frames <= 0:
            cap.release()
            continue

        # Sampel 4 titik per klip untuk mendapat kandidat lebih beragam
        sample_indices = [
            max(0, int(n_frames * 0.15)),
            max(0, int(n_frames * 0.38)),
            max(0, int(n_frames * 0.62)),
            max(0, int(n_frames * 0.85)),
        ]
        for f_idx in sample_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue

            sharp_score, _ = _score_frame_for_thumbnail(frame, clip_idx, detector)
            if sharp_score is None:
                continue  # wajah terdeteksi atau subscribe badge

            vert_score = _estimate_vertical_phone_score(frame)

            # Gabungan skor: 60% ketajaman + 40% vertikal
            combined = (sharp_score * 0.60) + (vert_score * 10000 * 0.40)
            candidate_frames.append((combined, vert_score, frame.copy()))

        cap.release()

    if not candidate_frames:
        # Fallback darurat: ambil frame pertama klip pertama
        if all_final_clips and os.path.exists(all_final_clips[0]):
            cap = cv2.VideoCapture(all_final_clips[0])
            ret, fr = cap.read()
            cap.release()
            if ret and fr is not None:
                return fr
        return None

    # Urutkan: skor gabungan terbaik dulu
    candidate_frames.sort(key=lambda x: x[0], reverse=True)

    # Ambil top 9 untuk Gemini Vision
    top_n = candidate_frames[:9]

    # Jika ada API key, gunakan Gemini untuk memilih frame terbaik secara semantik
    if api_key:
        for _, _, frm in top_n:
            # Encode ke JPEG base64 ukuran kecil (270x480) agar hemat kuota
            small = cv2.resize(frm, (270, 480), interpolation=cv2.INTER_AREA)
            _, buf = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
            candidate_b64s.append(base64.b64encode(buf.tobytes()).decode("utf-8"))

        gemini_pick = _pick_best_vertical_back_frame_with_gemini(candidate_b64s, api_key)
        if gemini_pick is not None:
            return top_n[gemini_pick][2]

    # Fallback: frame dengan vert_score tertinggi di antara top candidates
    top_n.sort(key=lambda x: x[1], reverse=True)
    return top_n[0][2]

def escape_ass_text(txt):
    return str(txt or "").replace("\\", "").replace("{", "(").replace("}", ")")

def generate_dynamic_short_thumbnail(all_final_clips, plan, video_title, lang, out_thumb_path, out_dir, detector=None, api_key=None):
    """
    Merender Gambar Thumbnail Dinamis Video Short (1080x1920) sesuai bahasa (`id` / `en`):
    1. Memilih frame B-Roll bagian BELAKANG HP secara VERTIKAL & UTUH via Gemini Vision.
    2. Layout bervariasi (bottom_text / bold_impact / top_text) + 5 palet warna berbeda
       sehingga setiap video menghasilkan tampilan thumbnail yang berbeda.
    3. Efek grafis: cinematic vignette gradient, diagonal accent stripe, badge pill rounded,
       glow line aksen, spec bar, dan double border frame.
    4. Tipografi bertingkat (Badge + Headline 2 baris + Spec bar) via FFmpeg ASS.
    """
    base_frame = select_best_thumbnail_frame(all_final_clips, detector=detector, api_key=api_key)
    if base_frame is None:
        return None

    h, w = 1920, 1080
    if base_frame.shape[0] != h or base_frame.shape[1] != w:
        base_frame = cv2.resize(base_frame, (w, h), interpolation=cv2.INTER_LANCZOS4)

    meta = ensure_dynamic_thumbnail_copy(plan, video_title, lang=lang)
    pal = meta["palette"]
    lay = meta["layout"]

    # ── 1. Sharpness boost + vibrance ───────────────────────────────────────
    blurred = cv2.GaussianBlur(base_frame, (0, 0), 2.4)
    canvas = cv2.addWeighted(base_frame, 1.22, blurred, -0.22, 6)

    # ── 2. Cinematic vignette gradient (zona teks gelap, foto produk terang) ─
    grad_mask = np.ones((h, 1), dtype=np.float32)
    top_end   = lay["frame_y_vignette_top_end"]
    bot_start = lay["frame_y_vignette_bot_start"]
    for y in range(0, top_end):
        t = 1.0 - (y / max(top_end, 1))
        grad_mask[y, 0] = 1.0 - (0.72 * (t ** 1.3))
    for y in range(bot_start, h):
        t = (y - bot_start) / max(float(h - bot_start), 1)
        grad_mask[y, 0] = 1.0 - (0.92 * (t ** 1.1))
    grad_3c = np.repeat(grad_mask, w, axis=1)[:, :, np.newaxis]
    canvas = np.clip(canvas.astype(np.float32) * grad_3c, 0, 255).astype(np.uint8)

    # ── 3. Dekorasi grafis dinamis ──────────────────────────────────────────
    overlay = canvas.copy()
    ac = pal["accent_bgr"]
    bg_dark = pal.get("gradient_bottom_bgr", (0, 0, 0))

    # Diagonal stripe aksen (kiri ke kanan, 1/3 lebar, tipis) — memberi kesan energik
    stripe_pts = np.array([
        [0, h - 320], [220, h - 320],
        [280, h - 260], [0, h - 260]
    ], dtype=np.int32)
    cv2.fillPoly(overlay, [stripe_pts], ac)

    # Badge Pill
    by0, by1 = lay["badge_y_range"]
    badge_txt = meta["badge"]
    badge_w = min(840, max(380, int(len(badge_txt) * 33 + 80)))
    bx0 = (w - badge_w) // 2
    # Isi solid + border putih
    cv2.rectangle(overlay, (bx0, by0), (bx0 + badge_w, by1),
                  pal["badge_bg_bgr"], -1, lineType=cv2.LINE_AA)
    cv2.rectangle(overlay, (bx0, by0), (bx0 + badge_w, by1),
                  pal["badge_border_bgr"], 3, lineType=cv2.LINE_AA)
    # Glow line tipis di bawah badge
    cv2.line(overlay, (bx0 + 20, by1 + 6), (bx0 + badge_w - 20, by1 + 6), ac, 4, lineType=cv2.LINE_AA)

    # Spec bar
    sy0, sy1 = lay["specs_bar_y"]
    sx0, sx1 = 60, w - 60
    cv2.rectangle(overlay, (sx0, sy0), (sx1, sy1), bg_dark, -1, lineType=cv2.LINE_AA)
    cv2.rectangle(overlay, (sx0, sy0), (sx1, sy1), ac, 3, lineType=cv2.LINE_AA)

    # Double border frame tepi layar
    cv2.rectangle(overlay, (18, 18), (w - 18, h - 18), ac, 5, lineType=cv2.LINE_AA)
    cv2.rectangle(overlay, (28, 28), (w - 28, h - 28), (255, 255, 255), 1, lineType=cv2.LINE_AA)

    # Corner accent squares di 4 sudut
    cs = 32  # ukuran sudut
    for cx, cy in [(18, 18), (w - 18 - cs, 18), (18, h - 18 - cs), (w - 18 - cs, h - 18 - cs)]:
        cv2.rectangle(overlay, (cx, cy), (cx + cs, cy + cs), ac, -1, lineType=cv2.LINE_AA)

    canvas = cv2.addWeighted(overlay, 0.90, canvas, 0.10, 0)

    # ── 4. Render teks via FFmpeg ASS ───────────────────────────────────────
    temp_bg_jpg = os.path.join(out_dir, f"_thumb_bg_{lang}.jpg")
    temp_ass    = os.path.join(out_dir, f"_thumb_overlay_{lang}.ass")
    cv2.imwrite(temp_bg_jpg, canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 96])

    b_str  = escape_ass_text(meta["badge"])
    l1_str = escape_ass_text(meta["line1"])
    l2_str = escape_ass_text(meta["line2"])
    sp_str = escape_ass_text(meta["specs"])

    l1_fs = lay["line1_fontsize"]
    l2_fs = lay["line2_fontsize"]
    l1_y  = lay["line1_y"]
    l2_y  = lay["line2_y"]
    sp_y  = lay["specs_y"]
    b_y   = (lay["badge_y_range"][0] + lay["badge_y_range"][1]) // 2

    ass_content = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ThumbBadge,Sans,44,{pal['ass_badge_primary']},&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,3,0,5,40,40,10,1
Style: ThumbLine1,Sans,{l1_fs},{pal['ass_line1_primary']},&H00000000,&H00000000,&H90000000,-1,0,0,0,100,100,1,0,1,10,5,5,40,40,10,1
Style: ThumbLine2,Sans,{l2_fs},{pal['ass_line2_primary']},&H00000000,&H00000000,&H90000000,-1,0,0,0,100,100,1,0,1,11,6,5,40,40,10,1
Style: ThumbSpecs,Sans,36,{pal['ass_spec_primary']},&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,5,40,40,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 2,0:00:00.00,0:00:05.00,ThumbBadge,,0,0,0,,{{\\pos(540,{b_y})}}{b_str}
Dialogue: 3,0:00:00.00,0:00:05.00,ThumbLine1,,0,0,0,,{{\\pos(540,{l1_y})}}{l1_str}
Dialogue: 3,0:00:00.00,0:00:05.00,ThumbLine2,,0,0,0,,{{\\pos(540,{l2_y})}}{l2_str}
Dialogue: 2,0:00:00.00,0:00:05.00,ThumbSpecs,,0,0,0,,{{\\pos(540,{sp_y})}}{sp_str}
"""
    with open(temp_ass, "w", encoding="utf-8") as f:
        f.write(ass_content)

    try:
        subprocess.run([
            "ffmpeg", "-nostdin", "-y", "-loglevel", "fatal",
            "-i", temp_bg_jpg,
            "-vf", f"ass={temp_ass}",
            "-frames:v", "1", "-q:v", "2",
            out_thumb_path
        ], check=True)
    except Exception:
        shutil.copy(temp_bg_jpg, out_thumb_path)

    for tmp_f in (temp_bg_jpg, temp_ass):
        if os.path.exists(tmp_f):
            try:
                os.remove(tmp_f)
            except Exception:
                pass

    return out_thumb_path, meta

def main():
    parser = argparse.ArgumentParser(description="AI Agent Pro Clipper 1080p (Smart Scene-Level VO Segmentation & Visual Sync)")
    parser.add_argument("--url", required=True)
    parser.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY"))
    parser.add_argument("--lang", choices=["id", "en"], default="id")
    parser.add_argument("--voice", default="Despina")
    parser.add_argument("--tts-model", default=None)
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--rescan-faces", action="store_true")
    args = parser.parse_args()

    if not args.api_key:
        print("[ERROR] Harap masukkan API Key dengan --api-key", flush=True)
        sys.exit(1)

    discover_available_models(args.api_key)

    work_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(work_dir, "face_detection_yunet.onnx")
    out_dir = os.path.join(work_dir, "output_clips")

    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    video_path, sub_file, video_title, video_desc, vid_id = download_video_and_subs(args.url, work_dir, args.skip_download)
    events = load_transcript_events(sub_file)
    timestamped_transcript = build_timestamped_transcript_digest(events)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_dur = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
    cap.release()

    face_free_segs = get_or_scan_face_free_segments(
        video_path, model_path, total_dur, vid_id, work_dir, min_duration=2.1, force_rescan=args.rescan_faces
    )

    print("\n[*] Tahap 1/4: Menganalisis Voiceover Bawaan untuk Memetakan 6 Bab & Sub-Adegan Visual Cerdas...", flush=True)
    plan_raw = analyze_native_transcript_and_build_chapters(
        video_title, video_desc, timestamped_transcript, total_dur, args.api_key, lang=args.lang
    )
    if isinstance(plan_raw, list) and len(plan_raw) > 0:
        plan = plan_raw[0] if isinstance(plan_raw[0], dict) else {"body_ip": str(plan_raw[0])}
    elif isinstance(plan_raw, dict):
        plan = plan_raw
    else:
        plan = {}

    for k, v in list(plan.items()):
        if isinstance(v, list):
            plan[k] = " ".join([str(x) for x in v])
        elif isinstance(v, dict):
            pass
        elif not isinstance(v, str):
            plan[k] = str(v or "")

    if not plan or not isinstance(plan, dict):
        print("   [!] Semua model teks sedang sibuk/gagal JSON, mengaktifkan penyusun bab deterministik dari transkrip...", flush=True)
        short_title = re.sub(r"[^a-zA-Z0-9\s\-]", "", video_title).strip()[:38] or ("this flagship phone" if args.lang == "en" else "HP Flagship ini")
        if args.lang == "en":
            _, _, en_cta_fb = pick_english_cta_style_and_fallback(video_title)
            plan = {
                "body_ip": {"start_sec": 45.0, "end_sec": 120.0, "script": f"{short_title} features a sleek flagship body design, durable build quality, and official water resistance rating."},
                "screen_os": {"start_sec": 120.0, "end_sec": 210.0, "script": "Its vibrant display panel delivers a smooth one hundred twenty hertz refresh rate with a clean, responsive software interface."},
                "perf_mem": {"start_sec": 210.0, "end_sec": 320.0, "script": "Powered by a fast processor paired with generous RAM and high speed storage, it handles heavy multitasking and gaming effortlessly."},
                "bat_feat": {"start_sec": 320.0, "end_sec": 430.0, "script": "The all day battery supports fast charging alongside complete connectivity features including NFC, stereo speakers, and an fingerprint sensor."},
                "camera": {"start_sec": 430.0, "end_sec": 550.0, "script": "Its main and selfie cameras capture sharp photos and stable high resolution video across various lighting conditions."},
                "cta": {"start_sec": 550.0, "end_sec": max(580.0, total_dur - 30.0), "script": en_cta_fb},
                "caption": f"Full Review of {short_title}!",
                "hashtags": "#SmartphoneReview #TechShorts #GadgetReview #Shorts"
            }
        else:
            plan = {
                "body_ip": {"start_sec": 45.0, "end_sec": 120.0, "script": f"{short_title} hadir dengan desain bodi belakang yang sangat elegan, material kokoh, serta perlindungan sertifikasi tahan air kelas flagship."},
                "screen_os": {"start_sec": 120.0, "end_sec": 210.0, "script": "Bagian layarnya menggunakan panel berkualitas tinggi dengan refresh rate seratus dua puluh hertz dan antarmuka sistem operasi yang mulus."},
                "perf_mem": {"start_sec": 210.0, "end_sec": 320.0, "script": "Dapur pacunya ditenagai chipset kencang dengan kapasitas RAM dan penyimpanan lega untuk melibas multitasking maupun game berat."},
                "bat_feat": {"start_sec": 320.0, "end_sec": 430.0, "script": "Daya tahan baterainya awet seharian penuh dengan pengisian daya cepat serta fitur pendukung lengkap seperti NFC dan speaker stereo."},
                "camera": {"start_sec": 430.0, "end_sec": 550.0, "script": "Sektor kamera utamanya sanggup menghasilkan foto dan perekaman video yang stabil dengan detail tajam serta warna natural di berbagai kondisi cahaya."},
                "cta": {"start_sec": 550.0, "end_sec": max(580.0, total_dur - 30.0), "script": "Dengan segala keunggulan yang ditawarkan, smartphone ini sangat layak masuk daftar pilihan utama kamu. Tulis pendapatmu di kolom komentar!"},
                "caption": f"Review Lengkap {short_title} Indonesia!",
                "hashtags": "#ReviewHP #GadgetIndonesia #Smartphone #Shorts"
            }

    chapters_with_scenes = []
    chapter_scripts = []
    print("\n📋 Hasil Analisa 6 Bab & Pemisahan Sub-Adegan Voiceover:", flush=True)
    for idx, cfg in enumerate(CHAPTER_CONFIG, 1):
        cid = cfg["id"]
        c_data = plan.get(cid, {})
        if not isinstance(c_data, dict):
            c_data = {"start_sec": 35.0 + (idx - 1) * 45.0, "end_sec": 80.0 + (idx - 1) * 45.0, "script": str(c_data or "")}
        built_scenes = ensure_chapter_scenes(cfg, c_data, events, total_dur)
        s_sec = float(c_data.get("start_sec", 45.0))
        e_sec = float(c_data.get("end_sec", min(total_dur - 10, s_sec + 120.0)))
        s_txt = sanitize_subtitle_text(c_data.get("script", ""))
        chapter_scripts.append(s_txt)
        chapters_with_scenes.append({
            "id": cid,
            "title": cfg["title"],
            "start_sec": s_sec,
            "end_sec": e_sec,
            "script": s_txt,
            "scenes": built_scenes
        })
        print(f"   Bab {idx} [{cfg['title']}] (Zona Bab: {int(s_sec)}s-{int(e_sec)}s):", flush=True)
        for sc_i, sc in enumerate(built_scenes, 1):
            print(f"      🎬 Adegan {idx}.{sc_i} [{sc['visual_focus']}] ({int(sc['start_sec'])}s-{int(sc['end_sec'])}s): \"{sc['script']}\"", flush=True)

    caption_txt = plan.get("caption", " ".join(chapter_scripts)[:140]).strip()
    hashtags_txt = normalize_hashtags(plan.get("hashtags", ""), lang=args.lang)

    print("\n[*] Tahap 2/4: Memanggil Gemini TTS (1x Panggilan) & Memisahkan Batas Suara Eksak Tiap Adegan...", flush=True)
    full_wav_path = os.path.join(out_dir, f"full_vo_{args.lang}.wav")
    ok_tts, used_model = generate_single_gemini_tts_chapters(
        chapter_scripts, full_wav_path, args.api_key, args.voice, args.tts_model
    )
    if not ok_tts:
        print("[ERROR] Gagal membuat audio TTS.", flush=True)
        sys.exit(1)

    ass_path = os.path.join(out_dir, f"pro_subtitles_1080p_{args.lang}.ass")
    srt_path = os.path.join(out_dir, f"final_subtitles_{args.lang}.srt")
    sync_json_path = os.path.join(out_dir, f"scene_vo_sync_{args.lang}.json")
    chapter_durations, target_final_dur, all_visual_cuts = analyze_wav_scenes_and_build_subtitles(
        chapters_with_scenes, full_wav_path, ass_path, srt_path, sync_json_path
    )
    print(f"🎙️ Sukses TTS ({used_model}) | Total Durasi: {target_final_dur:.2f}s | {len(all_visual_cuts)} Cut Adegan Terkunci Subtitle!", flush=True)
    for cut_item in all_visual_cuts:
        print(
            f"   ⏱️ [{cut_item['audio_start_s']:05.2f}s -> {cut_item['audio_end_s']:05.2f}s | {cut_item['duration_s']:.2f}s] "
            f"{cut_item['scene_id']} (Cut {cut_item['cut_in_scene_idx']}): \"{cut_item['cut_spoken_text']}\"",
            flush=True
        )

    print("\n[*] Tahap 3/4: Mencari & Memotong Klip Visual B-Roll Spesifik per Sub-Adegan (Terkunci Jeda Kalimat)...", flush=True)
    all_final_clips = []
    accepted_hists = []
    used_mid_times = []
    global_approved_pool = []

    clip_detector = cv2.FaceDetectorYN.create(
        model=model_path, config="", input_size=(270, 480),
        score_threshold=0.36, nms_threshold=0.3, top_k=5000
    )

    chap_cfg_map = {cfg["id"]: cfg for cfg in CHAPTER_CONFIG}
    chap_plan_map = {c["id"]: c for c in chapters_with_scenes}

    for cut_idx, cut_item in enumerate(all_visual_cuts, 1):
        cid = cut_item["chapter_id"]
        c_title = cut_item["chapter_title"]
        cfg = chap_cfg_map[cid]
        chap_info = chap_plan_map[cid]
        chap_s = float(chap_info["start_sec"])
        chap_e = float(chap_info["end_sec"])
        exact_dur = max(1.15, float(cut_item["duration_s"]))
        is_cam_chap = (cid == "camera")

        print(
            f"\n ---> Visual Cut {cut_idx}/{len(all_visual_cuts)} [{cut_item['scene_id']}] "
            f"| Durasi VO: {exact_dur:.2f}s | Fokus: {cut_item['visual_focus']}",
            flush=True
        )
        print(f"      🗣️ Teks VO Cut: \"{cut_item['cut_spoken_text']}\"", flush=True)

        candidates = collect_candidates_for_scene(
            cut_item, cfg, chap_s, chap_e, face_free_segs, events, used_mid_times, total_dur=total_dur
        )

        clip_out = os.path.join(
            out_dir,
            f"chap_{cut_item['chap_idx']:02d}_scene_{cut_item['scene_idx']:02d}_cut_{cut_item['cut_in_scene_idx']:02d}.mp4"
        )

        chosen_start = None
        for cand_s, cand_e in candidates:
            actual_end = cand_s + 0.08 + exact_dur
            if actual_end > (cand_e + 0.15):
                continue
            b64, mid_hist = extract_storyboard_and_hist(
                video_path, cand_s + 0.08, actual_end, detector=clip_detector, is_camera_chap=is_cam_chap
            )
            if not b64 or is_visually_duplicate(mid_hist, accepted_hists):
                continue

            raw_sub = get_transcript_slice(events, cand_s, actual_end)
            res = check_clean_broll_segment(
                b64, raw_sub, c_title, is_cam_chap, args.api_key,
                visual_focus=cut_item["visual_focus"],
                scene_vo=cut_item["scene_vo_script"]
            )
            if not res:
                continue

            is_clean = (
                res.get("is_product_broll") is True
                and res.get("has_face") is False
                and res.get("has_editor_overlay") is False
                and res.get("has_subscribe_popup", False) is False
                and (is_cam_chap or res.get("is_static_image", False) is False)
            )
            status = "LOLOS" if is_clean else "DITOLAK"
            print(f"      [{cand_s:.1f}s] {status} | {res.get('reason')}", flush=True)

            if is_clean:
                test_start = cand_s + 0.08
                cut_exact_broll_clip_1080p(video_path, test_start, exact_dur, clip_out)
                if not verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
                    print(f"      [!] Klip [{test_start:.1f}s] terdeteksi ada frame wajah / animasi Subscribe / gambar statis -> Cari kandidat berikutnya...", flush=True)
                    continue
                chosen_start = test_start
                accepted_hists.append(mid_hist)
                used_mid_times.append((cand_s + actual_end) / 2.0)
                if not is_cam_chap:
                    global_approved_pool.append(chosen_start)
                break

        if chosen_start is None:
            for cand_s, cand_e in candidates:
                test_start = cand_s + 0.08
                if verify_source_window_clean(video_path, test_start, exact_dur, clip_detector, is_camera_chap=is_cam_chap):
                    cut_exact_broll_clip_1080p(video_path, test_start, exact_dur, clip_out)
                    if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
                        chosen_start = test_start
                        used_mid_times.append(test_start + exact_dur / 2.0)
                        break
        if chosen_start is None:
            for fallback_s in reversed(global_approved_pool):
                cut_exact_broll_clip_1080p(video_path, fallback_s, exact_dur, clip_out)
                if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
                    chosen_start = fallback_s
                    break
            if chosen_start is None:
                for fs_s, fs_e in face_free_segs:
                    if fs_s < 38.0 or fs_e > (total_dur - 25.0):
                        continue
                    if (fs_e - fs_s) >= (exact_dur + 0.2):
                        sub_ctx = get_transcript_slice(events, max(0.0, fs_s - 4.0), fs_s + exact_dur + 4.0).lower()
                        if any(bad_kw in sub_ctx for bad_kw in SUBSCRIBE_BLACKLIST_KEYWORDS):
                            continue
                        cut_exact_broll_clip_1080p(video_path, fs_s + 0.1, exact_dur, clip_out)
                        if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
                            chosen_start = fs_s + 0.1
                            break

        all_final_clips.append(clip_out)

    list_file = os.path.join(out_dir, "concat_list.txt")
    with open(list_file, "w") as f:
        for c in all_final_clips:
            f.write(f"file '{os.path.abspath(c)}'\n")

    merged_silent_mp4 = os.path.join(out_dir, "merged_clean_silent_1080p.mp4")
    subprocess.run([
        "ffmpeg", "-nostdin", "-y", "-loglevel", "fatal",
        "-fflags", "+genpts", "-f", "concat", "-safe", "0",
        "-i", list_file, "-c", "copy", merged_silent_mp4
    ], check=True)

    print(f"\n[*] Tahap 4/4: Merender Video Akhir 1080p ({len(all_final_clips)} Adegan Sinkron VO + Subtitle 2-3 Kata)...", flush=True)
    vf_chain = f"fps=30,setpts=PTS-STARTPTS,ass={ass_path}"
    af_chain = f"apad=whole_dur={target_final_dur:.2f}"

    final_output = os.path.join(out_dir, f"FINAL_PRO_1080P_{args.voice.upper()}_{args.lang.upper()}.mp4")
    subprocess.run([
        "ffmpeg", "-nostdin", "-y", "-loglevel", "fatal",
        "-i", merged_silent_mp4, "-i", full_wav_path,
        "-vf", vf_chain, "-af", af_chain,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "superfast", "-crf", "19", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
        "-t", f"{target_final_dur:.2f}", final_output
    ], check=True)

    final_txt_path = save_matching_txt(final_output, caption_txt, hashtags_txt, lang=args.lang)

    thumb_output = os.path.join(out_dir, f"THUMBNAIL_PRO_1080P_{args.voice.upper()}_{args.lang.upper()}.jpg")
    print(f"\n[*] Membuat Gambar Thumbnail Dinamis Video Short ({args.lang.upper()})...", flush=True)
    thumb_res = generate_dynamic_short_thumbnail(
        all_final_clips, plan, video_title, args.lang, thumb_output, out_dir,
        detector=clip_detector, api_key=args.api_key
    )
    if thumb_res and os.path.exists(thumb_output):
        _, thumb_meta = thumb_res
        print(
            f"🖼️ Thumbnail Siap: [{thumb_meta['badge']}] {thumb_meta['line1']} / {thumb_meta['line2']} ({thumb_meta['specs']})",
            flush=True
        )

    target_hp_dir = "/sdcard/Download/Broll_Clips"
    try:
        if os.path.exists(target_hp_dir):
            shutil.rmtree(target_hp_dir)
        os.makedirs(target_hp_dir, exist_ok=True)
        shutil.copy(final_output, target_hp_dir)
        shutil.copy(final_txt_path, target_hp_dir)
        shutil.copy(srt_path, target_hp_dir)
        if os.path.exists(thumb_output):
            shutil.copy(thumb_output, target_hp_dir)
        print("\n=====================================================", flush=True)
        print(f" ✅ SELESAI! ({len(all_visual_cuts)} Adegan Terkunci VO Per Klausa | Durasi: {target_final_dur:.1f}s)", flush=True)
        print(f" 🎬 Video 1080p  : /sdcard/Download/Broll_Clips/{os.path.basename(final_output)}", flush=True)
        if os.path.exists(thumb_output):
            print(f" 🖼️ Thumbnail    : /sdcard/Download/Broll_Clips/{os.path.basename(thumb_output)}", flush=True)
        print(f" 📝 File Caption : /sdcard/Download/Broll_Clips/{os.path.basename(final_txt_path)}", flush=True)
        print(f" 📊 Peta Sinkron : {sync_json_path}", flush=True)
        print("=====================================================", flush=True)
    except Exception as e:
        print(f" [!] Info salin ke HP: {e}")

if __name__ == "__main__":
    main()
