import os
import re
import sys
import ast
import cv2
import json
import math
import time
import wave
import random
import base64
import shutil
import hashlib
import tempfile
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

SCENE_CATALOG = [
    {
        "id": "body",
        "title": "Body & Desain",
        "keywords": ["desain", "bodi", "body", "dimensi", "tipis", "tebal", "gram", "bobot", "warna", "backdoor", "frame", "fisik", "material", "ergonomis", "slim", "unboxing", "first look"],
        "visual_rule": "Penampakan fisik 1 unit HP (bodi belakang/samping, ketebalan frame, material/warna, modul kamera luar, digenggam atau di atas meja; BUKAN gameplay game, BUKAN menu Settings).",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 2,
    },
    {
        "id": "ketahanan_fisik",
        "title": "Ketahanan Fisik",
        "keywords": ["ip5", "ip6", "ip68", "ip69", "ip64", "ip54", "tahan air", "debu", "jatuh", "wastafel", "air", "siram", "rendam", "banting", "gores", "gorilla glass", "mil-std", "durability", "water", "drop"],
        "visual_rule": "Uji ketahanan fisik pada 1 unit HP (disiram/direndam air, uji jatuh/banting/gores, frame kokoh, demonstrasi IP Rating).",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 2,
    },
    {
        "id": "design_layar",
        "title": "Design Layar & Fiturnya",
        "keywords": ["layar", "screen", "display", "amoled", "ips", "oled", "inci", "inch", "hz", "refresh", "nits", "bezel", "punch hole", "curved", "brightness", "hdr"],
        "visual_rule": "Tampilan layar depan 1 unit HP menyala memperlihatkan bezel, kecerahan, ketajaman warna, visual video/scrolling layar (BUKAN bermain game penuh & BUKAN menu Settings).",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 2,
    },
    {
        "id": "baterai_daya",
        "title": "Daya & Pengisian Baterai",
        "keywords": ["baterai", "battery", "mah", "charging", "cas", "watt", "flash charge", "supervooc", "adapter", "charger", "kabel", "persen", "daya"],
        "visual_rule": "Pengisian daya atau uji baterai pada 1 unit HP (mencolok kabel charger ke port USB, indikator/animasi persen baterai mengisi cepat, atau kepala adaptor bersama HP).",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 2,
    },
    {
        "id": "os",
        "title": "OS & Antarmuka",
        "keywords": ["android", "os", "ui", "hyperos", "oneui", "coloros", "funtouch", "hios", "antarmuka", "settings", "pengaturan", "about phone", "tentang ponsel", "update", "ai feature", "menu"],
        "visual_rule": "Navigasi sistem operasi/antarmuka UI di layar 1 unit HP (Control Center, laci aplikasi, menu Settings, About Phone, kustomisasi OS/UI).",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 2,
    },
    {
        "id": "benchmark_dapur_pacu",
        "title": "Benchmark & Dapur Pacu",
        "keywords": ["chipset", "prosesor", "snapdragon", "dimensity", "helio", "unisoc", "exynos", "ram", "lpddr", "ufs", "storage", "antutu", "geekbench", "gaming", "game", "pubg", "mlbb", "genshin", "fps", "performa", "thermal", "suhu"],
        "visual_rule": "Bermain game (gameplay PUBG/MLBB/Genshin/balapan langsung pada layar 1 unit HP fisik di tangan/meja) atau aplikasi skor benchmark AnTuTu/Geekbench/3DMark/FPS meter pada 1 unit HP fisik (WAJIB terlihat bodi fisik HP nyata; BUKAN slide grafis 3D logo chipset/teks melayang tanpa unit HP).",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 3,
    },
    {
        "id": "speaker",
        "title": "Speaker & Audio",
        "keywords": ["speaker", "stereo", "audio", "suara", "volume", "dolby", "grille", "lubang speaker", "desibel", "sound"],
        "visual_rule": "Close-up lubang/grille speaker atas atau bawah HP, atau pengujian suara/volume musik/audio test pada 1 unit HP.",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 1,
    },
    {
        "id": "fitur_unik",
        "title": "Fitur Unik atau Unggulan",
        "keywords": ["fitur", "unik", "unggulan", "nfc", "fingerprint", "sidik jari", "in-display", "ir blaster", "led", "glyph", "aura", "ai", "trigger", "tipis", "slim", "special", "signature"],
        "visual_rule": "Demonstrasi fitur pembeda/unggulan khas HP tersebut (sidik jari di layar/samping, NFC tap kartu, lampu notifikasi/LED belakang, bodi ultra-tipis/melengkung ekstrem, stylus, tombol aksi, sensor khusus).",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 2,
    },
    {
        "id": "kamera",
        "title": "Fitur Kamera Depan & Belakang",
        "keywords": ["kamera", "camera", "megapixel", "mp", "ois", "eis", "selfie", "depan", "belakang", "ultrawide", "telephoto", "foto", "video", "1080p", "4k", "60fps", "lensa", "potret"],
        "visual_rule": "Close-up modul lensa kamera HP, antarmuka viewfinder aplikasi kamera pada HP, ATAU sampel foto/video hasil jepretan kamera (pemandangan, bangunan, malam, objek — boleh ada watermark bawah/badge mode kamera, WAJIB bebas wajah manusia).",
        "allow_phone_count_zero": True,
        "allow_static_local": True,
        "max_cuts": 3,
    },
    {
        "id": "cta",
        "title": "CTA",
        "keywords": ["kesimpulan", "harga", "worth", "beli", "verdict", "price", "rekomendasi", "pilihan", "summary"],
        "visual_rule": "Hero shot tampilan keseluruhan 1 unit HP yang estetik & elegan (mis. tampak belakang penuh atau hands-on rapi) cocok untuk penutup/CTA.",
        "allow_phone_count_zero": False,
        "allow_static_local": False,
        "max_cuts": 2,
    },
]
SCENE_CATALOG_MAP = {c["id"]: c for c in SCENE_CATALOG}
CHAPTER_CONFIG = SCENE_CATALOG

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

def _find_existing_sub_file(work_dir):
    """Mencari file transkrip lokal yang sudah terunduh (.json3 diprioritaskan, lalu .vtt / .srt)."""
    exts = (".json3", ".vtt", ".srt")
    found = []
    for f in sorted(os.listdir(work_dir)):
        low = f.lower()
        if low.startswith("source_video") and low.endswith(exts) and not low.endswith(".part"):
            prio = exts.index(next(e for e in exts if low.endswith(e)))
            found.append((prio, os.path.join(work_dir, f)))
    if not found:
        return None
    found.sort(key=lambda x: x[0])
    return found[0][1]

def extract_youtube_chapters(info_data):
    """Mengekstrak daftar chapter YouTube dari metadata info.json menjadi list dict bersih."""
    if not isinstance(info_data, dict):
        return []
    chapters = []
    for ch in (info_data.get("chapters") or []):
        if not isinstance(ch, dict):
            continue
        title = sanitize_subtitle_text(ch.get("title", ""))
        try:
            s_t = float(ch.get("start_time", 0.0))
            e_t = float(ch.get("end_time", s_t))
        except Exception:
            continue
        if title and e_t > s_t:
            chapters.append({"start_sec": round(s_t, 2), "end_sec": round(e_t, 2), "title": title})
    return chapters

def _resolve_cookies_path(work_dir, cookies_arg=None):
    if cookies_arg and os.path.exists(cookies_arg):
        return cookies_arg
    auto_ck = os.path.join(work_dir, "cookies.txt")
    return auto_ck if os.path.exists(auto_ck) else None

def _download_subtitles_resilient(url, work_dir, info_data, cookies_path=None):
    """
    Mengunduh subtitle YouTube secara bertahap agar terhindar dari HTTP 429:
    - Memprioritaskan track manual (`subtitles`) atau bahasa asli video (`automatic_captions` tanpa tlang=),
      karena permintaan multi-bahasa terjemahan otomatis dalam satu panggilan sering memicu 429.
    """
    sub_file = _find_existing_sub_file(work_dir)
    if sub_file:
        return sub_file

    info_data = info_data if isinstance(info_data, dict) else {}
    native_lang = str(info_data.get("language") or "").split("-")[0].strip().lower()
    manual_keys = list((info_data.get("subtitles") or {}).keys())
    auto_keys = list((info_data.get("automatic_captions") or {}).keys())

    # Tentukan daftar strategi terurut yang paling aman dari 429
    attempts = []
    if manual_keys:
        pref = [k for k in (native_lang, "id", "en") if k and k in manual_keys]
        if not pref:
            pref = [manual_keys[0]]
        attempts.append((["--write-sub"], pref[0]))

    # Cari bahasa asli video di automatic_captions (hindari memaksa id,en lewat endpoint tlang=)
    orig_candidates = []
    for k in (native_lang, "en", "id"):
        if not k:
            continue
        matched = next((ak for ak in auto_keys if ak == k or ak.startswith(k + "-orig")), None)
        if matched and matched not in orig_candidates:
            orig_candidates.append(matched)
    if orig_candidates:
        attempts.append((["--write-auto-sub"], orig_candidates[0]))
    elif not attempts:
        # Jika info_data belum memiliki daftar track, coba bahasa asli atau id/en terpisah
        attempts.append((["--write-auto-sub", "--write-sub"], native_lang or "id"))
        if native_lang not in ("en",):
            attempts.append((["--write-auto-sub"], "en"))

    base_cmd = [
        "yt-dlp", "--ignore-errors", "--skip-download",
        "--js-runtimes", "node",
        "--extractor-args", "youtube:player_client=android,web",
        "--sleep-subtitles", "3", "--sleep-requests", "1.5",
        "--sub-format", "json3/vtt/srt",
        "-o", os.path.join(work_dir, "source_video.%(ext)s"),
    ]
    if cookies_path:
        base_cmd += ["--cookies", cookies_path]

    for idx, (flags, sub_lang) in enumerate(attempts[:2]):
        if idx > 0:
            time.sleep(2.5)
        cmd = base_cmd + flags + ["--sub-lang", sub_lang, url]
        subprocess.run(cmd, check=False)
        sub_file = _find_existing_sub_file(work_dir)
        if sub_file:
            print(f"[+] Berhasil mengunduh subtitle YouTube ({os.path.basename(sub_file)}).", flush=True)
            return sub_file
    return None

def download_video_and_subs(url, work_dir, skip_download=False, cookies_path=None):
    video_out = os.path.join(work_dir, "source_video.mp4")
    info_out = os.path.join(work_dir, "source_video.info.json")
    vid_id = extract_video_id(url)
    ck_path = _resolve_cookies_path(work_dir, cookies_path)

    sub_file = _find_existing_sub_file(work_dir)
    video_title = "Smartphone Review"
    video_desc = ""
    info_data = {}
    cached_id = None

    def _read_info():
        nonlocal info_data, video_title, video_desc, cached_id
        if os.path.exists(info_out):
            try:
                with open(info_out, "r", encoding="utf-8") as f:
                    info_data = json.load(f)
                    video_title = info_data.get("title", video_title)
                    video_desc = info_data.get("description", "")[:5000]
                    cached_id = info_data.get("id")
            except Exception:
                pass

    _read_info()
    youtube_chapters = extract_youtube_chapters(info_data)

    if os.path.exists(video_out) and (skip_download or cached_id == vid_id):
        _, height = check_video_info(video_out)
        print(f"\n[*] Menggunakan video lokal ({video_title} - {height}p)...", flush=True)
        ensure_1080p_h264(video_out)
        if not sub_file:
            gem_cache = os.path.join(work_dir, "source_video.gemini_subs.json")
            has_valid_gem_cache = False
            if os.path.exists(gem_cache):
                try:
                    gd = json.load(open(gem_cache, "r", encoding="utf-8"))
                    has_valid_gem_cache = (gd.get("vid_id") == vid_id and bool(gd.get("events")))
                except Exception:
                    pass
            if not has_valid_gem_cache:
                sub_file = _download_subtitles_resilient(url, work_dir, info_data, ck_path)
            elif not sub_file:
                sub_file = gem_cache
        return video_out, sub_file, video_title, video_desc, vid_id, youtube_chapters

    # Jika pindah ke URL video baru, bersihkan subtitle & cache lama agar tidak tercampur
    if cached_id and cached_id != vid_id:
        for old_f in os.listdir(work_dir):
            if old_f.startswith("source_video") and (old_f.endswith((".json3", ".vtt", ".srt")) or old_f == "source_video.gemini_subs.json"):
                try:
                    os.remove(os.path.join(work_dir, old_f))
                except Exception:
                    pass
        sub_file = None

    print("\n[*] Mengunduh video 1080p H.264 dan metadata dari YouTube...", flush=True)
    if os.path.exists(video_out):
        os.remove(video_out)

    cmd = [
        "yt-dlp",
        "--ignore-errors",
        "--js-runtimes", "node",
        "--write-info-json",
        "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
        "--merge-output-format", "mp4",
        "-o", os.path.join(work_dir, "source_video.%(ext)s"),
        url
    ]
    if ck_path:
        cmd[1:1] = ["--cookies", ck_path]
    subprocess.run(cmd, check=False)

    if not os.path.exists(video_out):
        fb_cmd = [
            "yt-dlp", "--js-runtimes", "node", "--write-info-json",
            "-f", "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=1080]",
            "--merge-output-format", "mp4",
            "-o", video_out, url
        ]
        if ck_path:
            fb_cmd[1:1] = ["--cookies", ck_path]
        subprocess.run(fb_cmd, check=True)

    ensure_1080p_h264(video_out)
    _read_info()
    youtube_chapters = extract_youtube_chapters(info_data)
    sub_file = _download_subtitles_resilient(url, work_dir, info_data, ck_path)

    return video_out, sub_file, video_title, video_desc, vid_id, youtube_chapters

def _parse_ts_to_seconds(ts_str):
    parts = ts_str.strip().replace(",", ".").split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
    except Exception:
        return 0.0
    return 0.0

def _parse_vtt_or_srt_events(sub_file):
    """Membaca subtitle format .vtt atau .srt dan membuang tag HTML serta duplikasi rolling."""
    try:
        with open(sub_file, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.read().splitlines()
    except Exception:
        return []
    ts_re = re.compile(r"((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})")
    parsed = []
    i = 0
    while i < len(lines):
        m = ts_re.search(lines[i])
        if not m:
            i += 1
            continue
        s_t = _parse_ts_to_seconds(m.group(1))
        e_t = max(s_t + 0.2, _parse_ts_to_seconds(m.group(2)))
        i += 1
        cue_lines = []
        while i < len(lines) and lines[i].strip():
            clean = re.sub(r"<[^>]+>", " ", lines[i]).strip()
            clean = " ".join(clean.split())
            if clean and not clean.startswith("NOTE"):
                cue_lines.append(clean)
            i += 1
        text = " ".join(cue_lines).strip()
        if text:
            if parsed and parsed[-1][2] == text and (s_t - parsed[-1][1]) < 0.8:
                parsed[-1] = (parsed[-1][0], max(parsed[-1][1], e_t), text)
            else:
                parsed.append((s_t, e_t, text))
    return parsed

def load_transcript_events(sub_file):
    if not sub_file or not os.path.exists(sub_file):
        return []
    low = sub_file.lower()
    if low.endswith(".gemini_subs.json"):
        try:
            data = json.load(open(sub_file, "r", encoding="utf-8"))
            return [
                (float(ev["start_s"]), float(ev["end_s"]), str(ev["text"]).strip())
                for ev in (data.get("events") or [])
                if str(ev.get("text", "")).strip()
            ]
        except Exception:
            return []
    if low.endswith((".vtt", ".srt")):
        return _parse_vtt_or_srt_events(sub_file)
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

def transcribe_video_audio_with_gemini(video_path, vid_id, work_dir, total_dur, api_key, youtube_chapters=None):
    """
    Fallback tahan-429: Jika subtitle YouTube gagal diunduh (HTTP 429), ekstrak audio mono MP3
    ringan (16kbps) langsung dari source_video.mp4 dan transkripsikan ber-timestamp memakai Gemini Multimodal,
    lalu cache ke source_video.gemini_subs.json.
    """
    cache_path = os.path.join(work_dir, "source_video.gemini_subs.json")
    if os.path.exists(cache_path):
        try:
            cached = json.load(open(cache_path, "r", encoding="utf-8"))
            if cached.get("vid_id") == vid_id and cached.get("events"):
                print(f"[+] Memuat {len(cached['events'])} segmen transkrip audio dari cache Gemini.", flush=True)
                return [
                    (float(ev["start_s"]), float(ev["end_s"]), str(ev["text"]).strip())
                    for ev in cached["events"]
                ]
        except Exception:
            pass

    if not api_key or not video_path or not os.path.exists(video_path):
        return []

    print("[!] Subtitle YouTube gagal (429/tidak tersedia) -> Memulihkan transkrip ber-timestamp langsung dari audio video via Gemini...", flush=True)
    chunk_len = 480.0
    n_chunks = max(1, int(math.ceil(max(total_dur, 1.0) / chunk_len)))
    all_events = []
    chap_hint = ""
    if youtube_chapters:
        chap_hint = "YouTube Chapters: " + "; ".join(f"[{int(c['start_sec'])}s-{int(c['end_sec'])}s] {c['title']}" for c in youtube_chapters)

    with tempfile.TemporaryDirectory() as tmp_aud_dir:
        for ch_i in range(n_chunks):
            off_s = ch_i * chunk_len
            seg_dur = min(chunk_len, max(1.0, total_dur - off_s))
            if seg_dur < 3.0:
                continue
            mp3_path = os.path.join(tmp_aud_dir, f"aud_{ch_i}.mp3")
            cmd = [
                "ffmpeg", "-nostdin", "-y", "-loglevel", "fatal",
                "-ss", f"{off_s:.2f}", "-t", f"{seg_dur:.2f}", "-i", video_path,
                "-vn", "-ac", "1", "-ar", "16000", "-b:a", "16k", "-f", "mp3", mp3_path
            ]
            res = subprocess.run(cmd, check=False)
            if res.returncode != 0 or not os.path.exists(mp3_path) or os.path.getsize(mp3_path) < 1000:
                continue
            b64_aud = base64.b64encode(open(mp3_path, "rb").read()).decode("utf-8")
            prompt = "\n".join([
                f"Listen to this smartphone review audio segment (segment duration: {int(seg_dur)} seconds, video offset +{int(off_s)}s).",
                chap_hint,
                "Produce a timestamped transcript summary broken into ~12-20 second windows.",
                "IMPORTANT: Translate Hindi/other speech cleanly into Indonesian/English technical phrasing and preserve EVERY real phone spec (chipset, RAM/storage, mAh, Watt, IP rating, display Hz/nits, camera MP/FPS, speaker/OS features, gaming/benchmark test).",
                "Timestamps (`start_s`, `end_s`) MUST be relative to THIS audio clip (`0.0` to `{:.1f}`).".format(seg_dur),
                'Return ONLY pure JSON: {"events": [{"start_s": 0.0, "end_s": 18.0, "text": "..."}]}'
            ])
            payload = {
                "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "audio/mp3", "data": b64_aud}}]}],
                "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
            }
            parsed = call_gemini_json(payload, api_key)
            evs = parsed.get("events") if isinstance(parsed, dict) else None
            if isinstance(evs, list):
                for ev in evs:
                    if not isinstance(ev, dict):
                        continue
                    txt = " ".join(str(ev.get("text", "")).split())
                    if not txt:
                        continue
                    try:
                        rs = max(0.0, min(seg_dur, float(ev.get("start_s", 0.0))))
                        re_t = max(rs + 1.0, min(seg_dur, float(ev.get("end_s", rs + 15.0))))
                    except Exception:
                        continue
                    all_events.append((round(off_s + rs, 2), round(off_s + re_t, 2), txt))

    if all_events:
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump({
                    "vid_id": vid_id,
                    "events": [{"start_s": s, "end_s": e, "text": t} for s, e, t in all_events]
                }, f, ensure_ascii=False, indent=2)
            print(f"[+] Berhasil memulihkan {len(all_events)} segmen transkrip audio ke cache lokal.", flush=True)
        except Exception:
            pass
    return all_events

def build_timestamped_transcript_digest(events, max_chars=16000, youtube_chapters=None):
    blocks = []
    if youtube_chapters:
        ch_lines = ["[YOUTUBE CHAPTERS]"] + [
            f"[{int(c['start_sec'])}s-{int(c['end_sec'])}s] {c['title']}"
            for c in youtube_chapters
        ]
        blocks.append("\n".join(ch_lines))
        blocks.append("[TRANSCRIPT]")

    bucket_start = None
    bucket_end = None
    bucket_texts = []

    for s, e, txt in (events or []):
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

    if not events and len(blocks) <= 1:
        return "\n".join(blocks)[:max_chars] if blocks else ""
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
        if len(parsed) > 0 and all(isinstance(x, dict) for x in parsed):
            if any("category" in x for x in parsed):
                return {"items": parsed}
            if any("start_s" in x or "start_sec" in x for x in parsed):
                return {"events": parsed}
        if len(parsed) == 1 and isinstance(parsed[0], dict):
            parsed = parsed[0]
        elif len(parsed) > 0 and all(isinstance(x, dict) for x in parsed):
            merged = {}
            for item in parsed:
                cid = item.get("chapter_id") or item.get("key") or item.get("id")
                if cid and isinstance(cid, str):
                    merged[cid] = item
                else:
                    merged.update(item)
            if merged:
                parsed = merged
    if isinstance(parsed, dict):
        expected = {
            "body", "ketahanan_fisik", "design_layar", "baterai_daya", "os",
            "benchmark_dapur_pacu", "speaker", "fitur_unik", "kamera", "cta",
            "body_ip", "screen_os", "perf_mem", "bat_feat", "camera",
            "is_product_broll", "items", "events", "picks", "best"
        }
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
        "body": ["body", "desain_body"],
        "ketahanan_fisik": ["ketahanan_fisik", "durability"],
        "design_layar": ["design_layar", "layar", "display"],
        "baterai_daya": ["baterai_daya", "baterai", "battery"],
        "os": ["os"],
        "benchmark_dapur_pacu": ["benchmark_dapur_pacu", "dapur_pacu", "gaming", "benchmark"],
        "speaker": ["speaker", "audio"],
        "fitur_unik": ["fitur_unik", "fitur_unggulan"],
        "kamera": ["kamera", "camera"],
        "body_ip": ["body_ip"],
        "screen_os": ["screen_os"],
        "perf_mem": ["perf_mem"],
        "bat_feat": ["bat_feat"],
        "cta": ["cta", "conclusion"]
    }
    all_key_names = "|".join([a for sub in alias_map.values() for a in sub] + ["caption", "hashtags"])
    salvaged = {}
    step = max(30.0, (total_dur - 45.0) / 8.0)
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
            if not sc_m:
                # Mendukung nilai string langsung {"body": "..."}
                str_m = re.search(rf'"{k}"\s*:\s*"([^"\n\r}}]+)"', raw_txt)
                if str_m:
                    salvaged[canon_k] = {"start_sec": def_s, "end_sec": def_e, "script": str_m.group(1).strip(), "scenes": []}
                    break
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
        hmp = bool(re.search(r'"?has_multiple_phones"?\s*:\s*true', txt, re.IGNORECASE))
        rs_m = re.search(r'"?reason"?\s*:\s*"([^"]*)"', txt, re.IGNORECASE)
        return {
            "is_product_broll": ipb,
            "has_face": hf,
            "has_editor_overlay": heo or hsp,
            "has_subscribe_popup": hsp,
            "is_static_image": isi,
            "has_multiple_phones": hmp,
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

def _video_rng(video_title=""):
    """Membuat generator random unik berbasis waktu & hash judul video agar tiap eksekusi segar."""
    seed_val = int(time.time() * 1000) ^ int(hashlib.md5(str(video_title or "").encode("utf-8", errors="ignore")).hexdigest()[:8], 16)
    return random.Random(seed_val)

ENGLISH_OPENING_HOOK_VARIATIONS = [
    (
        "Bold Disbelief",
        "Open with genuine shock at what this phone packs for its tier (e.g., 'How on earth does [Phone] pack flagship hardware like this?')",
        "How does {phone} pack this much power at its price?!"
    ),
    (
        "Stop-Scrolling Warning",
        "Open with a buyer pause tension hook naming the phone (e.g., 'Wait before buying anything else—[Phone] just rewrote the rules!')",
        "Wait before buying anything else, {phone} just changed the game!"
    ),
    (
        "Direct Rival Punch",
        "Open by contrasting how expensive rivals look weak next to this phone (e.g., 'Rival flagships look seriously overpriced next to [Phone]!')",
        "Expensive rivals look outdated the moment {phone} hits your hand!"
    ),
    (
        "Hidden Gem Reveal",
        "Open like uncovering an underrated winner viewers almost missed (e.g., 'Almost nobody noticed [Phone], and ignoring it would be a huge mistake!')",
        "Almost nobody saw {phone} coming, and it breaks every expectation!"
    ),
    (
        "Build & Toughness Flex",
        "Open led by striking physical design, slim profile, or rugged toughness (e.g., '[Phone] feels razor-slim yet takes real-world hits like a tank!')",
        "{phone} stays impossibly sleek while handling real-world drops and water!"
    ),
    (
        "Unfiltered Reality Check",
        "Open cutting straight through marketing buzz (e.g., 'Forget spec-sheet hype—here is what actually makes [Phone] hit different!')",
        "Forget marketing buzz—{phone} proves its worth right out of the box!"
    ),
    (
        "Provocative Challenge",
        "Open with a sharp high-retention question naming the phone (e.g., 'Can [Phone] seriously embarrass phones costing twice as much?')",
        "Can {phone} really embarrass flagships costing twice as much?!"
    ),
    (
        "Generational Leap",
        "Open emphasizing an unexpected leap from last year's model (e.g., 'Nobody expected [Phone] to level up hardware this dramatically!')",
        "Nobody expected {phone} to leap ahead this hard in one release!"
    ),
]

ENGLISH_THUMB_STYLE_ANGLES = [
    ("Urgent Warning", "WAIT BEFORE BUYING! / DON'T BLINK! / THINK TWICE?! / CHECK THIS FIRST!"),
    ("Price-Shock Disbelief", "HOW IS THIS LEGAL?! / TOO CHEAP TO BE REAL?! / INSANE FOR THE PRICE!"),
    ("Rival Knockout", "RIVALS IN TROUBLE! / RIP EXPENSIVE PHONES! / OVERPOWERED?!"),
    ("Spec Highlight Shock", "UNREAL HARDWARE! / BATTERY MONSTER! / FLAGSHIP IN DISGUISE?!"),
    ("Hands-On Truth", "THE REAL CATCH?! / UNFILTERED VERDICT! / SERIOUSLY THIS GOOD?!"),
]

def pick_english_opening_hook_style(video_title=""):
    """Memilih arketipe hook pembuka Bahasa Inggris secara bervariasi agar kalimat pertama body_ip selalu dinamis."""
    rng = _video_rng(video_title + "_hook")
    return rng.choice(ENGLISH_OPENING_HOOK_VARIATIONS)

def pick_english_thumbnail_angle(video_title=""):
    """Memilih sudut copywriting thumbnail Bahasa Inggris agar tidak mengulang klise yang sama."""
    rng = _video_rng(video_title + "_thumb")
    return rng.choice(ENGLISH_THUMB_STYLE_ANGLES)

def pick_english_cta_style_and_fallback(video_title=""):
    """Memilih gaya variasi CTA Bahasa Inggris (Like & Subscribe) yang selalu berbeda di setiap video/eksekusi."""
    rng = _video_rng(video_title)
    idx = rng.randrange(len(ENGLISH_CTA_VARIATIONS))
    return idx, ENGLISH_CTA_VARIATIONS[idx], ENGLISH_CTA_FALLBACK_TEMPLATES[idx]

def _remove_leading_word_repetition(text, prev_text=""):
    """
    Menghapus pengulangan kata/frasa berurutan di dalam CTA maupun kata pengulangan saat transisi
    masuk dari akhir adegan sebelum CTA (`prev_text`).
    Contoh: 'Baterai badak, baterai awet seharian' -> 'Baterai badak, awet seharian'
    """
    txt = " ".join(str(text or "").split())
    if not txt:
        return txt
    # 1. Hapus pengulangan kata identik berdekatan (stutter), mis. 'that that', 'baterai baterai'
    txt = re.sub(r"\b([a-zA-Z0-9]+)\s+\1\b", r"\1", txt, flags=re.IGNORECASE)

    # 2. Jika akhir adegan sebelum CTA mengulang 1-3 kata awal CTA (transisi masuk CTA), pangkas duplikatnya (berulang hingga bersih)
    if prev_text:
        prev_words = [re.sub(r"[^a-zA-Z0-9]", "", w).lower() for w in str(prev_text).split() if w.strip()]
        tail_window = prev_words[-12:]
        for _ in range(3):
            cta_words = txt.split()
            if len(tail_window) < 2 or len(cta_words) < 6:
                break
            trim_k = 0
            for k in (3, 2):
                if len(cta_words) - k >= 4:
                    prefix_k = [re.sub(r"[^a-zA-Z0-9]", "", w).lower() for w in cta_words[:k]]
                    for s_i in range(max(0, len(tail_window) - k + 1)):
                        if tail_window[s_i:s_i + k] == prefix_k:
                            trim_k = k
                            break
                if trim_k:
                    break
            if not trim_k and tail_window:
                first_bare = re.sub(r"[^a-zA-Z0-9]", "", cta_words[0]).lower()
                if len(first_bare) >= 4 and first_bare == tail_window[-1]:
                    trim_k = 1
            if not (trim_k and (len(cta_words) - trim_k) >= 4):
                break
            rest = " ".join(cta_words[trim_k:]).lstrip(",;:- ")
            if not rest:
                break
            txt = rest[0].upper() + rest[1:]

    # 3. Hapus pengulangan kata/klausa awal pada setiap klausa setelah tanda koma / titik / titik koma
    tokens = re.split(r"([,;]|[.!?](?=\s|$))\s*", txt)
    if len(tokens) < 3:
        return txt

    out_parts = [tokens[0]]
    i = 1
    while i + 1 < len(tokens):
        sep = tokens[i]
        next_part = tokens[i + 1]
        if next_part:
            prev_full = " ".join(out_parts)
            words1 = [w.lower().strip(".,!?;:") for w in prev_full.split() if w]
            words2 = next_part.split()
            if words1 and words2:
                last_tail = set(words1[-4:])
                cleaned2 = []
                skip_mode = True
                for w in words2:
                    bare = w.lower().strip(".,!?;:")
                    if skip_mode and bare in last_tail:
                        continue
                    skip_mode = False
                    cleaned2.append(w)
                if not cleaned2:
                    # Seluruh klausa mengulang persis kata sebelumnya -> buang klausa duplikat ini beserta koma/pemisahnya
                    i += 2
                    continue
                rp2 = " ".join(cleaned2)
                if sep in ".!?" and rp2:
                    rp2 = rp2[0].upper() + rp2[1:]
                next_part = rp2
        out_parts.append(sep + " " + next_part if next_part else sep)
        i += 2
    if i < len(tokens) and tokens[i]:
        out_parts.append(tokens[i])

    joined = "".join(out_parts)
    joined = re.sub(r"\s+([,.;:!?])", r"\1", joined)
    return " ".join(joined.split())


def ensure_english_like_and_subscribe_cta(cta_script, fallback_template, prev_text=""):
    """Memastikan naskah CTA Bahasa Inggris 100% mengandung ajakan Like dan Subscribe dengan kalimat bervariasi dan bebas pengulangan kata."""
    txt = sanitize_subtitle_text(cta_script)
    if not txt:
        return _remove_leading_word_repetition(fallback_template, prev_text=prev_text)
    low = txt.lower()
    has_sub  = "subscribe" in low
    has_like = ("like" in low) or ("thumbs up" in low) or ("double tap" in low)
    if has_sub and has_like:
        return _remove_leading_word_repetition(txt, prev_text=prev_text)
    first_clause = re.split(r"[.!?]", txt)[0].strip().rstrip(",;:")
    suffix_match = re.split(r",\s*", fallback_template, maxsplit=1)
    varied_suffix = suffix_match[1] if len(suffix_match) > 1 else "hit that like button and subscribe for more tech reviews!"
    if first_clause and len(first_clause.split()) <= 9:
        combined = f"{first_clause}, {varied_suffix}"
        return _remove_leading_word_repetition(combined, prev_text=prev_text)
    return _remove_leading_word_repetition(fallback_template, prev_text=prev_text)

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

def ensure_indonesian_affiliate_soft_selling_cta(cta_script, fallback_template, prev_text=""):
    """Memastikan CTA Bahasa Indonesia tetap bersih, bebas frasa aneh, bebas pengulangan kata masuk CTA, dan bernuansa soft-selling."""
    txt = sanitize_subtitle_text(cta_script)
    if not txt or len(txt.split()) < 6:
        return _remove_leading_word_repetition(fallback_template, prev_text=prev_text)
    low = txt.lower()
    has_soft_cta = any(k in low for k in ["cek", "link", "tertarik", "layak", "pilihan", "rekomendasi", "komentar", "incaran", "promo", "harga", "miliki", "pinang"])
    if has_soft_cta:
        return _remove_leading_word_repetition(txt, prev_text=prev_text)
    first_clause = re.split(r"[.!?]", txt)[0].strip().rstrip(",;:")
    suffix_match = re.split(r",\s*", fallback_template, maxsplit=1)
    soft_suffix = suffix_match[-1] if len(suffix_match) > 1 else "cek harga promo dan link pembeliannya sekarang!"
    if first_clause and len(first_clause.split()) <= 9:
        combined = f"{first_clause}, {soft_suffix}"
        return _remove_leading_word_repetition(combined, prev_text=prev_text)
    return _remove_leading_word_repetition(fallback_template, prev_text=prev_text)

def _build_scene_key_prompt_spec(scene_plan, hook_style_name, hook_style_desc, var_idx, en_cta_style, id_cta_style, lang="id"):
    """Menyusun panduan penulisan VO khusus adegan aktif terklasifikasi agar 100% sinkron dengan visual klipnya."""
    lines = []
    for idx, sc in enumerate(scene_plan):
        cid = sc["id"]
        title = sc["title"]
        t_words = int(sc.get("target_words", 10))
        clip_notes = []
        for c_i, cl in enumerate(sc.get("assigned_clips", []), 1):
            note = cl.get("visual_note") or title
            sub = cl.get("transcript_slice", "")
            rng_s = f"{int(cl['start_s'])}s-{int(cl['end_s'])}s"
            clip_notes.append(f"Klip {c_i} [{rng_s}]: {note}" + (f" (konteks ucapan: {sub[:90]})" if sub else ""))
        vis_ctx = " | ".join(clip_notes) if clip_notes else sc.get("visual_rule", title)

        if idx == 0:
            if lang == "en":
                rule = (
                    f"1. `{cid}` ({title}, ~{t_words} words): START IMMEDIATELY with a sharp English hook [{hook_style_name}] -> {hook_style_desc} "
                    "(name the phone immediately; FORBIDDEN clichés: 'This beast just changed...', 'Meet the...', '[Phone] features...', 'Hello') + describe the exact visuals/specs shown: "
                    f"[{vis_ctx}]"
                )
            else:
                rule = (
                    f"1. `{cid}` ({title}, ~{t_words} kata): WAJIB diawali hook 1 kalimat singkat yang menggebrak dan langsung menyebut nama seri HP "
                    "(DILARANG 'Halo/Hai/Yuk/Oke') + bahas fakta spesifikasi sesuai visual terpilih: "
                    f"[{vis_ctx}]"
                )
        elif cid == "cta":
            if lang == "en":
                rule = (
                    f"{idx + 1}. `cta` (~{t_words} words): 4-5 word sharp takeaway WITHOUT repeating words from previous scene + mandatory creative LIKE & SUBSCRIBE CTA in English "
                    f"inspired by style #{var_idx + 1}: {en_cta_style} | Visual penutup: [{vis_ctx}]"
                )
            else:
                rule = (
                    f"{idx + 1}. `cta` (~{t_words} kata): Kesimpulan singkat keunggulan nyata HP TANPA mengulang kata akhir adegan sebelumnya + ajakan afiliasi soft-selling standar "
                    f"seperti gaya ini: {id_cta_style} (DILARANG istilah mengada-ada seperti 'kuliah sore'). Visual penutup: [{vis_ctx}]"
                )
        else:
            unit_w = "words" if lang == "en" else "kata"
            rule = f"{idx + 1}. `{cid}` ({title}, ~{t_words} {unit_w}): Jelaskan spesifikasi asli topik ini selaras persis dengan visual terpilih: [{vis_ctx}]"
        lines.append(rule)
    return lines

def analyze_native_transcript_and_build_chapters(video_title, video_desc, timestamped_transcript, total_dur, api_key, lang="id", active_scenes_plan=None, youtube_chapters=None):
    plan_list = active_scenes_plan if active_scenes_plan else SCENE_CATALOG
    active_keys = [s["id"] for s in plan_list]
    short_transcript = timestamped_transcript[:15000] if timestamped_transcript else "(Transkrip tidak tersedia, gunakan spesifikasi asli HP pada judul/deskripsi/chapter)"
    lang_label = "Bahasa Inggris (English)" if lang == "en" else "Bahasa Indonesia"
    inch_rule = "kata 'inch'" if lang == "en" else "kata 'inci'"

    var_idx, en_cta_style, en_cta_fallback = pick_english_cta_style_and_fallback(video_title)
    id_idx, id_cta_style, id_cta_fallback = pick_indonesian_cta_style_and_fallback(video_title)
    hook_style_name, hook_style_desc, _ = pick_english_opening_hook_style(video_title)
    thumb_angle_name, thumb_angle_examples = pick_english_thumbnail_angle(video_title)

    scene_rules = _build_scene_key_prompt_spec(plan_list, hook_style_name, hook_style_desc, var_idx, en_cta_style, id_cta_style, lang=lang)
    total_word_goal = sum(int(s.get("target_words", 10)) for s in plan_list) if active_scenes_plan else 96

    if lang == "en":
        cta_simple_hint = (
            "Khusus key `cta` (jika ada di daftar aktif), WAJIB berisi kesimpulan singkat + ajakan kreatif untuk LIKE dan SUBSCRIBE dalam Bahasa Inggris "
            f"(contoh gaya: {en_cta_fallback})."
        )
        thumb_lang_rules = [
            "- `thumbnail_hook`, `thumbnail_phone`, `thumbnail_verdict`, `thumbnail_badge`, and `thumbnail_headline` MUST BE 100% IN ENGLISH! DO NOT use any Indonesian words (such as 'LAYAR', 'BATERAI', 'KAMERA', 'HARGA', 'LAYAK', 'TAHAN AIR', 'KENCANG', 'STABIL', 'INDONESIA', 'JUJUR').",
            f"- `thumbnail_hook`: 2-4 punchy high-CTR uppercase ENGLISH words for the TOP of the thumbnail WITHOUT repeating the phone name. Channel this style angle [{thumb_angle_name}] (inspiration: {thumb_angle_examples}) — craft a FRESH, sharp hook tailored to THIS phone instead of repeating generic 'WORTH IT?!'.",
            "- `thumbnail_phone`: clean mixed-case phone brand and model ONLY, 2-4 words max (e.g. \"Nubia Neo 5 GT\", \"Redmi A7 Pro\", \"Poco X8\", \"Samsung S25 FE\").",
            "- `thumbnail_verdict`: 2-3 bold spec-specific or verdict-driven uppercase ENGLISH words for the BOTTOM beneath the red banner using a standout feature from THIS phone (e.g. \"8050MAH MONSTER!\", \"144HZ AMOLED BEAST!\", \"IP69 WATERPROOF?!\", \"RIVAL CRUSHER!\"). Avoid lazy 'HONEST REVIEW!' every time.",
            "- Also keep `thumbnail_badge` (= `thumbnail_verdict`) and `thumbnail_headline` (= `thumbnail_hook`) consistent in ENGLISH.",
            "- GLOBAL ENGLISH AUDIENCE: `script`, `caption`, and `hashtags` MUST NOT mention 'Indonesia', 'Indonesian', or local currency 'rupiah/IDR'. Keep everything 100% natural for an international English tech audience."
        ]
    else:
        cta_simple_hint = (
            "Khusus key `cta` (jika ada di daftar aktif), gunakan kesimpulan singkat + CTA afiliasi standar soft selling (contoh: "
            f"{id_cta_fallback}). Jangan gunakan tanda kutip di dalam nilai string dan jangan mengarang istilah seperti 'kuliah sore'."
        )
        thumb_lang_rules = [
            "- Nilai `thumbnail_hook`: 2-4 kata hook huruf kapital super memikat untuk bagian ATAS thumbnail TANPA menyebut ulang nama HP (contoh: \"JANGAN BELI DULU?!\", \"RAJA BARU?!\", \"WORTH IT KAH?!\", \"SERIUS SEBAGUS INI?!\").",
            "- Nilai `thumbnail_phone`: nama merek dan seri HP yang rapi maksimal 2-4 kata (contoh: \"Nubia Neo 5 GT\", \"Redmi A7 Pro\", \"Samsung S25 FE\").",
            "- Nilai `thumbnail_verdict`: 2-3 kata huruf kapital untuk bagian BAWAH pita merah (contoh: \"REVIEW JUJUR!\", \"HP GAMING TERBAIK?!\", \"SPEK DEWA BANGET!\").",
            "- Sertakan juga `thumbnail_badge` (= `thumbnail_verdict`) dan `thumbnail_headline` (= `thumbnail_hook`) dalam Bahasa Indonesia."
        ]

    chap_summary = ""
    if youtube_chapters:
        chap_summary = "YouTube Chapters Asli:\n" + "\n".join(
            f"- [{int(c['start_sec'])}s-{int(c['end_sec'])}s] {c['title']}" for c in youtube_chapters
        ) + "\n"

    keys_csv = ", ".join(active_keys + ["caption", "hashtags", "thumbnail_hook", "thumbnail_phone", "thumbnail_verdict", "thumbnail_badge", "thumbnail_headline"])
    first_key = active_keys[0] if active_keys else "body"

    prompt = "\n".join([
        f"Judul Video Review: \"{video_title}\"",
        f"Durasi Total Video Sumber: {int(total_dur)} detik",
        f"Deskripsi Video: \"{video_desc[:2000]}\"",
        chap_summary,
        "Transkrip Voiceover Asli Video (dengan penanda detik):",
        short_transcript,
        "",
        f"TUGAS PENYUSUNAN NASKAH VOICEOVER UNTUK {len(active_keys)} ADEGAN AKTIF TERKLASIFIKASI VISUAL:",
        f"Hanya kategori di bawah ini yang memiliki klip visual terverifikasi. JANGAN menambah kategori lain di luar daftar!",
        f"Tulis naskah voiceover **{lang_label}** untuk setiap kategori aktif berikut agar 100% cocok dengan visual yang tampil:",
        *scene_rules,
        "",
        "ATURAN WAJIB:",
        f"- Seluruh teks `script`, `caption`, `hashtags`, `thumbnail_hook`, `thumbnail_verdict`, `thumbnail_badge`, dan `thumbnail_headline` WAJIB 100% ditulis dalam **{lang_label}**.",
        f"- Total gabungan kata dari seluruh `script` semua kategori aktif sekitar {max(40, total_word_goal - 8)}-{min(110, total_word_goal + 6)} kata agar selesai diucapkan dengan utuh (< 55 detik).",
        f"- Patuhi jatah kata tiap adegan agar durasi suara cocok dengan jumlah klip visual kategori tersebut (adegan berdurasi 1 klip harus ringkas ~6-9 kata).",
        f"- Jangan gunakan tanda kutip ganda (\") di dalam isi kalimat `script` atau `visual_focus` (gunakan {inch_rule} untuk ukuran layar).",
        "- Semua angka spesifikasi & FPS rekaman video wajib 100% asli dari transkrip/deskripsi.",
        "- JANGAN PERNAH menyalin candaan tidak relevan dari transkrip reviewer atau menambahkan kata seperti 'kuliah sore', 'anak kuliah', dsb.",
        f"- HOOK WAJIB KUAT: Kalimat PERTAMA dari `{first_key}` HARUS berupa hook singkat menggebrak langsung menyebut nama HP — DILARANG 'Halo/Hai/Yuk/Oke/Jadi/Nah'.",
        "- CTA ANTI-DUPLIKASI: Pastikan TIDAK ADA pengulangan kata/frasa berurutan di dalam kalimat CTA maupun saat masuk ke adegan CTA dari adegan sebelumnya (contoh salah: 'Baterai badak, baterai awet!' atau 'kamera jernih. Kamera jernih, cek link...').",
        f"- Kembalikan HANYA objek JSON murni dengan key persis: {keys_csv}.",
        "- Nilai `hashtags` WAJIB berupa string berisi 5-7 hashtag relevan yang SETIAP katanya diawali tanda pagar `#` " + (
            "(contoh untuk ENGLISH video: \"#SmartphoneReview #TechShorts #GadgetReview #PhoneReview #Shorts\"). "
            "WAJIB 100% berbahasa Inggris — DILARANG kata Indonesia."
            if lang == "en" else
            "(contoh: \"#ReviewHP #GadgetIndonesia #Smartphone #Shorts\")."
        ),
        *thumb_lang_rules,
        "- Setiap key adegan aktif wajib memiliki: `start_sec` (angka), `end_sec` (angka), `script` (teks narasi bersih sesuai kata target adegan tersebut)."
    ])

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.45 if lang == "en" else 0.2,
            "responseMimeType": "application/json"
        }
    }
    res = call_gemini_json(payload, api_key)
    res = normalize_parsed_json_to_dict(res) if res else None

    min_req = max(2, min(4, len(active_keys)))
    if not isinstance(res, dict) or sum(1 for k in active_keys if k in res) < min_req:
        print("    [!] Mencoba skema JSON ringkas untuk naskah adegan aktif...", flush=True)
        simple_keys_csv = ", ".join(active_keys + ["caption", "hashtags", "thumbnail_hook", "thumbnail_phone", "thumbnail_verdict"])
        simple_hints = "; ".join(f"{sc['id']} (~{sc.get('target_words', 10)} kata)" for sc in plan_list)
        simple_prompt = "\n".join([
            f"Judul Video: \"{video_title}\" (Durasi: {int(total_dur)}s)",
            f"Deskripsi: \"{video_desc[:1500]}\"",
            chap_summary,
            "Transkrip:",
            short_transcript[:10000],
            "",
            f"Susun JSON murni dengan key persis: {simple_keys_csv}.",
            f"Jatah tiap adegan aktif: {simple_hints}.",
            f"Setiap key adegan berisi objek: {{\"start_sec\": angka, \"end_sec\": angka, \"script\": \"narasi {lang_label} padat sesuai jatah kata & spek asli\"}}.",
            (f"HOOK WAJIB EN pada `{first_key}` [{hook_style_name}]: {hook_style_desc}" if lang == "en" else f"HOOK WAJIB pada `{first_key}`: awali kalimat menggebrak menyebut nama HP — DILARANG Halo/Hai/Yuk/Oke."),
            "CTA ANTI-DUPLIKASI: Tidak boleh ada pengulangan kata berurutan.",
            (f"GLOBAL & DYNAMIC THUMB EN: 100% English without Indonesia/rupiah; angle {thumb_angle_name}." if lang == "en" else ""),
            cta_simple_hint
        ])
        simple_payload = {
            "contents": [{"parts": [{"text": simple_prompt}]}],
            "generationConfig": {"temperature": 0.35 if lang == "en" else 0.15, "responseMimeType": "application/json"}
        }
        res = call_gemini_json(simple_payload, api_key)
        res = normalize_parsed_json_to_dict(res) if res else None

    if not isinstance(res, dict):
        return None

    step = max(20.0, (total_dur - 40.0) / max(1, len(active_keys)))
    for idx, sc in enumerate(plan_list):
        k = sc["id"]
        clips = sc.get("assigned_clips", [])
        default_s = clips[0]["start_s"] if clips else (30.0 + idx * step)
        default_e = clips[-1]["end_s"] if clips else min(total_dur - 10.0, default_s + step)
        val = res.get(k)
        if not isinstance(val, dict):
            res[k] = {"start_sec": default_s, "end_sec": default_e, "script": sanitize_subtitle_text(str(val or "")), "scenes": []}
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
        non_cta_keys = [k for k in active_keys if k != "cta"]
        prev_cta_txt = ""
        if non_cta_keys and isinstance(res.get(non_cta_keys[-1]), dict):
            prev_cta_txt = str(res[non_cta_keys[-1]].get("script") or "")
        if lang == "en":
            enforced_cta = ensure_english_like_and_subscribe_cta(res["cta"].get("script", ""), en_cta_fallback, prev_text=prev_cta_txt)
        else:
            enforced_cta = ensure_indonesian_affiliate_soft_selling_cta(res["cta"].get("script", ""), id_cta_fallback, prev_text=prev_cta_txt)
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

def ensure_chapter_scenes(chap_cfg, chap_data, events, total_dur, assigned_clips=None, max_cuts=None):
    """
    Memastikan setiap jenis adegan aktif memiliki daftar sub-adegan (`scenes`) yang sinkron
    dengan jumlah klip unik terklasifikasi (`max_cuts <= len(assigned_clips)`).
    """
    chap_s = float(chap_data.get("start_sec", 40.0))
    chap_e = float(chap_data.get("end_sec", min(total_dur - 10.0, chap_s + 90.0)))
    chap_script = sanitize_subtitle_text(chap_data.get("script", ""))

    avail_clips = list(assigned_clips or [])
    n_cuts_cap = max(1, int(max_cuts if max_cuts is not None else (len(avail_clips) if avail_clips else 2)))

    # Pecah menjadi 1 sub-adegan utuh (kecuali teks cukup panjang & ada >= 2 klip berbeda)
    target_n = 2 if (n_cuts_cap >= 2 and len(chap_script.split()) >= 14) else 1
    raw_scenes = chap_data.get("scenes", [])
    valid_raw = [
        sc for sc in (raw_scenes if isinstance(raw_scenes, list) else [])
        if isinstance(sc, dict) and sanitize_subtitle_text(sc.get("script", ""))
    ]

    if len(valid_raw) >= target_n and target_n == 2:
        clauses = [sanitize_subtitle_text(sc.get("script", "")) for sc in valid_raw[:2]]
        if len(valid_raw) > 2:
            extra = " ".join(sanitize_subtitle_text(sc.get("script", "")) for sc in valid_raw[2:])
            clauses[-1] = f"{clauses[-1]} {extra}".strip()
    elif target_n == 1:
        base_text = chap_script if chap_script else " ".join(sanitize_subtitle_text(sc.get("script", "")) for sc in valid_raw)
        clauses = [base_text]
    else:
        base_text = chap_script if chap_script else " ".join(sanitize_subtitle_text(sc.get("script", "")) for sc in valid_raw)
        clauses = split_script_into_n_clauses(base_text, target_n)

    built_scenes = []
    # Alokasikan jatah max_cuts ke masing-masing sub-adegan secara adil tanpa melebihi total n_cuts_cap
    cuts_per_sub = [n_cuts_cap] if len(clauses) == 1 else [max(1, n_cuts_cap // 2), max(1, n_cuts_cap - max(1, n_cuts_cap // 2))]

    for idx, cl_text in enumerate(clauses):
        raw_sc = valid_raw[idx] if idx < len(valid_raw) else {}
        kws = list(dict.fromkeys((raw_sc.get("keywords") or []) + chap_cfg.get("keywords", [])))

        sub_span = max(15.0, (chap_e - chap_s) / max(1, len(clauses)))
        def_s = chap_s + idx * sub_span
        def_e = min(total_dur - 8.0, def_s + sub_span)

        try:
            sc_s = float(raw_sc.get("start_sec") or def_s)
            sc_e = float(raw_sc.get("end_sec") or def_e)
        except Exception:
            sc_s, sc_e = def_s, def_e

        kw_s, kw_e = find_keyword_time_window_in_transcript(events, kws, sc_s, sc_e, total_dur)

        if cl_text and cl_text[-1] not in ".!?,;:":
            cl_text += "," if idx < len(clauses) - 1 else "."

        vis_focus = chap_cfg.get("visual_rule") or chap_cfg["title"]
        if avail_clips:
            sel_cl = avail_clips[min(idx, len(avail_clips) - 1)]
            if sel_cl.get("visual_note"):
                vis_focus = sel_cl["visual_note"]

        built_scenes.append({
            "scene_id": f"{chap_cfg['id']}_{idx + 1}",
            "chapter_id": chap_cfg["id"],
            "chapter_title": chap_cfg["title"],
            "visual_focus": str(raw_sc.get("visual_focus") or vis_focus),
            "keywords": kws,
            "start_sec": kw_s,
            "end_sec": kw_e,
            "script": cl_text,
            "max_cuts": cuts_per_sub[min(idx, len(cuts_per_sub) - 1)]
        })

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
    """Mendeteksi apakah akhir audio TTS terpotong di tengah kata akibat batas durasi maksimum (~61.2s Gemini TTS)."""
    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
    dur = len(samples) / float(sr)
    if len(samples) < sr or dur < 54.0:
        return False
    hop = int(sr * 0.01)
    n_win = len(samples) // hop
    rms = np.sqrt(np.mean(samples[:n_win * hop].reshape((n_win, hop)) ** 2, axis=1))
    thresh = max(90.0, np.percentile(rms, 10) + (np.percentile(rms, 95) - np.percentile(rms, 10)) * 0.08)
    tail_rms = float(np.mean(rms[-8:]))
    return (dur >= 59.5 and tail_rms > thresh * 1.35) or (dur >= 60.5 and float(np.max(rms[-15:])) > thresh)


def _trim_pcm_silence_edges(pcm_bytes, sr=24000, lead_ms=50, tail_ms=90):
    """Memangkas hening berlebih di awal dan akhir segmen PCM tanpa memotong konsonan akhir."""
    arr = np.frombuffer(pcm_bytes, dtype=np.int16)
    hop = int(sr * 0.01)
    n_win = len(arr) // hop
    if n_win < 8:
        return arr
    rms = np.sqrt(np.mean(arr[:n_win * hop].astype(np.float32).reshape((n_win, hop)) ** 2, axis=1))
    sp = np.where(rms > 90.0)[0]
    if len(sp) == 0:
        return arr
    w0 = max(0, int(sp[0]) - max(1, lead_ms // 10))
    w1 = min(n_win, int(sp[-1]) + max(2, tail_ms // 10))
    return arr[w0 * hop:w1 * hop]


def _request_validated_tts_chunk(chunk_text, api_key, voice_name, models_to_try, sr=24000, lang="id"):
    """Memanggil Gemini TTS untuk satu grup ringkas (< 45 kata) sambil menolak audio glitch/looping (durasi > 1.75x wajar)."""
    words = [w for w in str(chunk_text).split() if w.strip()]
    est_s = max(1.8, len(words) * (0.34 if lang == "en" else 0.37))
    max_sane_s = max(12.5, est_s * 1.75 + 2.5)
    best_pcm = None
    used_model = None
    best_dur = 999.0

    for attempt in range(3):
        pcm, mod = request_tts_pcm_bytes(chunk_text, api_key, voice_name, models_to_try)
        if not pcm:
            continue
        dur_s = len(pcm) / float(2 * sr)
        if dur_s <= max_sane_s:
            return pcm, mod
        print(f"    [!] Deteksi glitch/pengulangan durasi TTS ({dur_s:.1f}s > batas wajar {max_sane_s:.1f}s) -> Regenerasi grup bersih (percobaan {attempt + 1})...", flush=True)
        if dur_s < best_dur:
            best_dur = dur_s
            best_pcm = pcm
            used_model = mod
        time.sleep(0.8)

    if best_pcm and best_dur > max_sane_s * 1.35:
        return None, None
    return best_pcm, used_model


def stitch_clean_cta_onto_body(body_and_cta_pcm, cta_pcm, chapter_scripts, sr=24000, lang="id"):
    """
    Memotong bagian CTA yang terpotong di ujung `body_and_cta_pcm` tepat pada jeda hening sebelum Bab CTA,
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

    weights = [estimate_spoken_weight(cs, ".", lang=lang) for cs in chapter_scripts]
    body_frac = sum(weights[:-1]) / max(1.0, sum(weights))
    approx_cut_s = (len(samples) / float(sr)) * body_frac

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
    cta_int16 = _trim_pcm_silence_edges(cta_pcm, sr=sr, lead_ms=50, tail_ms=80)
    pause_between = np.zeros(int(sr * 0.28), dtype=np.int16)
    tail_pad = np.zeros(int(sr * 0.45), dtype=np.int16)
    combined = np.concatenate([body_int16, pause_between, cta_int16, tail_pad])
    return combined.tobytes()


def generate_single_gemini_tts_chapters(chapter_scripts, out_wav, api_key, voice_name="Despina", custom_model=None, lang="id"):
    models_to_try = [custom_model] if custom_model else list(TTS_MODELS)
    cleaned_chaps = []
    for s in chapter_scripts:
        cs = sanitize_subtitle_text(s)
        if cs and cs[-1] not in ".!?":
            cs += "."
        if cs:
            cleaned_chaps.append(cs)

    if not cleaned_chaps:
        return False, None

    # Pisahkan adegan isi vs adegan penutup (CTA) & jaga <= 44 kata/grup agar Gemini TTS tidak looping/terpotong ~61s
    groups = []
    if len(cleaned_chaps) >= 2:
        body_chaps = cleaned_chaps[:-1]
        cur_grp = []
        cur_w = 0
        for bc in body_chaps:
            bw = len(bc.split())
            if cur_grp and (cur_w + bw) > 42:
                groups.append(" ".join(cur_grp))
                cur_grp = [bc]
                cur_w = bw
            else:
                cur_grp.append(bc)
                cur_w += bw
        if cur_grp:
            groups.append(" ".join(cur_grp))
        groups.append(cleaned_chaps[-1])  # CTA selalu bersih tersendiri tanpa risiko terpotong atau terulang!
    else:
        groups = [cleaned_chaps[0]]

    sr = 24000
    chunk_arrays = []
    used_model = None
    lead_pause = np.zeros(int(sr * 0.18), dtype=np.int16)
    inter_pause = np.zeros(int(sr * 0.36), dtype=np.int16)
    tail_pause = np.zeros(int(sr * 0.42), dtype=np.int16)

    for g_idx, g_txt in enumerate(groups):
        pcm_g, mod_g = _request_validated_tts_chunk(
            g_txt, api_key, voice_name, ([used_model] + models_to_try) if used_model else models_to_try, sr=sr, lang=lang
        )
        if not pcm_g:
            return False, None
        used_model = used_model or mod_g
        trimmed = _trim_pcm_silence_edges(pcm_g, sr=sr, lead_ms=40, tail_ms=80)
        if g_idx == 0:
            chunk_arrays.append(lead_pause)
        else:
            chunk_arrays.append(inter_pause)
        chunk_arrays.append(trimmed)

    chunk_arrays.append(tail_pause)
    final_pcm = np.concatenate(chunk_arrays).tobytes()

    with wave.open(out_wav, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(final_pcm)
    return True, used_model

def expand_indo_tech_for_timing(text):
    s = str(text or "").upper()
    repls = [
        (r"(?:\b|(?<=\d))1080P\b", " SERIBU DELAPAN PULUH PE "),
        (r"(?:\b|(?<=\d))720P\b", " TUJUH RATUS DUA PULUH PE "),
        (r"(?:\b|(?<=\d))4K\b", " EMPAT KA "),
        (r"(?:\b|(?<=\d))2K\b", " DUA KA "),
        (r"(?:\b|(?<=\d))8K\b", " DELAPAN KA "),
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
        (r"(?:\b|(?<=\d))FPS\b", " EF PE ES "),
        (r"(?:\b|(?<=\d))MAH\b", " MILI AMPER "),
        (r"(?:\b|(?<=\d))GB\b", " GIGABAIT "),
        (r"(?:\b|(?<=\d))TB\b", " TERABAIT "),
        (r"(?:\b|(?<=\d))MPX\b", " MEGAPIKSEL "),
        (r"(?:\b|(?<=\d))MP\b", " MEGAPIKSEL "),
        (r"(?:\b|(?<=\d))HZ\b", " HERTZ "),
        (r"(?:\b|(?<=\d))W\b", " WATT "),
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
    s = re.sub(r"(\d)[,.](\d)", r"\1 KOMA \2", s)
    digit_map = {
        "0": " NOL ", "1": " SATU ", "2": " DUA ", "3": " TIGA ", "4": " EMPAT ",
        "5": " LIMA ", "6": " ENAM ", "7": " TUJUH ", "8": " DELAPAN ", "9": " SEMBILAN "
    }
    for d, w in digit_map.items():
        s = s.replace(d, w)
    return s

def _number_to_en_words(n_int):
    """Mengonversi bilangan bulat ke pelafalan kata Bahasa Inggris agar bobot durasi TTS akurat."""
    ones = [
        "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
        "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
        "SEVENTEEN", "EIGHTEEN", "NINETEEN"
    ]
    tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"]
    if n_int < 0:
        return "MINUS " + _number_to_en_words(-n_int)
    if n_int < 20:
        return ones[n_int]
    if n_int < 100:
        t, r = divmod(n_int, 10)
        return tens[t] + (" " + ones[r] if r else "")
    if n_int < 1000:
        h, r = divmod(n_int, 100)
        return ones[h] + " HUNDRED" + (" " + _number_to_en_words(r) if r else "")
    if n_int < 10000:
        th, r = divmod(n_int, 1000)
        if r % 100 == 0 and th > 0 and r > 0:
            return _number_to_en_words(n_int // 100) + " HUNDRED"
        if r == 0:
            return ones[th] + " THOUSAND"
        if r // 100 != 0:
            hi, lo = divmod(n_int, 100)
            return _number_to_en_words(hi) + " " + _number_to_en_words(lo)
        return ones[th] + " THOUSAND " + _number_to_en_words(r)
    return " ".join(ones[int(c)] for c in str(n_int))

def expand_english_tech_for_timing(text):
    """Mengekspansi angka, satuan, dan akronim teknologi ke pelafalan Bahasa Inggris asli TTS."""
    s = str(text or "").upper()
    repls = [
        (r"(?:\b|(?<=\d))1080P\b", " TEN EIGHTY PEE "),
        (r"(?:\b|(?<=\d))720P\b", " SEVEN TWENTY PEE "),
        (r"(?:\b|(?<=\d))4K\b", " FOUR KAY "),
        (r"(?:\b|(?<=\d))2K\b", " TWO KAY "),
        (r"(?:\b|(?<=\d))8K\b", " EIGHT KAY "),
        (r"(\d+(?:\.\d+)?)K\b", r" \1 KAY "),
        (r"\bLPDDR4X\b", " EL PEE DEE DEE AR FOUR EX "),
        (r"\bLPDDR5X\b", " EL PEE DEE DEE AR FIVE EX "),
        (r"\bLPDDR5\b", " EL PEE DEE DEE AR FIVE "),
        (r"\bLPDDR4\b", " EL PEE DEE DEE AR FOUR "),
        (r"\bCOLOROS\b", " COLOR O ES "),
        (r"\bHYPEROS\b", " HYPER O ES "),
        (r"\bFUNTOUCHOS\b", " FUNTOUCH O ES "),
        (r"\bONE\s*UI\b", " ONE U EYE "),
        (r"\bIOS\b", " EYE O ES "),
        (r"\bAMOLED\b", " A MO LED "),
        (r"\bOLED\b", " O LED "),
        (r"\bUFS\b", " YOU EF ES "),
        (r"\bEMMC\b", " EE EM EM SEE "),
        (r"\bNON-OIS\b", " NON O EYE ES "),
        (r"\bOIS\b", " O EYE ES "),
        (r"\bEIS\b", " EE EYE ES "),
        (r"\bNFC\b", " EN EF SEE "),
        (r"(?:\b|(?<=\d))FPS\b", " EF PEE ES "),
        (r"(?:\b|(?<=\d))MAH\b", " MILLI AMP HOUR "),
        (r"(?:\b|(?<=\d))GB\b", " GIGS "),
        (r"(?:\b|(?<=\d))TB\b", " TERABYTES "),
        (r"(?:\b|(?<=\d))MPX?\b", " MEGAPIXELS "),
        (r"(?:\b|(?<=\d))HZ\b", " HERTZ "),
        (r"(?:\b|(?<=\d))W\b", " WATT "),
        (r"\bIP(\d{2})\b", lambda m: " EYE PEE " + " ".join(_number_to_en_words(int(c)) for c in m.group(1)) + " "),
        (r"\bSD\s*CARD\b", " ES DEE CARD "),
        (r"\bMICROSD\b", " MICRO ES DEE "),
        (r"\bSUPERVOOC\b", " SUPER VOOK "),
        (r"\bONEPLUS\b", " ONE PLUS "),
    ]
    for pat, rep in repls:
        s = re.sub(pat, rep, s)
    s = re.sub(
        r"(\d+)\.(\d+)",
        lambda m: _number_to_en_words(int(m.group(1))) + " POINT " + " ".join(_number_to_en_words(int(c)) for c in m.group(2)),
        s
    )
    s = re.sub(r"\b(\d+)\b", lambda m: " " + _number_to_en_words(int(m.group(1))) + " ", s)
    return " ".join(s.split())

def count_english_syllables_word(word):
    """Memperkirakan jumlah suku kata lisan Bahasa Inggris dengan membuang huruf e/-ed/-es senyap."""
    w = re.sub(r"[^A-Z]", "", word.upper())
    if not w:
        return 0
    if len(w) <= 2:
        return max(1, len(re.findall(r"[AEIOUY]+", w)))
    w_proc = w
    if w_proc.endswith("ES") and len(w_proc) > 4 and not re.search(r"(SH|CH|S|X|Z|G|C)ES$", w_proc):
        w_proc = w_proc[:-2]
    elif w_proc.endswith("ED") and len(w_proc) > 4 and not re.search(r"[TD]ED$", w_proc):
        w_proc = w_proc[:-2]
    elif w_proc.endswith("E") and len(w_proc) > 3 and not re.search(r"[^AEIOUY]LE$", w_proc):
        cand = w_proc[:-1]
        if re.search(r"[AEIOUY]", cand):
            w_proc = cand
    groups = re.findall(r"[AEIOUY]+", w_proc)
    hiatus = len(re.findall(r"(?:[AEIOU]A|EO|IA|IO|IU|UA|UI)", w_proc)) - len(re.findall(r"(?:TION|SION|CION|IOUS)", w_proc))
    return max(1, len(groups) + max(0, hiatus))

_EN_UNSTRESSED_WORDS = {
    "A", "AN", "THE", "TO", "OF", "IN", "ON", "AT", "FOR", "AND", "OR", "BY", "WITH", "IT", "IS", "ITS"
}

def estimate_spoken_weight(text_chunk, raw_punct="", lang="id"):
    s = str(text_chunk or "").upper()
    if lang == "en":
        expanded = expand_english_tech_for_timing(s)
        words = expanded.split()
        if not words:
            return 2.0
        total_syl = sum(count_english_syllables_word(w) for w in words)
        stress_adj = sum(0.25 if w not in _EN_UNSTRESSED_WORDS else -0.15 for w in words)
        char_len = sum(len(re.sub(r"[^A-Z]", "", w)) for w in words)
        weight = max(2.2, total_syl * 1.95 + stress_adj + char_len * 0.12)
        if raw_punct in ".!?":
            weight += 1.2
        elif raw_punct in ",;:":
            weight += 0.5
        return weight

    digits = len(re.findall(r"\d", s))
    units_found = len(re.findall(r"(?:\b|(?<=\d))(GB|TB|MAH|MP|MPX|W|HZ|FPS|OIS|4K|1080P|LPDDR4X|LPDDR5X)\b", s))

    spoken_expanded = expand_indo_tech_for_timing(text_chunk)
    vowels = len(re.findall(r"[AEIOU]", spoken_expanded))
    letters = len(re.sub(r"[^A-Z]", "", spoken_expanded))

    weight = max(2.2, vowels * 1.55 + letters * 0.28 + (digits * 1.4) + (units_found * 1.8))

    if raw_punct in ".!?":
        weight += 3.0
    elif raw_punct in ",;:":
        weight += 1.4
    return weight

_UNIT_BOND_TOKENS = {
    "W", "WATT", "WATTS", "INCH", "INCI", "HZ", "KHZ", "MHZ", "GHZ",
    "FPS", "MAH", "GB", "TB", "MB", "MP", "MPX", "MEGAPIXEL", "MEGAPIXELS",
    "MEGAPIKSEL", "NITS", "NIT", "MM", "GRAM", "GRAMS", "GEN"
}

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
            third_bare = re.sub(r"[^a-zA-Z0-9.,]", "", words[idx + 2])
            fourth_bare = re.sub(r"[^a-zA-Z]", "", words[idx + 3]).upper() if (idx + 3) < n else ""
            splits_num_unit = bool(re.match(r"^\d+(?:[.,]\d+)?$", third_bare)) and (fourth_bare in _UNIT_BOND_TOKENS)
            # Pisahkan hanya jika ada >= 2 angka terpisah atau berisiko memutus angka + satuannya (mis. "120" | "watt")
            if (not splits_num_unit) and len(cand_3) <= 17 and not re.search(r"\d+(?:[.,]\d+)?\s+\S*\d+", cand_3):
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

def _dp_align_speech_boundaries(valleys, weights, start_s, end_s, cum_speech, total_speech_units, num_win, is_chapter_level=False):
    """
    Dynamic Programming global untuk menyelaraskan seluruh batas Bab / Sub-Adegan / Kalimat
    ke lembah jeda hening paling akurat tanpa pergeseran kumulatif.
    """
    K = len(weights)
    if K <= 1:
        return [start_s, end_s]

    def _u_at(sec):
        idx = min(num_win - 1, max(0, int(round(sec / 0.01))))
        return float(cum_speech[idx])

    def _frac_to_t(f):
        idx = int(np.searchsorted(cum_speech, np.clip(f, 0.0, 1.0) * total_speech_units))
        return min(num_win - 1, max(0, idx)) * 0.01

    f_start = _u_at(start_s) / total_speech_units
    f_end = max(f_start + 1e-4, _u_at(end_s) / total_speech_units)
    span_f = f_end - f_start
    span_dur_speech = max(0.5, span_f * total_speech_units * 0.01)

    tot_w = max(1.0, sum(weights))
    target_cum_fracs, cw = [], 0.0
    for k in range(K - 1):
        cw += weights[k]
        target_cum_fracs.append(cw / tot_w)
    target_seg_fracs = [w / tot_w for w in weights]

    wall_span = max(0.5, end_s - start_s)
    base_min = 2.0 if is_chapter_level else 0.85
    min_seg_s = min(base_min, max(0.35, wall_span / (K * 2.3)))

    cand_points = [
        (v["mid_s"], v["dur_s"])
        for v in valleys
        if (start_s + min_seg_s * 0.8) <= v["mid_s"] <= (end_s - min_seg_s * 0.8)
    ]
    for ef in target_cum_fracs:
        es = _frac_to_t(f_start + ef * span_f)
        if not any(abs(p[0] - es) < 0.35 for p in cand_points):
            cand_points.append((es, 0.0))
    cand_points.sort(key=lambda x: x[0])

    pts = []
    for t_s, v_dur in cand_points:
        rel_f = ((_u_at(t_s) / total_speech_units) - f_start) / span_f
        if is_chapter_level:
            if v_dur >= 0.55:
                p_bonus = 4.6 + min(1.5, (v_dur - 0.55) * 2.0)
            elif v_dur >= 0.38:
                p_bonus = 3.2 + (v_dur - 0.38) * 6.0
            elif v_dur >= 0.22:
                p_bonus = 1.6 + (v_dur - 0.22) * 5.0
            elif v_dur >= 0.08:
                p_bonus = 0.2 + (v_dur - 0.08) * 4.0
            else:
                p_bonus = -1.0
        else:
            if v_dur >= 0.28:
                p_bonus = 2.4 + min(1.0, (v_dur - 0.28) * 2.5)
            elif v_dur >= 0.14:
                p_bonus = 1.4 + (v_dur - 0.14) * 4.0
            elif v_dur >= 0.07:
                p_bonus = 0.5 + (v_dur - 0.07) * 5.0
            else:
                p_bonus = -0.35
        pts.append((t_s, rel_f, v_dur, p_bonus))

    M = len(pts)
    if M < K - 1:
        return [start_s] + [_frac_to_t(f_start + ef * span_f) for ef in target_cum_fracs] + [end_s]

    INF = 1e9
    dp = [[INF] * M for _ in range(K - 1)]
    parent = [[-1] * M for _ in range(K - 1)]
    max_cum_dev = max(4.2, span_dur_speech * 0.35)

    for i in range(M):
        t_s, rel_f, _, p_bonus = pts[i]
        if (t_s - start_s) < min_seg_s:
            continue
        cum_err = abs(rel_f - target_cum_fracs[0]) * span_dur_speech
        seg_err = abs(rel_f - target_seg_fracs[0]) * span_dur_speech
        if cum_err <= max_cum_dev:
            dp[0][i] = (cum_err * 0.75 + seg_err * 1.25) - p_bonus

    for b in range(1, K - 1):
        for i in range(M):
            t_s, rel_f, _, p_bonus = pts[i]
            cum_err = abs(rel_f - target_cum_fracs[b]) * span_dur_speech
            if cum_err > max_cum_dev:
                continue
            best_val, best_j = INF, -1
            for j in range(i):
                if dp[b - 1][j] >= INF or (t_s - pts[j][0]) < min_seg_s:
                    continue
                seg_frac = rel_f - pts[j][1]
                if seg_frac <= 0.015:
                    continue
                seg_err = abs(seg_frac - target_seg_fracs[b]) * span_dur_speech
                cost = dp[b - 1][j] + (cum_err * 0.75 + seg_err * 1.35) - p_bonus
                if cost < best_val:
                    best_val, best_j = cost, j
            dp[b][i] = best_val
            parent[b][i] = best_j

    best_total, last_i = INF, -1
    for i in range(M):
        if dp[K - 2][i] >= INF:
            continue
        t_s, rel_f, _, _ = pts[i]
        if (end_s - t_s) < min_seg_s:
            continue
        last_seg_err = abs((1.0 - rel_f) - target_seg_fracs[K - 1]) * span_dur_speech
        tot_cost = dp[K - 2][i] + last_seg_err * 1.35
        if tot_cost < best_total:
            best_total, last_i = tot_cost, i

    if last_i == -1:
        return [start_s] + [_frac_to_t(f_start + ef * span_f) for ef in target_cum_fracs] + [end_s]

    chosen_idx = [0] * (K - 1)
    curr = last_i
    for b in range(K - 2, -1, -1):
        chosen_idx[b] = curr
        curr = parent[b][curr]
    return [start_s] + [pts[idx][0] for idx in chosen_idx] + [end_s]

def analyze_wav_scenes_and_build_subtitles(chapters_with_scenes, wav_path, ass_path, srt_backup_path, sync_json_path=None, lang="id"):
    """
    Smart Acoustic Scene Aligner:
    1. Mendeteksi Major Valleys (>= 80ms hening) untuk batas antar-Bab dan Micro Valleys (>= 30ms hening)
       untuk batas antar Sub-Adegan dan antar-kalimat dengan Dynamic Programming global (tanpa pergeseran kumulatif).
    2. Menyusun chunk subtitle 2-3 kata di dalam setiap Sub-Adegan sesuai bobot pelafalan bahasa aktif (id/en)
       serta mengunci transisi ke jeda mikro antar-kata agar 100% sinkron dengan Voice Over.
    3. Membagi Sub-Adegan menjadi N cut visual yang terkunci persis pada batas selesai chunk subtitle.
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

    last_on = -100
    for i in range(num_win):
        if is_speech[i] == 1:
            if 0 < (i - last_on) <= 3:
                is_speech[last_on:i] = 1
            last_on = i

    speech_indices = np.where(is_speech == 1)[0]
    first_speech_idx = int(speech_indices[0]) if len(speech_indices) > 0 else 0
    last_speech_idx = int(speech_indices[-1]) if len(speech_indices) > 0 else num_win - 1

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
                    "dur_s": sil_len * 0.01
                }
                if sil_len >= 8:
                    major_valleys.append(v_obj)
                    micro_valleys.append(dict(v_obj))
                elif sil_len >= 3:
                    micro_valleys.append(v_obj)
                in_sil = False

    # Hitung murni frame vokal aktif agar jeda hening panjang di tengah kalimat tidak menggeser bobot kumulatif
    active_weights = np.where(is_speech == 1, 1.0, 0.0)
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

    # Tahap A: Kunci batas waktu eksak antar 6 Bab secara global via DP
    chapter_scripts = [c["script"] for c in chapters_with_scenes]
    chap_weights = [estimate_spoken_weight(cs, ".", lang=lang) for cs in chapter_scripts]
    chap_boundaries = _dp_align_speech_boundaries(
        major_valleys, chap_weights, 0.0, target_final_dur,
        cum_speech, total_speech_units, num_win, is_chapter_level=True
    )

    # Tahap B: Kunci batas waktu Sub-Adegan & bangun Subtitle + Visual Cuts terkunci
    timed_subtitles = []
    all_visual_cuts = []
    sync_report = []

    for c_idx, chap_obj in enumerate(chapters_with_scenes):
        c_win_start = chap_boundaries[c_idx]
        c_win_end = chap_boundaries[c_idx + 1]
        scenes = chap_obj.get("scenes", [])
        if not scenes:
            continue

        sc_weights = [
            estimate_spoken_weight(
                sc["script"],
                sc["script"][-1] if sc["script"] and sc["script"][-1] in ".!?,;:" else ",",
                lang=lang
            )
            for sc in scenes
        ]
        scene_boundaries = _dp_align_speech_boundaries(
            micro_valleys, sc_weights, c_win_start, c_win_end,
            cum_speech, total_speech_units, num_win, is_chapter_level=False
        )

        # Tahap C: Sub-Adegan -> Kalimat -> Chunk 2-3 kata + snap ke micro-valley antar-kata
        for s_idx, sc_obj in enumerate(scenes):
            sc_start = scene_boundaries[s_idx]
            sc_end = scene_boundaries[s_idx + 1]
            sc_dur = max(0.5, sc_end - sc_start)

            clean_sc_text = sanitize_subtitle_text(sc_obj.get("script", ""))
            sub_sents = [p.strip() for p in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", clean_sc_text) if p.strip()]
            if len(sub_sents) > 1:
                sent_weights = [
                    estimate_spoken_weight(p, p[-1] if p[-1] in ".!?,;:" else ".", lang=lang)
                    for p in sub_sents
                ]
                sent_bounds = _dp_align_speech_boundaries(
                    micro_valleys, sent_weights, sc_start, sc_end,
                    cum_speech, total_speech_units, num_win, is_chapter_level=False
                )
            else:
                sub_sents = [clean_sc_text or chap_obj["title"]]
                sent_bounds = [sc_start, sc_end]

            scene_sub_items = []
            for sk, sent_txt in enumerate(sub_sents):
                p_start = sent_bounds[sk]
                p_end = sent_bounds[sk + 1]
                i0 = max(0, int(round(p_start / 0.01)))
                i1 = min(num_win - 1, int(round(p_end / 0.01)))
                local_speech = np.where(is_speech[i0:i1 + 1] == 1)[0]
                if len(local_speech) > 0:
                    sp_start = max(p_start, (i0 + int(local_speech[0])) * 0.01)
                    sp_end = min(p_end - 0.02, (i0 + int(local_speech[-1]) + 1) * 0.01)
                    if sp_end <= sp_start + 0.15:
                        sp_start = p_start + 0.03
                        sp_end = max(sp_start + 0.25, p_end - 0.03)
                else:
                    sp_start = p_start + 0.03
                    sp_end = max(sp_start + 0.25, p_end - 0.03)

                punct = sent_txt[-1] if sent_txt and sent_txt[-1] in ".!?,;:" else ""
                ch_list = split_clause_into_2_3_words(sent_txt) or [sent_txt]
                ch_weights = [
                    estimate_spoken_weight(ch, punct if j == len(ch_list) - 1 else "", lang=lang)
                    for j, ch in enumerate(ch_list)
                ]

                f_s = time_to_speech_fraction(sp_start)
                f_e = max(f_s + 0.0005, time_to_speech_fraction(sp_end))
                tot_w = max(1.0, sum(ch_weights))

                chunk_bounds = [sp_start]
                acc_w = 0.0
                for j_idx in range(len(ch_list) - 1):
                    acc_w += ch_weights[j_idx]
                    pred_t = speech_fraction_to_time(f_s + (f_e - f_s) * (acc_w / tot_w))
                    min_next = chunk_bounds[-1] + 0.15
                    max_next = sp_end - 0.15 * (len(ch_list) - 1 - j_idx)
                    snapped_t = pred_t
                    best_snap = None
                    for mv in micro_valleys:
                        if mv["mid_s"] < min_next or mv["mid_s"] > max_next:
                            continue
                        d = abs(mv["mid_s"] - pred_t)
                        if d <= 0.14:
                            score = d - mv["dur_s"] * 0.5
                            if best_snap is None or score < best_snap[0]:
                                best_snap = (score, mv["mid_s"])
                    if best_snap is not None:
                        snapped_t = best_snap[1]
                    snapped_t = max(min_next, min(max_next if max_next >= min_next else min_next, snapped_t))
                    chunk_bounds.append(snapped_t)
                chunk_bounds.append(max(chunk_bounds[-1] + 0.13, sp_end))

                for j_idx, ch_str in enumerate(ch_list):
                    t0 = chunk_bounds[j_idx]
                    t1 = chunk_bounds[j_idx + 1]
                    disp = re.sub(r"[.!?,;:]+$", "", ch_str).strip().upper()
                    if disp:
                        scene_sub_items.append((t0, t1, disp))
                        timed_subtitles.append((t0, t1, disp))

            # Penentuan Cut Visual Cerdas di dalam Sub-Adegan:
            # Bagi Sub-Adegan menjadi N cut visual (target ~1.8s - 2.8s per cut) di mana setiap titik pergantian cut
            # DIKUNCI PERSIS di batas selesai chunk subtitle 2-3 kata (tidak pernah memotong di tengah kata/subtitle)!
            scene_cuts = []
            max_cuts_cap = max(1, int(sc_obj.get("max_cuts") or chap_obj.get("max_cuts") or 99))
            target_n_cuts = max(1, min(max_cuts_cap, len(scene_sub_items), int(round(sc_dur / 2.25))))
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

def has_cropped_or_floating_static_text(frames_bgr, allow_natural_scene=False):
    """
    Mendeteksi potongan teks/huruf terpotong di tepi kiri/kanan/bawah frame 9:16 maupun
    teks overlay/infografis mengambang secara pairwise multi-window (menangkap teks
    yang muncul di awal/akhir klip maupun yang fade/slide perlahan dari video sumber 16:9).
    """
    if not frames_bgr or len(frames_bgr) < 2:
        return False

    grays_u8 = []
    for fr in frames_bgr:
        if fr is None or getattr(fr, "size", 0) == 0:
            continue
        sm = cv2.resize(fr, (270, 480), interpolation=cv2.INTER_AREA)
        grays_u8.append(cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY))

    if len(grays_u8) < 2:
        return False

    h, w = grays_u8[0].shape[:2]
    k_small = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 5))
    k_large = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 7))
    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3))

    border_hits = 0
    banner_hits = 0
    watermark_hits = 0

    for idx in range(len(grays_u8) - 1):
        g0 = grays_u8[idx].astype(np.float32)
        g1 = grays_u8[idx + 1].astype(np.float32)
        pair_diff = np.abs(g0 - g1)
        med_gray = ((g0 + g1) * 0.5).astype(np.uint8)

        sr1 = np.maximum(cv2.morphologyEx(med_gray, cv2.MORPH_TOPHAT, k_small), cv2.morphologyEx(med_gray, cv2.MORPH_BLACKHAT, k_small))
        sr2 = np.maximum(cv2.morphologyEx(med_gray, cv2.MORPH_TOPHAT, k_large), cv2.morphologyEx(med_gray, cv2.MORPH_BLACKHAT, k_large))
        stroke_resp = np.maximum(sr1, sr2)
        edges = cv2.Canny(med_gray, 55, 160)

        static_stroke = ((stroke_resp > 30) & (edges > 0) & (pair_diff < 12.0)).astype(np.uint8) * 255
        grouped = cv2.morphologyEx(static_stroke, cv2.MORPH_CLOSE, k_close)
        contours, _ = cv2.findContours(grouped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        pair_edge = False
        pair_banner = False
        pair_wm = False
        side_fragments = 0

        for cnt in contours:
            x, y, bw, bh = cv2.boundingRect(cnt)
            # Abaikan statusbar paling atas / bilah navigasi paling bawah ekstrem
            if y < int(h * 0.04) or (y + bh) > int(h * 0.96):
                continue
            if bh < 6 or bh > 115 or bw < 12:
                continue

            patch_static = static_stroke[y:y + bh, x:x + bw]
            fill_density = float(np.count_nonzero(patch_static)) / float(max(1, bw * bh))
            if fill_density < 0.14:
                continue

            row_trans = np.sum(np.abs(np.diff((patch_static > 0).astype(np.int8), axis=1)), axis=1)
            max_transitions = int(np.max(row_trans)) if row_trans.size > 0 else 0
            row_cov = np.count_nonzero(patch_static, axis=1) / float(max(1, bw))
            active_rows = float(np.count_nonzero(row_cov >= 0.12)) / float(max(1, bh))
            aspect = bw / float(max(1, bh))

            if bh < 8 and not (aspect >= 3.0 and fill_density >= 0.24 and max_transitions >= 14):
                continue
            if active_rows < 0.42:
                continue

            touches_left = (x <= 10)
            touches_right = (x + bw >= w - 10)
            in_side_margin = (x <= int(w * 0.18)) or (x + bw >= int(w * 0.82))

            # 1. Potongan huruf/teks statis atau perlahan terpotong di tepi kiri/kanan frame
            if (touches_left or touches_right) and bw >= 14:
                if allow_natural_scene:
                    if (max_transitions >= 10 and aspect >= 2.0 and fill_density >= 0.22) or (max_transitions >= 12 and bh >= 10 and fill_density >= 0.25):
                        pair_edge = True
                else:
                    if max_transitions >= 8 or (bw >= 24 and max_transitions >= 3):
                        pair_edge = True

            # 2. Sekumpulan fragmen huruf di margin samping
            if not allow_natural_scene and in_side_margin and bw >= 16 and max_transitions >= 5:
                side_fragments += 1
                if side_fragments >= 2:
                    pair_edge = True

            # 3. Watermark bawah atau banner teks mengambang di zona atas/bawah
            in_top_bot_band = (int(h * 0.05) <= y <= int(h * 0.25)) or (int(h * 0.72) <= (y + bh) <= int(h * 0.96))
            if in_top_bot_band and bw >= 36 and aspect >= 2.2 and max_transitions >= 10 and active_rows >= 0.50:
                if allow_natural_scene:
                    if (y + bh) >= int(h * 0.88) and fill_density >= 0.24 and max_transitions >= 15 and aspect >= 3.2:
                        pair_wm = True
                else:
                    pair_banner = True

            # 4. Banner teks lebar / infografis spek melayang di tengah layar (mis. Dimensity 6400)
            if not allow_natural_scene and bw >= 150 and aspect >= 4.0 and max_transitions >= 35 and active_rows >= 0.55:
                pair_banner = True

        if pair_edge:
            border_hits += 1
        if pair_banner:
            banner_hits += 1
        if pair_wm:
            watermark_hits += 1

    n_pairs = len(grays_u8) - 1
    if border_hits >= 1 or watermark_hits >= 1:
        return True
    if n_pairs <= 4:
        return banner_hits >= 1
    return banner_hits >= 2

def has_side_by_side_dual_phones(frame_or_frames):
    """
    Mendeteksi frame perbandingan 2 handphone berdampingan secara ketat:
    - Mengembalikan True hanya jika terdapat >= 2 siluet/layar HP persegi panjang besar
      terpisah di kiri dan kanan frame dengan celah pemisah vertikal nyata, DAN tidak berada di dalam 1 kontur bodi tunggal.
    """
    frames = frame_or_frames if isinstance(frame_or_frames, (list, tuple)) else [frame_or_frames]
    dual_hits = 0
    valid_cnt = 0

    for fr in frames:
        if fr is None or getattr(fr, "size", 0) == 0:
            continue
        valid_cnt += 1
        sm = cv2.resize(fr, (270, 480), interpolation=cv2.INTER_AREA)
        h, w = sm.shape[:2]
        roi = sm[int(h * 0.12):int(h * 0.88), :]
        rh, rw = roi.shape[:2]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)

        edges = cv2.Canny(blur, 45, 130)
        k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 9))
        closed_edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, k_close)
        edge_contours, _ = cv2.findContours(closed_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Catat kontur pembungkus besar (1 HP tunggal lebar) agar tampilan split UI dalam 1 layar tidak salah ditandai
        outer_single_boxes = []
        for oc in edge_contours:
            ox, oy, ow, oh = cv2.boundingRect(oc)
            if ow >= int(rw * 0.50) and oh >= int(rh * 0.45):
                outer_single_boxes.append((ox, oy, ox + ow, oy + oh))

        _, bright_mask = cv2.threshold(blur, 155, 255, cv2.THRESH_BINARY)
        _, dark_mask = cv2.threshold(blur, 75, 255, cv2.THRESH_BINARY_INV)
        k_obj = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        cand_lists = [(edge_contours, False)]
        for m in (bright_mask, dark_mask):
            m_clean = cv2.morphologyEx(m, cv2.MORPH_OPEN, k_obj)
            m_clean = cv2.morphologyEx(m_clean, cv2.MORPH_CLOSE, k_close)
            cs, _ = cv2.findContours(m_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cand_lists.append((cs, True))

        found_dual = False
        for cs, check_enclosing in cand_lists:
            boxes = []
            narrow_boxes = []
            for cnt in cs:
                x, y, bw, bh = cv2.boundingRect(cnt)
                if bh < int(rh * 0.30) or bw > int(rw * 0.47):
                    continue
                aspect = bh / float(max(1, bw))
                if not (1.25 <= aspect <= 6.8):
                    continue
                solidity = cv2.contourArea(cnt) / float(max(1, bw * bh))
                if solidity < 0.65:
                    continue
                if bw >= int(rw * 0.11):
                    narrow_boxes.append((x, y, bw, bh, x + bw / 2.0))
                if bw >= int(rw * 0.18) and bh >= int(rh * 0.34) and aspect <= 3.6:
                    boxes.append((x, y, bw, bh, x + bw / 2.0))

            # Deteksi baris 3+ / 4 unit HP sejajar horizontal (mis. promo lineup pilihan warna HP)
            if len(narrow_boxes) >= 3:
                nb_sorted = sorted(narrow_boxes, key=lambda b: b[0])
                aligned_group = [nb_sorted[0]]
                for nb in nb_sorted[1:]:
                    prev = aligned_group[-1]
                    y_ov = max(0, min(prev[1] + prev[3], nb[1] + nb[3]) - max(prev[1], nb[1]))
                    if nb[0] >= prev[0] + int(prev[2] * 0.45) and y_ov >= 0.55 * min(prev[3], nb[3]):
                        aligned_group.append(nb)
                if len(aligned_group) >= 3:
                    ux0 = aligned_group[0][0]
                    ux1 = aligned_group[-1][0] + aligned_group[-1][2]
                    uy0 = min(b[1] for b in aligned_group)
                    uy1 = max(b[1] + b[3] for b in aligned_group)
                    if (ux1 - ux0) >= int(rw * 0.55):
                        inside_one = check_enclosing and any(
                            ox0 <= ux0 + 4 and ox1 >= ux1 - 4 and oy0 <= uy0 + 6 and oy1 >= uy1 - 6
                            for ox0, oy0, ox1, oy1 in outer_single_boxes
                        )
                        if not inside_one:
                            found_dual = True
                            break

            for i in range(len(boxes)):
                for j in range(i + 1, len(boxes)):
                    x1, y1, w1, h1, cx1 = boxes[i]
                    x2, y2, w2, h2, cx2 = boxes[j]
                    if x1 > x2:
                        x1, y1, w1, h1, cx1, x2, y2, w2, h2, cx2 = x2, y2, w2, h2, cx2, x1, y1, w1, h1, cx1
                    if (x2 - (x1 + w1)) < int(rw * 0.025):
                        continue
                    if cx1 > rw * 0.47 or cx2 < rw * 0.53:
                        continue
                    y_ov = max(0, min(y1 + h1, y2 + h2) - max(y1, y2))
                    if y_ov < 0.62 * min(h1, h2):
                        continue
                    if (min(h1, h2) / float(max(h1, h2))) < 0.68:
                        continue
                    if check_enclosing:
                        uy0, uy1 = min(y1, y2), max(y1 + h1, y2 + h2)
                        ux0, ux1 = x1, x2 + w2
                        inside_one = any(
                            ox0 <= ux0 + 4 and ox1 >= ux1 - 4 and oy0 <= uy0 + 6 and oy1 >= uy1 - 6
                            for ox0, oy0, ox1, oy1 in outer_single_boxes
                        )
                        if inside_one:
                            continue
                    found_dual = True
                    break
                if found_dual:
                    break
            if found_dual:
                break

        if found_dual:
            dual_hits += 1

    if valid_cnt == 0:
        return False
    needed = 1 if valid_cnt == 1 else max(2, (valid_cnt + 1) // 2)
    return dual_hits >= needed

def verify_clip_100pct_face_free(clip_path, detector, step=3, is_camera_chap=False):
    """
    Memindai file klip MP4 yang sudah dipotong untuk menjamin:
    - 0% frame wajah (YuNet ONNX)
    - 0% animasi tombol Subscribe YouTube
    - Bukan adegan perbandingan 2 handphone berdampingan dalam 1 frame
    - Bukan gambar statis / foto diam maupun potongan teks statis mengambang jika di luar Bab Kamera (`not is_camera_chap`)
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
    if sampled_small and has_side_by_side_dual_phones(sampled_small):
        return False
    if not is_camera_chap and len(sampled_small) >= 3:
        # Cek still-image menggunakan 6 sampel renggang (~seluruh durasi klip) agar slow-fit halus tidak salah ditandai statis
        if len(sampled_small) >= 4:
            still_idx = np.linspace(0, len(sampled_small) - 1, min(6, len(sampled_small)), dtype=int)
            if is_static_still_sequence([sampled_small[i] for i in still_idx]):
                return False
        # Cek potongan huruf/overlay menggunakan hingga 12 sampel rapat (khusus non-Kamera agar hasil tangkapan kamera alami tetap lolos)
        pick_idx = np.linspace(0, len(sampled_small) - 1, min(12, len(sampled_small)), dtype=int)
        motion_samples = [sampled_small[i] for i in pick_idx]
        if has_cropped_or_floating_static_text(motion_samples, allow_natural_scene=False):
            return False
    return True

def verify_source_window_clean(video_path, seg_start, exact_dur, detector, samples=9, is_camera_chap=False):
    """
    Memverifikasi segmen kandidat langsung dari video sumber (sebelum dipotong 1080p)
    untuk memastikan 0% frame wajah (YuNet), 0% animasi tombol Subscribe YouTube,
    bebas 2 handphone berdampingan, dan (khusus di luar Bab Kamera) bebas gambar statis maupun teks terpotong kiri-kanan-bawah.
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
    if sampled_small and has_side_by_side_dual_phones(sampled_small):
        return False
    if not is_camera_chap and len(sampled_small) >= 3:
        if len(sampled_small) >= 4 and is_static_still_sequence(sampled_small):
            return False
        if has_cropped_or_floating_static_text(sampled_small, allow_natural_scene=False):
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
    if has_side_by_side_dual_phones(crops):
        return None, None
    # Tolak gambar statis maupun potongan huruf/watermark di luar Bab Kamera (Kamera tetap dicek wajah/2-HP/subscribe di atas)
    if not is_camera_chap:
        if is_static_still_sequence(crops):
            return None, None
        if has_cropped_or_floating_static_text(crops, allow_natural_scene=False):
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
        # ATURAN KHUSUS BAB KAMERA: Meloloskan sampel foto/video, aplikasi kamera, atau modul lensa, TAPI tetap melarang 2+ HP perbandingan!
        cam_rule = "BAB KAMERA: Set is_product_broll = true JIKA gambar menampilkan modul kamera dari SATU (1) HP, antarmuka kamera SATU HP, ATAU hasil jepretan foto/video (pemandangan, bangunan, objek). Jangan tolak pemandangan/objek luar karena itu sampel kamera, NAMUN tetap set has_multiple_phones = true jika membandingkan 2 HP!"
        overlay_rule = "5. has_editor_overlay = true JIKA ada teks besar editor, tabel spesifikasi layar penuh, screenshot marketplace, watermark besar, ATAU animasi tombol Subscribe/Like/Lonceng YouTube."
        static_rule = "6. is_static_image = false (khusus Bab Kamera, sampel foto statis/jepretan kamera DIPERBOLEHKAN penuh)."
    else:
        cam_rule = (
            "WAJIB FISIK 1 UNIT HP (NON-KAMERA): Set is_product_broll = true HANYA JIKA di kelima frame TERLIHAT JELAS "
            "FISIK BINGKAI/BODI/LAYAR SATU (1) UNIT HANDPHONE saja (dipegang tangan, di atas meja, atau sedang dites fisiknya). "
            "Set is_product_broll = false JIKA berupa screen-recording/rekaman layar game/video penuh tanpa bingkai fisik HP, "
            "tangan kosong berbicara, meja/ruangan kosong, dus/kabel/charger/case saja tanpa HP, atau grafik benchmark penuh tanpa wujud HP!"
        )
        overlay_rule = (
            "5. has_editor_overlay = true JIKA di SALAH SATU frame terdapat teks mengambang statis, poin spesifikasi editor, label harga/fitur, "
            "subtitle permanen video asli, watermark teks besar, screenshot marketplace, animasi tombol Subscribe/Like/Lonceng, "
            "ATAU POTONGAN HURUF/KATA YANG TERPOTONG MASUK DARI TEPI KIRI ATAU KANAN FRAME akibat crop vertikal 9:16."
        )
        static_rule = "6. is_static_image = true JIKA kelima frame menampilkan GAMBAR STATIS / FOTO DIAM / SLIDE PRESENTASI / SCREENSHOT / SKOR ANTUTU DIAM / TABEL SPESIFIKASI tanpa pergerakan video nyata (atau hanya efek zoom/pan lambat pada foto diam). Untuk bab selain Kamera, gambar statis WAJIB DITOLAK!"

    focus_line = f"Fokus Visual Sub-Adegan: {visual_focus}" if visual_focus else f"Target Bab Visual: {chapter_title}"
    vo_line = f"Kalimat Voiceover Adegan Ini: \"{scene_vo}\"" if scene_vo else ""

    prompt = "\n".join([
        "Gambar ini adalah gabungan 5 frame berurutan (kiri ke kanan) dari sebuah potongan video 9:16.",
        f"Target Bab Visual: {chapter_title}",
        focus_line,
        vo_line,
        f"Transkrip Asli di detik ini: \"{raw_sub}\"",
        "",
        "ATURAN VALIDASI KETAT (PERIKSA KELIMA FRAME DARI KIRI KE KANAN):",
        f"1. {cam_rule}",
        "2. Set is_product_broll = false JIKA gambar adalah dus/kotak HP saja, monitor PC, toko online, rekaman layar tanpa bodi HP, atau latar tanpa unit handphone.",
        "3. has_face = true JIKA ada wajah manusia (wajah reviewer/orang) di SALAH SATU dari 5 frame. WAJIB TOLAK jika ada wajah.",
        "4. has_subscribe_popup = true JIKA di SALAH SATU dari 5 frame terdapat animasi logo/identitas channel (logo 3D melayang, URL website www..., bumper intro/outro channel), tombol SUBSCRIBE YouTube (merah/putih/hitam), ikon lonceng notifikasi, animasi kursor/tangan mengklik tombol Subscribe/Like, pop-up nama channel YouTube, atau banner ajakan Subscribe/Like/Follow yang bergerak masuk.",
        overlay_rule,
        static_rule,
        "7. has_multiple_phones = true JIKA di SALAH SATU dari 5 frame terlihat 2 UNIT HANDPHONE ATAU LEBIH secara bersamaan (misalnya perbandingan 2 HP berdampingan/sejajar di meja atau tangan, perbandingan layar sebelah-menyebelah, HP lain muncul sebagian di tepi frame, atau kolase HP pembanding). Maksimal HANYA boleh 1 unit handphone (atau 0 HP khusus sampel foto kamera)!",
        "8. reason = alasan singkat 1 kalimat.",
        "Kembalikan HANYA format JSON murni dengan key: is_product_broll (boolean), has_face (boolean), has_subscribe_popup (boolean), has_editor_overlay (boolean), is_static_image (boolean), has_multiple_phones (boolean), reason (string)."
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

COMPARISON_DEPRIORITIZE_KEYWORDS = [
    " vs ", "versus", "side by side", "perbandingan", "dibanding", "compare", "kompetitor", "saingannya"
]

def collect_candidates_for_scene(scene_info, chap_cfg, chap_start_s, chap_end_s, face_free_segs, events, used_windows, total_dur=600.0):
    """
    Mengumpulkan kandidat segmen B-Roll bebas wajah yang paling relevan dengan Sub-Adegan spesifik:
    - Menolak segmen yang berada di zona rawan animasi Subscribe (awal video < 38s atau outro > total_dur - 25s)
      maupun segmen yang transkrip aslinya mengucapkan ajakan Subscribe/Like/Lonceng.
    - Menurunkan prioritas segmen bertema perbandingan dua HP ('vs', 'perbandingan', 'side by side') ke akhir tiap tier.
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
            is_cmp = any(ckw in f" {sub_context} " for ckw in COMPARISON_DEPRIORITIZE_KEYWORDS)

            item = (curr, slice_end, is_cmp)
            if in_sc_range and has_sc_kw:
                tier1_exact.append(item)
            elif has_sc_kw or in_sc_range:
                tier2_scene.append(item)
            elif in_chap_range or has_chap_kw:
                tier3_chap.append(item)
            else:
                tier4_backup.append(item)
            curr += 2.3

    def downsample(lst, limit):
        clean_first = [(s, e) for s, e, is_cmp in lst if not is_cmp]
        cmp_last = [(s, e) for s, e, is_cmp in lst if is_cmp]
        ordered = clean_first + cmp_last
        if len(ordered) <= limit:
            return ordered
        idx = np.linspace(0, len(ordered) - 1, limit, dtype=int)
        return [ordered[i] for i in idx]

    return (
        downsample(tier1_exact, 8)
        + downsample(tier2_scene, 8)
        + downsample(tier3_chap, 6)
        + downsample(tier4_backup, 6)
    )

def cut_exact_broll_clip_1080p(video_path, seg_start, exact_dur, out_path, avail_dur=None):
    vf = "crop=ih*9/16:ih:(iw-ow)/2:0,scale=1080:1920:flags=lanczos"
    if avail_dur is not None and 0.8 <= float(avail_dur) < (exact_dur - 0.08):
        src_span = float(avail_dur)
        pts_factor = min(1.90, exact_dur / max(0.8, src_span))
        vf += f",setpts=(PTS-STARTPTS)*{pts_factor:.4f},fps=30,format=yuv420p"
    else:
        src_span = exact_dur
        vf += ",fps=30,format=yuv420p,setpts=PTS-STARTPTS"
    cmd = [
        "ffmpeg", "-nostdin", "-y", "-loglevel", "fatal",
        "-ss", f"{seg_start:.3f}", "-t", f"{src_span:.3f}", "-i", video_path,
        "-vf", vf,
        "-t", f"{exact_dur:.3f}",
        "-an",
        "-c:v", "libx264", "-preset", "superfast", "-crf", "19",
        "-g", "30", "-video_track_timescale", "30000",
        out_path
    ]
    subprocess.run(cmd, check=True)

def _sample_frames_sequential(cap, timestamps, fps=30.0, state=None):
    """
    Membaca frame pada daftar timestamp menaik secara sekuensial dengan cap.grab()
    agar H.264 tidak melakukan seek-keyframe berulang kali (~40x lebih cepat di ARM/Termux).
    """
    if cap is None or not timestamps:
        return []
    safe_fps = float(fps) if (fps and 5.0 <= fps <= 120.0) else 30.0
    if state is None:
        state = {"cur_t": None}
    out = []
    for t_q in timestamps:
        target_t = float(t_q)
        cur_t = state.get("cur_t")
        if cur_t is None or target_t < cur_t - 0.15 or (target_t - cur_t) > 4.0:
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, target_t * 1000.0))
            if not cap.grab():
                state["cur_t"] = None
                continue
            ret, frm = cap.retrieve()
            if not ret or frm is None:
                continue
            state["cur_t"] = target_t
            out.append((target_t, frm))
        else:
            steps = max(0, int(round((target_t - cur_t) * safe_fps)))
            if steps == 0:
                if not cap.grab():
                    state["cur_t"] = None
                    continue
                steps = 1
            else:
                ok_grab = True
                for _ in range(steps):
                    if not cap.grab():
                        ok_grab = False
                        break
                if not ok_grab:
                    state["cur_t"] = None
                    continue
            ret, frm = cap.retrieve()
            state["cur_t"] = cur_t + (steps / safe_fps)
            if ret and frm is not None:
                out.append((target_t, frm))
    return out


def segment_face_free_by_shots(video_path, face_free_segs, total_dur, max_subclips=60):
    """
    Memecah segmen bebas-wajah pada pergantian shot visual nyata (korelasi HSV < 0.72)
    sehingga satu kandidat klip tidak pernah mencampur dua adegan berbeda (mis. body + gaming).
    """
    if not face_free_segs:
        return []
    safe_min = 20.0 if total_dur > 90.0 else 6.0
    safe_max = max(safe_min + 15.0, total_dur - 12.0) if total_dur > 90.0 else max(safe_min + 5.0, total_dur - 3.0)

    raw_intervals = []
    for fs_s, fs_e in face_free_segs:
        s = max(safe_min, float(fs_s))
        e = min(safe_max, float(fs_e))
        if (e - s) >= 1.55:
            raw_intervals.append((s, e))

    sub_windows = []
    cap = cv2.VideoCapture(video_path) if (video_path and os.path.exists(video_path)) else None
    vid_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0) if cap is not None else 30.0
    seq_state = {"cur_t": None}
    try:
        for s, e in raw_intervals:
            dur = e - s
            if dur <= 3.6 or cap is None:
                # Langsung jadikan 1 kandidat bersih atau bagi rata jika terlalu panjang tanpa video
                if dur <= 3.8:
                    sub_windows.append((round(s, 2), round(e, 2)))
                else:
                    n_part = min(3, max(1, int(round(dur / 2.8))))
                    span = dur / n_part
                    for k in range(n_part):
                        sub_windows.append((round(s + k * span, 2), round(min(e, s + (k + 1) * span), 2)))
                continue

            # Deteksi shot-cut internal pada ~3 fps sekuensial tanpa re-seek berulang
            sample_ts = []
            t_cur = s + 0.14
            while t_cur <= e - 0.10:
                sample_ts.append(t_cur)
                t_cur += 0.33

            prev_hist = None
            shot_start = s
            shot_spans = []
            for t_q, frm in _sample_frames_sequential(cap, sample_ts, fps=vid_fps, state=seq_state):
                crop = crop_center_9_16(frm)
                sm = cv2.resize(crop, (64, 114), interpolation=cv2.INTER_AREA)
                hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)
                cur_hist = cv2.calcHist([hsv], [0, 1], None, [12, 8], [0, 180, 0, 256])
                cv2.normalize(cur_hist, cur_hist, 0, 1, cv2.NORM_MINMAX)

                if prev_hist is not None and cv2.compareHist(prev_hist, cur_hist, cv2.HISTCMP_CORREL) < 0.72:
                    cut_end = max(shot_start, t_q - 0.22)
                    if (cut_end - shot_start) >= 1.55:
                        shot_spans.append((shot_start, cut_end))
                    shot_start = t_q + 0.22
                    prev_hist = None
                else:
                    prev_hist = cur_hist

            if (e - shot_start) >= 1.55:
                shot_spans.append((shot_start, e))

            for a, b in shot_spans:
                sdur = b - a
                if sdur <= 3.8:
                    sub_windows.append((round(a, 2), round(b, 2)))
                else:
                    n_slices = min(3, max(2, int(round(sdur / 2.8))))
                    step = (sdur - 2.6) / max(1, n_slices - 1) if sdur > 7.5 else (sdur / n_slices)
                    for k in range(n_slices):
                        if sdur > 7.5:
                            w0 = a + k * step
                            w1 = min(b, w0 + 2.8)
                        else:
                            w0 = a + k * step
                            w1 = min(b, a + (k + 1) * step - (0.08 if k < n_slices - 1 else 0.0))
                        if (w1 - w0) >= 1.55:
                            sub_windows.append((round(w0, 2), round(w1, 2)))
    finally:
        if cap is not None:
            cap.release()

    if len(sub_windows) > max_subclips:
        pick_idx = np.linspace(0, len(sub_windows) - 1, max_subclips, dtype=int)
        sub_windows = [sub_windows[int(i)] for i in pick_idx]
    return sub_windows

def _extract_local_clip_samples(video_path, candidate_windows, detector, events):
    """
    Mengambil 5 frame sampel per kandidat window dalam satu pass OpenCV sekuensial,
    membuang wajah/subscribe/2-HP, dan menandai metadata lokal statis / teks tepi untuk Vision.
    """
    if not candidate_windows or not video_path or not os.path.exists(video_path):
        return []
    cap = cv2.VideoCapture(video_path)
    vid_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    seq_state = {"cur_t": None}
    samples = []
    ordered_windows = sorted(enumerate(candidate_windows), key=lambda x: (float(x[1][0]), float(x[1][1])))
    try:
        for cid_num, (t_s, t_e) in ordered_windows:
            sub_ctx = get_transcript_slice(events, max(0.0, t_s - 3.5), t_e + 3.5).lower()
            if any(bad_kw in sub_ctx for bad_kw in SUBSCRIBE_BLACKLIST_KEYWORDS):
                continue

            span = max(0.5, t_e - t_s)
            ts_list = [t_s + span * f for f in (0.08, 0.22, 0.36, 0.50, 0.64, 0.78, 0.92)]
            frames_270 = []
            has_face = False
            for _, frm in _sample_frames_sequential(cap, ts_list, fps=vid_fps, state=seq_state):
                crop = crop_center_9_16(frm)
                sm = cv2.resize(crop, (270, 480), interpolation=cv2.INTER_AREA)
                if detector is not None:
                    _, faces = detector.detect(sm)
                    if faces is not None and len(faces) > 0:
                        has_face = True
                        break
                frames_270.append(sm)

            if has_face or len(frames_270) < 3:
                continue
            if has_animated_subscribe_badge(frames_270):
                continue
            if has_side_by_side_dual_phones(frames_270):
                continue

            mid_fr = frames_270[len(frames_270) // 2]
            mid_hist = _compute_frame_hist(mid_fr)
            is_static_loc = is_static_still_sequence(frames_270)
            has_edge_strict = has_cropped_or_floating_static_text(frames_270, allow_natural_scene=False)
            has_edge_cam = has_cropped_or_floating_static_text(frames_270, allow_natural_scene=True)

            strip = [
                cv2.resize(frames_270[0], (180, 320), interpolation=cv2.INTER_AREA),
                cv2.resize(mid_fr, (180, 320), interpolation=cv2.INTER_AREA),
                cv2.resize(frames_270[-1], (180, 320), interpolation=cv2.INTER_AREA),
            ]
            samples.append({
                "idx": cid_num,
                "start_s": round(t_s, 2),
                "end_s": round(t_e, 2),
                "duration_s": round(t_e - t_s, 2),
                "strip": strip,
                "mid_hist": mid_hist,
                "is_static_local": bool(is_static_loc),
                "has_edge_text_local": bool(has_edge_strict),
                "has_edge_text_cam_local": bool(has_edge_cam),
                "transcript_slice": get_transcript_slice(events, t_s, t_e),
            })
    finally:
        cap.release()
    return samples

def _build_row_strip_contact_sheet(batch_samples, quality=84):
    """Menyusun strip horisontal 3-frame per kandidat menjadi 1 contact sheet vertikal bernomor #1..#N."""
    tw, th = 180, 320
    row_w = tw * 3
    n_rows = len(batch_samples)
    sheet = np.zeros((n_rows * th, row_w, 3), dtype=np.uint8)
    for r_i, item in enumerate(batch_samples):
        y0 = r_i * th
        for c_i, fr in enumerate(item["strip"][:3]):
            cell = cv2.resize(fr, (tw, th), interpolation=cv2.INTER_AREA) if (fr.shape[1] != tw or fr.shape[0] != th) else fr.copy()
            sheet[y0:y0 + th, c_i * tw:(c_i + 1) * tw] = cell
        label = f"#{r_i + 1}"
        cv2.rectangle(sheet, (4, y0 + 4), (24 + 18 * len(label), y0 + 38), (0, 0, 0), -1)
        cv2.putText(sheet, label, (10, y0 + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 235, 255), 2, cv2.LINE_AA)
    _, buf = cv2.imencode(".jpg", sheet, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return base64.b64encode(buf.tobytes()).decode("utf-8")

def _match_youtube_chapter_title(t_mid, youtube_chapters):
    for ch in (youtube_chapters or []):
        if ch["start_sec"] <= t_mid <= ch["end_sec"]:
            return ch["title"]
    return ""

def _deduplicate_classified_pools(pools):
    """Menghapus duplikasi visual (HSV corr >= 0.85 atau jeda < 3.0s) di dalam setiap pool kategori."""
    cleaned = {}
    for cid, items in pools.items():
        ranked = sorted(items, key=lambda x: (-float(x.get("confidence", 0.5)), x["start_s"]))
        kept = []
        for it in ranked:
            mid_t = (it["start_s"] + it["end_s"]) / 2.0
            too_close = any(abs(mid_t - ((k["start_s"] + k["end_s"]) / 2.0)) < 3.0 for k in kept)
            if too_close:
                continue
            h_cur = it.get("mid_hist")
            if h_cur is not None and any(
                k.get("mid_hist") is not None and cv2.compareHist(h_cur, k["mid_hist"], cv2.HISTCMP_CORREL) >= 0.85
                for k in kept
            ):
                continue
            kept.append(it)
        cleaned[cid] = kept
    return cleaned

def classify_all_candidate_clips(video_path, vid_id, work_dir, face_free_segs, detector, events, youtube_chapters, total_dur, api_key):
    """
    Klasifikasi menyeluruh Visual-First:
    - Memecah segmen bebas-wajah pada batas shot, membuang wajah/subscribe/2+ HP secara lokal.
    - Mengirim strip 3-frame bernomor secara batch (6 klip/sheet) + konteks transkrip & chapter
      ke Gemini Vision untuk memetakan tiap klip secara akurat ke 10 jenis adegan SCENE_CATALOG atau REJECT.
    - Menjamin klip game yang terselip di zona body masuk ke `benchmark_dapur_pacu`, bukan acak.
    """
    cache_path = os.path.join(work_dir, "scene_classification_cache.json")
    pools = {c["id"]: [] for c in SCENE_CATALOG}

    if os.path.exists(cache_path):
        try:
            cached = json.load(open(cache_path, "r", encoding="utf-8"))
            if cached.get("vid_id") == vid_id and cached.get("version") == 4 and cached.get("items"):
                raw_items = cached["items"]
                cap = cv2.VideoCapture(video_path) if (video_path and os.path.exists(video_path)) else None
                for it in raw_items:
                    cid = it.get("category")
                    cfg_c = SCENE_CATALOG_MAP.get(cid)
                    if not cfg_c:
                        continue
                    if it.get("has_face") is True or it.get("has_channel_overlay") is True:
                        continue
                    if not cfg_c["allow_static_local"]:
                        if (
                            it.get("has_overlay_text") is True
                            or it.get("has_edge_text_local")
                            or it.get("is_static_local")
                            or it.get("is_static_image") is True
                        ):
                            continue
                    mid_hist = None
                    if cap is not None:
                        mid_t = (float(it["start_s"]) + float(it["end_s"])) / 2.0
                        cap.set(cv2.CAP_PROP_POS_MSEC, mid_t * 1000.0)
                        ret, frm = cap.read()
                        if ret and frm is not None:
                            mid_hist = _compute_frame_hist(crop_center_9_16(frm))
                    it_copy = dict(it)
                    it_copy["mid_hist"] = mid_hist
                    pools[cid].append(it_copy)
                if cap is not None:
                    cap.release()
                deduped = _deduplicate_classified_pools(pools)
                total_ok = sum(len(v) for v in deduped.values())
                if total_ok >= 1:
                    print(f"[+] Memuat {total_ok} klip terklasifikasi unik dari Cache Klasifikasi v4.", flush=True)
                    return deduped
        except Exception:
            pass

    print("\n[*] Memecah & Mengklasifikasikan Setiap Frame/Shot ke 10 Jenis Adegan...", flush=True)
    sub_windows = segment_face_free_by_shots(video_path, face_free_segs, total_dur, max_subclips=75)
    samples = _extract_local_clip_samples(video_path, sub_windows, detector, events)
    print(f"    -> Ditemukan {len(sub_windows)} sub-shot bebas wajah -> {len(samples)} kandidat bersih pasca-filter lokal (anti-wajah/subscribe/2-HP).", flush=True)

    if not samples:
        return pools

    cat_guide = "\n".join(f"- `{c['id']}` ({c['title']}): {c['visual_rule']}" for c in SCENE_CATALOG)
    accepted_flat = []
    used_vision_ok = False
    batch_size = 6

    for b_start in range(0, len(samples), batch_size):
        batch = samples[b_start:b_start + batch_size]
        b64_sheet = _build_row_strip_contact_sheet(batch) if api_key else ""
        ctx_lines = []
        for idx_in_b, item in enumerate(batch, 1):
            t_mid = (item["start_s"] + item["end_s"]) / 2.0
            yt_ch = _match_youtube_chapter_title(t_mid, youtube_chapters)
            sub = (item["transcript_slice"] or "")[:120]
            ctx_lines.append(
                f"Baris #{idx_in_b} [{int(item['start_s'])}s-{int(item['end_s'])}s]"
                + (f" | Chapter: {yt_ch}" if yt_ch else "")
                + (f" | Transkrip: \"{sub}\"" if sub else "")
            )

        parsed = None
        if api_key and b64_sheet:
            prompt = "\n".join([
                f"Gambar ini berisi {len(batch)} baris kandidat klip video (Baris #1 s/d #{len(batch)}, dari atas ke bawah).",
                "Setiap baris menampilkan 3 frame berurutan dari kiri ke kanan (awal, tengah, akhir) dari satu potongan video 9:16.",
                "",
                "KONTEKS TIAP BARIS:",
                *ctx_lines,
                "",
                "ATURAN KLASIFIKASI KETAT (UTAMAKAN APA YANG BENAR-BENAR TERLIHAT DI FRAME!):",
                "- Klasifikasikan SETIAP baris tepat ke SALAH SATU kategori berikut, ATAU `REJECT`:",
                cat_guide,
                "- `REJECT`: Ada WAJAH MANUSIA (di kategori apa pun termasuk `kamera`), animasi OVERLAY IDENTITAS CHANNEL (logo 3D/2D channel berputar seperti DKID/GadgetIn, teks nama channel/URL `www...`, popup Subscribe/Like/Lonceng, promo channel), 2+ HP atau jejeran warna 3-4 HP perbandingan, dus/kabel tanpa HP, halaman luar tanpa HP (taman/rumput kosong non-kamera), slide animasi grafis chipset tanpa HP, ATAU (untuk SELAIN `kamera`) GAMBAR STATIS / FOTO DIAM / SLIDE / HP DIAM MEMBATU di stand tanpa gerakan nyata maupun potongan huruf/teks melayang!",
                "",
                "ATURAN KHUSUS KATEGORI `kamera` vs NON-KAMERA:",
                "- Untuk `kamera`: AGAK LONGGAR khusus tangkapan kamera & teks foto! Tetap WAJIB bebas wajah manusia, bebas logo/identitas channel, & bebas 2+ HP, tetapi HASIL JEPRETAN KAMERA (pemandangan, hewan, bunga, bangunan, malam, viewfinder) boleh foto statis maupun memiliki watermark bawah/badge mode kamera.",
                "- Untuk 9 kategori NON-KAMERA (`body`, `ketahanan_fisik`, `design_layar`, `baterai_daya`, `os`, `benchmark_dapur_pacu`, `speaker`, `fitur_unik`, `cta`): WAJIB terlihat gerakan video nyata pada unit HP (TOLAK gambar statis / Ken Burns zoom foto diam) dan set `is_static_image: true` bila ketiga frame berupa gambar/slide diam!",
                "- JANGAN terkecoh oleh posisi detik! Jika di segmen unboxing/body terselip adegan bermain game -> wajib klasifikasikan ke `benchmark_dapur_pacu`, BUKAN `body`!",
                "- Set `has_face: true` jika ada wajah. Set `has_channel_overlay: true` jika ada logo/identitas channel, URL website, atau animasi Subscribe/Like/Follow. Set `has_overlay_text: true` jika ada potongan huruf di tepi atau teks melayang.",
                "- Hanya 1 unit HP yang diizinkan (`phone_count = 1`), kecuali foto/video hasil jepretan kamera pada kategori `kamera` (`phone_count = 0`).",
                "",
                "Kembalikan HANYA JSON murni berbentuk:",
                '{"items": [{"id": <int 1..N>, "category": "<10_id_atau_REJECT>", "phone_count": <0|1|2>, "has_face": <true|false>, "has_channel_overlay": <true|false>, "is_static_image": <true|false>, "is_clean_broll": <true|false>, "has_overlay_text": <true|false>, "is_back_of_phone": <true|false>, "confidence": <0.0..1.0>, "visual_note": "<deskripsi singkat visual nyata dlm 5-8 kata>"}]}'
            ])
            payload = {
                "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64_sheet}}]}],
                "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
            }
            parsed = call_gemini_json(payload, api_key)

        items_res = parsed.get("items") if isinstance(parsed, dict) else None
        if isinstance(items_res, list) and items_res:
            used_vision_ok = True
            by_id = {}
            for r in items_res:
                if isinstance(r, dict) and "id" in r:
                    try:
                        by_id[int(r["id"])] = r
                    except Exception:
                        pass
            for idx_in_b, smp in enumerate(batch, 1):
                r = by_id.get(idx_in_b)
                if not r:
                    continue
                if r.get("has_face") is True or r.get("has_channel_overlay") is True:
                    continue
                cat_id = str(r.get("category") or "REJECT").strip().lower()
                cfg = SCENE_CATALOG_MAP.get(cat_id)
                if not cfg:
                    continue
                try:
                    p_cnt = int(r.get("phone_count", 1))
                except Exception:
                    p_cnt = 1
                is_clean = r.get("is_clean_broll", True) is True
                has_txt_ov = r.get("has_overlay_text", False) is True
                is_static_ai = r.get("is_static_image", False) is True
                is_camera_cat = (cat_id == "kamera")
                if p_cnt >= 2:
                    continue
                if p_cnt == 0 and not cfg["allow_phone_count_zero"]:
                    continue
                if not is_camera_cat:
                    if not is_clean or has_txt_ov or is_static_ai:
                        continue
                    if smp["is_static_local"] or smp["has_edge_text_local"]:
                        continue
                else:
                    # Untuk `kamera`: izinkan foto/video hasil tangkapan walau ada watermark/teks/statis; hanya blokir jika tidak layak karena wajah/identitas channel/2-HP
                    if (not is_clean) and (not has_txt_ov) and (not is_static_ai):
                        continue
                try:
                    conf = float(r.get("confidence", 0.75))
                except Exception:
                    conf = 0.75

                entry = {
                    "start_s": smp["start_s"],
                    "end_s": smp["end_s"],
                    "duration_s": smp["duration_s"],
                    "category": cat_id,
                    "phone_count": p_cnt,
                    "has_face": False,
                    "has_channel_overlay": False,
                    "is_static_image": bool(is_static_ai),
                    "is_clean_broll": True,
                    "has_overlay_text": bool(has_txt_ov),
                    "is_back_of_phone": bool(r.get("is_back_of_phone", False)),
                    "confidence": conf,
                    "visual_note": sanitize_subtitle_text(r.get("visual_note") or cfg["title"])[:90],
                    "transcript_slice": smp["transcript_slice"][:180],
                    "is_static_local": smp["is_static_local"],
                    "has_edge_text_local": smp["has_edge_text_local"],
                    "has_edge_text_cam_local": smp["has_edge_text_cam_local"],
                    "mid_hist": smp["mid_hist"],
                }
                pools[cat_id].append(entry)
                accepted_flat.append({k: v for k, v in entry.items() if k != "mid_hist"})
        else:
            # Fallback kata kunci lokal hanya bila Vision batch gagal total / tanpa API Key
            for smp in batch:
                t_mid = (smp["start_s"] + smp["end_s"]) / 2.0
                ch_txt = _match_youtube_chapter_title(t_mid, youtube_chapters).lower()
                ctx = f"{ch_txt} {smp['transcript_slice']}".lower()
                matched_cid = "body"
                best_hits = 0
                for c in SCENE_CATALOG:
                    hits = sum(1 for kw in c["keywords"] if kw in ctx)
                    if hits > best_hits:
                        best_hits = hits
                        matched_cid = c["id"]
                if matched_cid != "kamera" and (smp["is_static_local"] or smp["has_edge_text_local"]):
                    continue
                entry = {
                    "start_s": smp["start_s"],
                    "end_s": smp["end_s"],
                    "duration_s": smp["duration_s"],
                    "category": matched_cid,
                    "phone_count": 1,
                    "has_face": False,
                    "has_channel_overlay": False,
                    "is_static_image": False,
                    "is_clean_broll": True,
                    "has_overlay_text": False,
                    "is_back_of_phone": False,
                    "confidence": 0.45,
                    "visual_note": SCENE_CATALOG_MAP[matched_cid]["title"],
                    "transcript_slice": smp["transcript_slice"][:180],
                    "is_static_local": smp["is_static_local"],
                    "has_edge_text_local": smp["has_edge_text_local"],
                    "has_edge_text_cam_local": smp["has_edge_text_cam_local"],
                    "mid_hist": smp["mid_hist"],
                }
                pools[matched_cid].append(entry)
                accepted_flat.append({k: v for k, v in entry.items() if k != "mid_hist"})

    deduped = _deduplicate_classified_pools(pools)
    if accepted_flat and used_vision_ok:
        try:
            flat_deduped = [
                {k: v for k, v in it.items() if k != "mid_hist"}
                for cid_list in deduped.values() for it in cid_list
            ]
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump({"vid_id": vid_id, "version": 4, "items": flat_deduped}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    print("    📊 Hasil Klasifikasi Unik per Jenis Adegan:", flush=True)
    for c in SCENE_CATALOG:
        cnt = len(deduped.get(c["id"], []))
        mark = "✅" if cnt >= 1 else "⚠️ (0 - akan diabaikan)"
        print(f"       - {c['id']:22s}: {cnt:2d} klip unik {mark}", flush=True)
    return deduped

def select_active_scenes_and_assign_slots(classified_pools):
    """
    Memilih adegan yang benar-benar memiliki >= 1 klip unik terklasifikasi (>= 1.5s),
    mengabaikan adegan yang tidak memadai, dan mengalokasikan klip 1:1 tanpa pengulangan.
    """
    pools = {cid: list(classified_pools.get(cid, [])) for cid in SCENE_CATALOG_MAP}

    # Jika CTA tidak punya klip berlabel cta khusus, cadangkan 1 hero showcase sisa yang belum dipakai dari pool berlebih (>= 2 klip)
    if not pools["cta"]:
        for donor_id in ("body", "fitur_unik", "design_layar", "kamera"):
            if len(pools[donor_id]) >= 2:
                # Pilih item back-of-phone terbaik atau item paling akhir agar tidak mengambil hero utama donor
                donor_list = pools[donor_id]
                pick_i = next((i for i in range(len(donor_list) - 1, -1, -1) if donor_list[i].get("is_back_of_phone")), len(donor_list) - 1)
                hero = donor_list.pop(pick_i)
                hero_copy = dict(hero)
                hero_copy["category"] = "cta"
                pools["cta"].append(hero_copy)
                break

    active_cfg_list = []
    for cfg in SCENE_CATALOG:
        cid = cfg["id"]
        avail = pools.get(cid, [])
        if len(avail) >= 1:
            active_cfg_list.append((cfg, avail))
        else:
            print(f"    ⏭️ [ABAIKAN ADEGAN] {cfg['title']} ({cid}): jumlah frame unik tidak memadai (0 klip).", flush=True)

    if not active_cfg_list:
        return []

    n_active = len(active_cfg_list)
    # Tentukan batas cut maksimal tiap adegan tanpa melebihi stok klip uniknya (total cut nyaman <= 18 untuk Shorts)
    cut_counts = [min(len(avail), cfg["max_cuts"]) for cfg, avail in active_cfg_list]
    if n_active <= 5:
        cut_counts = [min(len(avail), max(cfg["max_cuts"], 3)) for cfg, avail in active_cfg_list]
    while sum(cut_counts) > 18 and any(c > 1 for c in cut_counts):
        # Pangkas terlebih dahulu kategori bernilai 3 lalu kategori pelengkap sebelum kategori utama
        trimmed = False
        for cid_pref in ("cta", "speaker", "os", "ketahanan_fisik", "fitur_unik", "baterai_daya", "design_layar", "body", "benchmark_dapur_pacu", "kamera"):
            for i, (cfg, _) in enumerate(active_cfg_list):
                if cfg["id"] == cid_pref and cut_counts[i] > 1:
                    cut_counts[i] -= 1
                    trimmed = True
                    break
            if trimmed:
                break

    # Target total kata proporsional (cukup untuk durasi Shorts 35-55 detik)
    total_word_budget = min(104, max(44, n_active * 12))
    raw_weights = [1.0 + 0.35 * (cc - 1) + (0.25 if cfg["id"] == "cta" else 0.0) for (cfg, _), cc in zip(active_cfg_list, cut_counts)]
    w_sum = max(1.0, sum(raw_weights))

    active_plan = []
    for (cfg, avail), cc, rw in zip(active_cfg_list, cut_counts, raw_weights):
        t_words = max(6, int(round(total_word_budget * (rw / w_sum))))
        if cfg["id"] == "cta":
            t_words = max(10, min(15, t_words))
        assigned = sorted(avail[:cc], key=lambda x: x["start_s"])
        active_plan.append({
            "id": cfg["id"],
            "title": cfg["title"],
            "keywords": cfg["keywords"],
            "visual_rule": cfg["visual_rule"],
            "max_cuts": cc,
            "target_words": t_words,
            "assigned_clips": assigned,
            "spare_clips": avail[cc:],
        })
    return active_plan

def normalize_hashtags(raw_hashtags, lang="id"):
    """
    Memastikan setiap hashtag selalu diawali tanda pagar '#' dan diformat rapi.
    Untuk lang='en': hapus hashtag yang mengandung kata berbahasa Indonesia tanpa memblokir kata Inggris valid.
    """
    default_tags = "#SmartphoneReview #TechShorts #GadgetReview #PhoneReview #Shorts" if lang == "en" else "#ReviewHP #GadgetIndonesia #Smartphone #Shorts"

    indo_substrings = ("indonesia", "indonesian", "reviewhp", "unboxinghp", "reviewjujur")
    indo_tokens = {
        "hp", "ponsel", "rekomendasi", "pilihan", "harga", "murah", "mahal",
        "terbaik", "terbaru", "spek", "layak", "gadgetindonesia", "smartphoneindonesia"
    }

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
        if lang == "en":
            if any(sub in low for sub in indo_substrings):
                continue
            sub_words = [w.lower() for w in re.findall(r"[A-Z]?[a-z0-9]+|[A-Z]+(?=[A-Z]|$)", clean_tok)]
            if any(w in indo_tokens for w in sub_words):
                continue
        if low not in seen:
            seen.add(low)
            formatted.append(f"#{clean_tok}")

    return " ".join(formatted) if formatted else default_tags

def sanitize_english_caption(caption, video_title=""):
    """
    Membersihkan caption untuk video bahasa Inggris:
    - Hapus kata 'Indonesia' / 'Indonesian' beserta preposisi pendahulu (in/di/from/for Indonesia)
    - Bersihkan sisa tanda baca menggantung & buat fallback bersih jika terlalu pendek
    """
    if not caption:
        return caption
    cleaned = re.sub(r"\b(?:di|untuk|in|from|for|of)?\s*indonesia(?:n)?\b", "", caption, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+([,.;!?])", r"\1", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip().strip(",.:-").strip()
    if len(cleaned.split()) < 3:
        short_title = re.sub(r"[^a-zA-Z0-9\s\-]", " ", video_title).strip()[:50] or "Flagship Phone"
        cleaned = f"Full Review of {short_title}!"
    return cleaned


def save_matching_txt(video_file_path, caption_text, hashtags_text="", lang="id"):
    base_no_ext = os.path.splitext(video_file_path)[0]
    txt_path = f"{base_no_ext}.txt"
    clean_cap = str(caption_text or "").strip()
    # Bersihkan kata Indonesia dari caption & hashtag saat mode EN
    if lang == "en":
        clean_cap = sanitize_english_caption(clean_cap, video_title=os.path.basename(video_file_path))
    clean_tags = normalize_hashtags(hashtags_text, lang=lang)
    content = f"{clean_cap}\n\n{clean_tags}" if clean_tags else clean_cap
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content + "\n")
    return txt_path

THUMBNAIL_FONT_URLS = {
    "Anton-Regular.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
    "Bangers-Regular.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/bangers/Bangers-Regular.ttf",
    "Poppins-Bold.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf",
}

def ensure_thumbnail_fonts(work_dir=None):
    """Memastikan font YouTube Shorts (Anton, Bangers, Poppins Bold) tersedia di folder fonts/ (path absolut)."""
    base_dir = os.path.abspath(work_dir or os.path.dirname(os.path.abspath(__file__)))
    fonts_dir = os.path.abspath(os.path.join(base_dir, "fonts"))
    os.makedirs(fonts_dir, exist_ok=True)
    for fname, url in THUMBNAIL_FONT_URLS.items():
        fpath = os.path.join(fonts_dir, fname)
        if os.path.exists(fpath) and os.path.getsize(fpath) > 20000:
            continue
        try:
            resp = requests.get(url, timeout=15)
            if resp.status_code == 200 and len(resp.content) > 20000:
                with open(fpath, "wb") as f:
                    f.write(resp.content)
        except Exception:
            pass
    return fonts_dir

# Preset gaya thumbnail Shorts dinamis (terinspirasi creator tech review modern:
# foto full-bleed terang tanpa bingkai kaku, hook 2-warna miring di atas,
# pita/blok merah tegas + nama HP rapi, dan verdict kuning mencolok di bawahnya).
THUMBNAIL_STYLES = [
    {
        "name": "comic_snug_yellow_white",
        "top_font": "Bangers",
        "bot_font": "Bangers",
        "tilt_deg": 4.2,
        "ribbon_tilt": 0.0,
        "ribbon_full": False,
        "red_bgr": (24, 16, 234),
        "color_order": "yellow_white",
        "top_y_center": 270,
        "rib_cy": 1545,
    },
    {
        "name": "bold_full_ribbon_slant",
        "top_font": "Anton",
        "bot_font": "Anton",
        "tilt_deg": 4.8,
        "ribbon_tilt": 2.5,
        "ribbon_full": True,
        "red_bgr": (22, 12, 232),
        "color_order": "yellow_white",
        "top_y_center": 260,
        "rib_cy": 1535,
    },
    {
        "name": "right_slant_snug_box",
        "top_font": "Anton",
        "bot_font": "Bangers",
        "tilt_deg": 3.8,
        "ribbon_tilt": 1.8,
        "ribbon_full": False,
        "red_bgr": (20, 15, 224),
        "color_order": "white_yellow",
        "top_y_center": 268,
        "rib_cy": 1540,
    },
    {
        "name": "comic_ribbon_right_tilt",
        "top_font": "Bangers",
        "bot_font": "Anton",
        "tilt_deg": 4.5,
        "ribbon_tilt": 2.2,
        "ribbon_full": True,
        "red_bgr": (28, 12, 236),
        "color_order": "yellow_white",
        "top_y_center": 265,
        "rib_cy": 1535,
    },
    {
        "name": "angled_comic_white_first",
        "top_font": "Bangers",
        "bot_font": "Bangers",
        "tilt_deg": 3.6,
        "ribbon_tilt": 1.5,
        "ribbon_full": False,
        "red_bgr": (20, 10, 228),
        "color_order": "white_yellow",
        "top_y_center": 268,
        "rib_cy": 1545,
    },
]

_PHONE_TOKEN_CASE_MAP = {
    "iphone": "iPhone", "ipad": "iPad", "iqoo": "iQOO", "vivo": "vivo", "oppo": "OPPO",
    "rog": "ROG", "gt": "GT", "fe": "FE", "se": "SE", "5g": "5G", "4g": "4G",
    "xl": "XL", "ai": "AI", "nfc": "NFC", "os": "OS", "pro": "Pro", "max": "Max",
    "ultra": "Ultra", "plus": "Plus", "lite": "Lite", "neo": "Neo", "mini": "Mini",
    "note": "Note", "fold": "Fold", "flip": "Flip", "edge": "Edge", "play": "Play",
    "power": "Power", "turbo": "Turbo", "prime": "Prime", "air": "Air",
    "redmi": "Redmi", "poco": "Poco", "nubia": "Nubia", "samsung": "Samsung",
    "galaxy": "Galaxy", "xiaomi": "Xiaomi", "realme": "realme", "infinix": "Infinix",
    "tecno": "Tecno", "itel": "itel", "honor": "HONOR", "asus": "ASUS", "zenfone": "Zenfone",
    "huawei": "HUAWEI", "motorola": "Motorola", "moto": "Moto", "nothing": "Nothing",
    "google": "Google", "pixel": "Pixel", "oneplus": "OnePlus", "sony": "Sony", "xperia": "Xperia",
}

def format_pretty_phone_name(raw_name):
    """Memformat nama HP menjadi mixed-case rapi untuk pita merah thumbnail (mis. 'Nubia Neo 5 GT', 'Redmi A7 Pro', 'Poco X8')."""
    tokens = [t for t in re.sub(r"[^\w\s\+]", " ", str(raw_name or "")).split() if t]
    out = []
    for tok in tokens[:4]:
        low = tok.lower()
        if low in _PHONE_TOKEN_CASE_MAP:
            out.append(_PHONE_TOKEN_CASE_MAP[low])
        elif re.match(r"^[a-z]?\d+[a-z]*$", low) or len(low) <= 2:
            out.append(tok.upper())
        else:
            out.append(tok[:1].upper() + tok[1:].lower())
    return " ".join(out)

def extract_pretty_phone_name(video_title, plan=None):
    """Mengambil nama model HP mixed-case yang rapi dari plan JSON maupun judul video sumber."""
    if isinstance(plan, dict):
        cand = sanitize_subtitle_text(plan.get("thumbnail_phone", ""))
        cand = re.sub(r"\b(indonesia|resmi|review|unboxing|harga|spek)\b", "", cand, flags=re.I).strip()
        cand_words = [w for w in cand.split() if w]
        if 1 <= len(cand_words) <= 4 and 3 <= len(cand) <= 24:
            return format_pretty_phone_name(cand)
    return format_pretty_phone_name(extract_short_phone_name(video_title))

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
    "BANGET", "PARAH", "CUMA", "HANYA", "PALING", "SOLUSI", "PILIHAN", "REKOMENDASI",
    "JANGAN", "DULU", "KAH", "SERIUS", "SEBAGUS", "GILA", "NGERI", "RAJA", "INDONESIA", "INDONESIAN", "RUPIAH"
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

_PLAN_SPEC_KEYS = tuple(
    [c["id"] for c in SCENE_CATALOG if c["id"] != "cta"]
    + ["body_ip", "screen_os", "perf_mem", "bat_feat", "camera"]
)

def extract_english_specs_from_plan(plan):
    """Mengekstrak 3 poin spesifikasi teknis Bahasa Inggris langsung dari naskah VO bahasa Inggris jika perlu."""
    joined_en = " ".join(
        str(plan.get(k, {}).get("script", ""))
        for k in _PLAN_SPEC_KEYS
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

def split_hook_lines(hook_str):
    """Memecah teks hook atas menjadi 1 baris super besar (jika singkat <= 10 huruf) atau 2 baris seimbang."""
    words = [w for w in str(hook_str or "").strip().split() if w]
    if not words:
        return ["WORTH IT?!"]
    words = words[:5]
    joined = " ".join(words)
    if len(words) <= 2 and len(joined) <= 11:
        return [joined]
    best_idx = 1
    best_diff = 10**9
    for idx in range(1, len(words)):
        l1 = " ".join(words[:idx])
        l2 = " ".join(words[idx:])
        diff = abs(len(l1) - len(l2) * 1.05) + (3 if len(l2) <= 2 else 0)
        if diff < best_diff:
            best_diff = diff
            best_idx = idx
    return [" ".join(words[:best_idx]), " ".join(words[best_idx:])]


def extract_english_verdict_from_plan(plan, rng=None):
    """Mengekstrak 1 verdict thumbnail super singkat & spesifik dari spek nyata HP pada plan (mis. '144HZ BEAST!', '8050MAH MONSTER!')."""
    if not isinstance(plan, dict):
        return ""
    joined = " ".join(
        str(plan.get(k, {}).get("script", ""))
        for k in _PLAN_SPEC_KEYS
        if isinstance(plan.get(k), dict)
    )
    options = []
    hz_m = re.search(r"\b(120|144|165)\s*(?:hz|hertz)\b", joined, re.I)
    if hz_m:
        options.append(f"{hz_m.group(1)}HZ BEAST!")
    bat_m = re.search(r"\b([5-9]\d00|\d{4,5})\s*mah\b", joined, re.I)
    if bat_m:
        options.append(f"{bat_m.group(1)}MAH MONSTER!")
    watt_m = re.search(r"\b(\d{2,3})\s*(?:w|watt)\b", joined, re.I)
    if watt_m and int(watt_m.group(1)) >= 33:
        options.append(f"{watt_m.group(1)}W HYPER CHARGE!")
    ip_m = re.search(r"\b(ip6[45789])\b", joined, re.I)
    if ip_m:
        options.append(f"{ip_m.group(1).upper()} TANK PROOF!")
    mp_m = re.search(r"\b(50|64|108|200)\s*(?:mp|megapixel)\b", joined, re.I)
    if mp_m:
        options.append(f"{mp_m.group(1)}MP PRO CAM!")
    if not options:
        return ""
    return (rng or random).choice(options)


def ensure_dynamic_thumbnail_copy(plan, video_title, lang="id"):
    """
    Menyiapkan copywriting & style preset Thumbnail Shorts bergaya tech-review modern:
    - `top_lines`: 1-2 baris hook besar miring dua warna (tanpa mengulang nama HP)
    - `phone_name`: nama seri HP mixed-case bersih untuk pita/kotak merah (mis. 'Nubia Neo 5 GT')
    - `bottom_text`: verdict singkat mencolok di bawah pita merah (mis. '144HZ BEAST!')
    - `style`: salah satu preset THUMBNAIL_STYLES agar tiap video tampil variatif & tidak kaku.
    """
    phone_name = extract_pretty_phone_name(video_title, plan)
    rng = _video_rng(video_title + "_copy")

    id_hooks = [
        "JANGAN BELI DULU?!", "RAJA BARU?!", "WORTH IT KAH?!", "SERIUS SEBAGUS INI?!",
        "SPEKNYA NGERI!", "MASIH LAYAK?!", "SAINGI FLAGSHIP?!"
    ]
    en_hooks = [
        "DON'T BUY YET!?!", "WAIT BEFORE BUYING!", "HOW IS THIS LEGAL?!",
        "RIVALS IN TROUBLE!", "TOO GOOD TO BE TRUE?!", "FLAGSHIP IN DISGUISE?!",
        "THINK TWICE FIRST!", "SKIP OR GRAB?!", "BIGGEST SURPRISE?!",
        "SECRET WINNER?!", "RIP EXPENSIVE PHONES!", "STOP SCROLLING!",
        "UNREAL FOR THE PRICE!", "DON'T MISS THIS!", "GAME CHANGER?!",
        "THE NEW KING?!", "WORTH THE HYPE?!", "OVERPOWERED?!"
    ]
    en_hook_cliches = {"WORTH IT?!", "WORTH THE HYPE?!", "TOTAL BEAST!", "GAME CHANGER?!"}
    id_verdicts = [
        "REVIEW JUJUR!", "HP GAMING TERBAIK?!", "BEST BUDGET?!",
        "RAJA HARGA MIRING!", "WAJIB TAHU!", "TES JUJUR!"
    ]
    en_verdicts = [
        "WATCH BEFORE BUYING!", "8050MAH POWERHOUSE!", "ZERO COMPROMISE?!",
        "NO HYPE VERDICT!", "HANDS-ON TEST!", "BUILT LIKE A TANK!",
        "VALUE MONSTER!", "REAL TEST RESULTS!", "RIVAL CRUSHER!",
        "UNFILTERED VERDICT!", "BUDGET SHOCKER!", "MUST SEE SPECS!"
    ]
    en_verdict_cliches = {"HONEST REVIEW!", "BEST BUDGET PHONE?!", "REAL VERDICT!"}

    raw_hook = sanitize_subtitle_text(plan.get("thumbnail_hook") or plan.get("thumbnail_headline", "")).upper()
    raw_verdict = sanitize_subtitle_text(plan.get("thumbnail_verdict") or plan.get("thumbnail_badge", "")).upper()

    phone_tokens = {re.sub(r"[^A-Z0-9]", "", t) for t in phone_name.upper().split() if t}
    phone_tokens |= {"SAMSUNG", "GALAXY", "IPHONE", "XIAOMI", "REDMI", "POCO", "OPPO", "VIVO", "IQOO", "REALME", "INFINIX", "TECNO", "NUBIA", "GOOGLE", "PIXEL", "ONEPLUS", "HONOR"}

    def _strip_phone_tokens(txt_up):
        kept = []
        for tok in txt_up.split():
            bare = re.sub(r"[^A-Z0-9]", "", tok)
            if bare and bare in phone_tokens:
                continue
            kept.append(tok)
        return " ".join(kept).strip()

    raw_hook = _strip_phone_tokens(raw_hook)

    if lang == "en":
        raw_hook = translate_or_clean_english_thumb_text(raw_hook)
        raw_hook = _strip_phone_tokens(raw_hook)
        if not raw_hook or has_indonesian_words(raw_hook) or len(raw_hook) < 5:
            hook_str = rng.choice(en_hooks)
        else:
            hook_str = " ".join(raw_hook.split()[:4])
            if hook_str[-1] not in "!?":
                hook_str += "?!"
            if hook_str in en_hook_cliches and rng.random() < 0.70:
                hook_str = rng.choice([h for h in en_hooks if h not in en_hook_cliches])

        raw_verdict = translate_or_clean_english_thumb_text(raw_verdict)
        spec_verdict = extract_english_verdict_from_plan(plan, rng=rng)
        if not raw_verdict or has_indonesian_words(raw_verdict) or len(raw_verdict) < 5:
            verdict_str = spec_verdict if (spec_verdict and rng.random() < 0.65) else rng.choice(en_verdicts)
        else:
            verdict_str = " ".join(raw_verdict.split()[:3])
            if verdict_str[-1] not in "!?":
                verdict_str += "!"
            if verdict_str in en_verdict_cliches and rng.random() < 0.75:
                verdict_str = spec_verdict if spec_verdict else rng.choice(en_verdicts)
    else:
        if not raw_hook or len(raw_hook) < 5:
            hook_str = rng.choice(id_hooks)
        else:
            hook_str = " ".join(raw_hook.split()[:4])
            if hook_str[-1] not in "!?":
                hook_str += "?!"

        if not raw_verdict or len(raw_verdict) < 5:
            verdict_str = rng.choice(id_verdicts)
        else:
            verdict_str = " ".join(raw_verdict.split()[:3])
            if verdict_str[-1] not in "!?":
                verdict_str += "!"

    top_lines = split_hook_lines(hook_str)
    style = rng.choice(THUMBNAIL_STYLES)
    return {
        "top_lines": top_lines,
        "phone_name": phone_name[:22],
        "bottom_text": verdict_str[:24],
        "style": style,
        "badge": verdict_str[:24],
        "line1": phone_name[:22],
        "line2": " ".join(top_lines),
    }


def _crop_9_16_centered(frame, cx_norm=0.5):
    """Memotong frame menjadi rasio 9:16 (1080x1920) yang berpusat pada posisi horizontal cx_norm."""
    fh, fw = frame.shape[:2]
    if fw == 1080 and fh == 1920:
        return frame
    target_ratio = 9.0 / 16.0
    if (fw / max(float(fh), 1.0)) > (target_ratio * 1.04):
        crop_w = max(1, int(round(fh * target_ratio)))
        cx_px = int(round(max(0.0, min(1.0, float(cx_norm))) * fw))
        x0 = max(0, min(fw - crop_w, cx_px - crop_w // 2))
        cropped = frame[0:fh, x0:x0 + crop_w]
    elif (fw / max(float(fh), 1.0)) < (target_ratio * 0.96):
        crop_h = max(1, int(round(fw / target_ratio)))
        y0 = max(0, (fh - crop_h) // 2)
        cropped = frame[y0:y0 + crop_h, 0:fw]
    else:
        cropped = frame
    return cv2.resize(cropped, (1080, 1920), interpolation=cv2.INTER_LANCZOS4)


def _frame_is_clean_for_thumb(frame_9_16, detector):
    """Menolak frame gelap, mengandung wajah, animasi subscribe, atau perbandingan 2+ handphone."""
    sm = cv2.resize(frame_9_16, (270, 480), interpolation=cv2.INTER_AREA)
    gray_sm = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY)
    if float(np.mean(gray_sm)) < 36.0:
        return False
    if detector is not None:
        _, faces = detector.detect(sm)
        if faces is not None and len(faces) > 0:
            return False
    if has_animated_subscribe_badge([sm]):
        return False
    if has_side_by_side_dual_phones([sm]):
        return False
    return True


def _estimate_vertical_phone_score(frame):
    """
    Memperkirakan seberapa vertikal dan utuh HP yang terlihat di frame menggunakan
    analisis kontur dan aspek rasio objek dominan di tengah frame.
    Skor lebih tinggi = HP lebih cenderung terlihat vertikal & utuh.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    roi = gray[int(h * 0.08):int(h * 0.78), int(w * 0.10):int(w * 0.90)]
    blurred = cv2.GaussianBlur(roi, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 120)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0.0
    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)
    roi_area = roi.shape[0] * roi.shape[1]
    if roi_area == 0 or area < (roi_area * 0.03):
        return 0.0
    _, _, bw, bh = cv2.boundingRect(largest)
    if bw == 0:
        return 0.0
    aspect_ratio = bh / float(bw)
    if aspect_ratio >= 1.8:
        vert_score = 1.0
    elif aspect_ratio >= 1.5:
        vert_score = 0.75
    elif aspect_ratio >= 1.0:
        vert_score = 0.30
    else:
        vert_score = 0.05
    fill_score = min(1.0, (area / roi_area) * 2.5)
    return (vert_score * 0.7 + fill_score * 0.3)


def _heuristic_back_phone_score(frame_9_16, priority_weight=1.0):
    """Skor fallback lokal bila Vision API gagal: memprioritaskan belakang HP vertikal (modul kamera atas kontras, panel bawah bersih) & menekan layar UI teks/popup."""
    sm = cv2.resize(frame_9_16, (270, 480), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY)
    roi = gray[70:380, 35:235]
    up_panel = gray[100:220, 60:210]
    lo_panel = gray[225:360, 60:210]

    mean_bri = float(np.mean(roi))
    e_up = float(np.mean(cv2.Canny(up_panel, 50, 140) > 0))
    e_lo = float(np.mean(cv2.Canny(lo_panel, 50, 140) > 0))
    white_lo = float(np.mean(lo_panel > 205))
    sharpness = min(900.0, float(cv2.Laplacian(roi, cv2.CV_64F).var()))

    # Layar depan/UI teks memiliki panel bawah ber-tepi padat (e_lo >= 0.085) & area popup/latar terang tinggi
    if white_lo > 0.18 or (e_lo > 0.085 and (e_up / max(e_lo, 0.02)) < 1.25):
        ui_penalty = 0.08
    elif e_lo > 0.075:
        ui_penalty = 0.40
    else:
        ui_penalty = 1.0

    # Bonus belakang HP nyata: modul kamera di atas (e_up) lebih menonjol dibanding panel bawah yang bersih
    cam_ratio = min(2.2, e_up / max(e_lo, 0.025))
    cam_bonus = 1.35 if (cam_ratio >= 1.35 and white_lo < 0.08) else (0.75 if cam_ratio < 0.95 else 1.0)
    bri_factor = 1.25 if (65.0 <= mean_bri <= 185.0) else 0.55
    vert_score = _estimate_vertical_phone_score(sm)
    return ((sharpness * 0.30) + (vert_score * 850.0)) * bri_factor * ui_penalty * cam_bonus * priority_weight


def _compute_frame_hist(frame_bgr):
    """Histogram HSV ringan untuk deduplikasi kandidat visual agar variasi maksimal."""
    sm = cv2.resize(frame_bgr, (64, 114), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [12, 8], [0, 180, 0, 256])
    cv2.normalize(hist, hist, alpha=1.0, norm_type=cv2.NORM_L2)
    return hist


def _fit_tile_letterbox(frame_bgr, tile_size=220):
    """Memuat frame 16:9 atau 9:16 ke kotak seragam tanpa memotong sisi kiri/kanan subjek."""
    fh, fw = frame_bgr.shape[:2]
    scale = min(tile_size / max(float(fw), 1.0), tile_size / max(float(fh), 1.0))
    nw = max(1, int(round(fw * scale)))
    nh = max(1, int(round(fh * scale)))
    resized = cv2.resize(frame_bgr, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((tile_size, tile_size, 3), dtype=np.uint8)
    x0 = (tile_size - nw) // 2
    y0 = (tile_size - nh) // 2
    canvas[y0:y0 + nh, x0:x0 + nw] = resized
    return canvas, x0, y0, nw, nh


def _build_numbered_contact_sheet(tiles_bgr, cols, tile_w, tile_h, quality=82):
    """Menyusun grid gambar bernomor jelas menjadi satu JPEG base64 untuk panggilan Gemini Vision."""
    rows = max(1, math.ceil(len(tiles_bgr) / cols))
    sheet = np.zeros((rows * tile_h, cols * tile_w, 3), dtype=np.uint8)
    for idx, tile in enumerate(tiles_bgr):
        r, c = divmod(idx, cols)
        cell = cv2.resize(tile, (tile_w, tile_h), interpolation=cv2.INTER_AREA) if (tile.shape[1] != tile_w or tile.shape[0] != tile_h) else tile.copy()
        y0, x0 = r * tile_h, c * tile_w
        sheet[y0:y0 + tile_h, x0:x0 + tile_w] = cell
        label = str(idx + 1)
        cv2.rectangle(sheet, (x0 + 4, y0 + 4), (x0 + 18 + 18 * len(label), y0 + 38), (0, 0, 0), -1)
        cv2.putText(sheet, label, (x0 + 10, y0 + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 235, 255), 2, cv2.LINE_AA)
    _, buf = cv2.imencode(".jpg", sheet, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def _gather_source_sample_timestamps(face_free_segs, chapters_with_scenes, total_dur, max_samples=68):
    """Menentukan timestamp terprioritas bebas-wajah dari source_video.mp4 (utama di body_ip & paruh awal review)."""
    if total_dur <= 0 or not face_free_segs:
        return []
    safe_min = max(22.0, total_dur * 0.025) if total_dur > 90 else 6.0
    safe_max = max(safe_min + 10.0, total_dur - 14.0)

    body_win, cam_win = (0.0, 0.0), (0.0, 0.0)
    for ch in (chapters_with_scenes or []):
        cid = ch.get("id", "")
        if cid in ("body", "body_ip", "fitur_unik", "cta"):
            body_win = (float(ch.get("start_sec", 0.0)), float(ch.get("end_sec", 0.0)))
        elif cid in ("kamera", "camera"):
            cam_win = (float(ch.get("start_sec", 0.0)), float(ch.get("end_sec", 0.0)))

    samples = []
    for seg_s, seg_e in face_free_segs:
        s0 = max(safe_min, float(seg_s) + (0.12 if (seg_e - seg_s) > 0.6 else 0.0))
        e0 = min(safe_max, float(seg_e) - (0.12 if (seg_e - seg_s) > 0.6 else 0.0))
        if e0 <= s0:
            continue
        in_body = (body_win[1] > body_win[0] and not (e0 < body_win[0] or s0 > body_win[1]))
        in_cam = (cam_win[1] > cam_win[0] and not (e0 < cam_win[0] or s0 > cam_win[1]))
        is_early = s0 < (total_dur * 0.55)
        step = 1.6 if in_body else (2.4 if is_early else 4.2)
        prio = 1.45 if in_body else (1.20 if (is_early or in_cam) else 1.0)
        t = s0 + 0.15
        while t < e0:
            samples.append((round(t, 2), prio))
            t += step

    samples.sort(key=lambda x: (-x[1], x[0]))
    if len(samples) > max_samples:
        # Pertahankan seluruh sampel prioritas tertinggi, lalu sebar sisanya merata
        picked = []
        step_pick = max(1, len(samples) // max_samples)
        for i, item in enumerate(samples):
            if i < 28 or (i % step_pick == 0):
                picked.append(item)
            if len(picked) >= max_samples:
                break
        samples = picked
    # Urutkan tetap memprioritaskan segmen prio tinggi (body_ip/hands-on) agar tidak terpotong batas 28 kandidat
    samples.sort(key=lambda x: (-x[1], x[0]))
    return samples


def _vision_pass1_discover_back_phones(pool_items, api_key):
    """Pass 1: mengirim 1 grid contact sheet seluruh video ke Gemini Vision untuk mencari tampak belakang 1 HP tunggal terbaik."""
    if not pool_items:
        return []
    tiles = [it["tile"] for it in pool_items]
    b64_sheet = _build_numbered_contact_sheet(tiles, cols=6, tile_w=220, tile_h=220, quality=80)
    prompt = (
        f"Look at this numbered contact sheet of {len(pool_items)} video frames from a smartphone review.\n"
        "Select UP TO 5 frame numbers showing the CLEANEST, FULLEST, UNOBSTRUCTED **BACK SIDE** of ONLY ONE (1) SINGLE SMARTPHONE "
        "(rear camera bump/lenses & rear panel clearly visible, preferably held upright/vertically in hand or studio table).\n"
        "CRITICAL ZERO-TOLERANCE RULE:\n"
        "- STRICTLY REJECT ANY frame showing 2 OR MORE smartphones in the same image (side-by-side comparison shots, stacked phones, another phone in the other hand, or a second phone visible anywhere in the background/foreground edge)! ONLY pick frames with phone_count == 1.\n"
        "ALSO STRICTLY AVOID:\n"
        "- Front screens showing UI/apps/home screen/benchmarks\n"
        "- Frames showing only a retail box or heavy cardboard clutter\n"
        "- Frames with human faces, big overlaid channel logos, or 'SUBSCRIBE' banners\n"
        "- Extreme cropped close-ups where most of the phone body is cut off.\n\n"
        "Return ONLY valid JSON: "
        '{"picks": [{"id": <int 1..N>, "phone_count": 1, "cx": <int 0..1000 horizontal center of the SINGLE phone inside that numbered tile>, "upright": <true|false>}]}.'
    )
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": b64_sheet}}
            ]
        }],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
    }
    parsed = call_gemini_json(payload, api_key)
    if not isinstance(parsed, dict) or not parsed.get("picks"):
        return []
    valid = []
    for p in parsed["picks"]:
        try:
            idx = int(p["id"]) - 1
            if int(p.get("phone_count", 1)) != 1:
                continue
            if 0 <= idx < len(pool_items):
                cx_tile = max(0.0, min(1.0, float(p.get("cx", 500)) / 1000.0))
                it = pool_items[idx]
                tw = 220.0
                # Konversi koordinat cx tile 220x220 (yang ber-letterbox) ke koordinat X sumber (0..1)
                cx_px = cx_tile * tw
                src_cx = max(0.22, min(0.78, (cx_px - it["x0"]) / max(1.0, float(it["disp_w"]))))
                valid.append((idx, src_cx, bool(p.get("upright", True))))
        except Exception:
            continue
    return valid[:5]


def _vision_pass2_pick_best_portrait(portrait_candidates, api_key):
    """Pass 2: memverifikasi top-9 crop 9:16 portrait resolusi tajam untuk memilih 1 HP tunggal tampak belakang paling bersih."""
    if not portrait_candidates:
        return None
    n = len(portrait_candidates)
    tiles = [cv2.resize(frm, (240, 426), interpolation=cv2.INTER_AREA) for frm in portrait_candidates]
    b64_sheet = _build_numbered_contact_sheet(tiles, cols=3, tile_w=240, tile_h=426, quality=86)
    prompt = (
        f"These {n} vertical 9:16 portrait frames come from candidate back-of-phone moments.\n"
        "Inspect EVERY numbered tile carefully and reject ANY tile that contains 2 or more phones (even a partial second phone peeking in from left/right/bottom edge!).\n"
        "Among tiles containing STRICTLY ONE (1) SINGLE PHONE ONLY, pick the SINGLE BEST photo for a YouTube Shorts thumbnail that shows:\n"
        "1) EXACTLY ONE smartphone alone in the entire 9:16 frame (NEVER side-by-side comparison, NEVER a second phone anywhere in frame!)\n"
        "2) The crisp FULL BACK SIDE of that single phone vertically/upright with camera lenses on top (NEVER the front screen)\n"
        "3) Clean uncluttered top background above the phone (~top 25% of frame) so big hook text sits cleanly above the camera bump\n"
        "4) No face, no ugly subscribe popup, crisp focus and good lighting.\n\n"
        "If NO tile satisfies strictly-single-phone + clean back-of-phone, set \"best\": 0!\n"
        "Also measure the single phone body vertical span inside the chosen frame in 0..1000 scale (0=very top edge, 1000=very bottom edge).\n"
        'Return ONLY JSON: {"best": <int 0..N>, "rejected_multi_phone_ids": [<int>], "phone_top_y": <int 150..500>, "phone_bot_y": <int 600..920>}.'
    )
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": b64_sheet}}
            ]
        }],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
    }
    parsed = call_gemini_json(payload, api_key)
    if not isinstance(parsed, dict) or "best" not in parsed:
        return None
    try:
        raw_best = int(parsed["best"])
        rejected_set = {
            int(x) - 1
            for x in (parsed.get("rejected_multi_phone_ids") or [])
            if str(x).isdigit() and 1 <= int(x) <= n
        }
        if raw_best == 0:
            return -1, 0.25, 0.78, rejected_set
        best_idx = raw_best - 1
        if 0 <= best_idx < n and best_idx not in rejected_set:
            top_y = max(0.14, min(0.45, float(parsed.get("phone_top_y", 260)) / 1000.0))
            bot_y = max(0.62, min(0.90, float(parsed.get("phone_bot_y", 780)) / 1000.0))
            return best_idx, top_y, bot_y, rejected_set
        return -1, 0.25, 0.78, rejected_set
    except Exception:
        pass
    return None


def select_best_thumbnail_frame(all_final_clips, video_path=None, face_free_segs=None,
                                chapters_with_scenes=None, total_dur=0.0,
                                detector=None, api_key=None):
    """
    Memilih frame 1080x1920 terbaik yang menampilkan SATU (1) BAGIAN BELAKANG HP secara VERTIKAL & UTUH (anti-perbandingan 2 HP):
    1. Menyapu klip final terverifikasi Vision (`all_final_clips`) DAN momen bebas wajah di video sumber (`source_video.mp4`),
       tersaring dari wajah, animasi subscribe, dan perbandingan 2+ HP berdampingan.
    2. Pass 1 Gemini Vision (6x6 whole-video sheet): menemukan momen 1 HP tunggal terbaik (menolak 2+ HP perbandingan).
    3. Pass 2 Gemini Vision (3x3 crop 9:16 HD): memverifikasi ulang phone_count == 1 di crop final + koordinat Y atas/bawah HP,
       dengan 1 putaran rescue otomatis jika putaran pertama tertolak (mis. 2 HP terdeteksi pasca-crop).
    4. Fallback lokal: memprioritaskan klip B-roll tunggal terverifikasi daripada segmen sumber mentah.
    Returns: (frame_1080x1920, phone_top_y_norm, phone_bot_y_norm)
    """
    raw_pool = []  # item: {kind, path, t_sec, prio, tile, x0, y0, disp_w, disp_h, hist, preview_916, score}

    def _try_add_candidate(raw_frame, kind, path, t_sec, prio):
        preview_916 = _crop_9_16_centered(raw_frame, cx_norm=0.5)
        if not _frame_is_clean_for_thumb(preview_916, detector):
            return
        hist = _compute_frame_hist(raw_frame)
        for existing in raw_pool:
            if cv2.compareHist(hist, existing["hist"], cv2.HISTCMP_CORREL) > 0.90:
                return
        tile, x0, y0, dw, dh = _fit_tile_letterbox(raw_frame, tile_size=220)
        sc = _heuristic_back_phone_score(preview_916, prio)
        raw_pool.append({
            "kind": kind, "path": path, "t_sec": t_sec, "prio": prio,
            "tile": tile, "x0": x0, "y0": y0, "disp_w": dw, "disp_h": dh,
            "hist": hist, "preview_916": preview_916, "score": sc
        })

    # 1. Sampel dari klip akhir terverifikasi Vision dulu (dijamin 1 HP tunggal bebas perbandingan!) lalu video sumber
    for idx, clip_path in enumerate(all_final_clips or []):
        if not os.path.exists(clip_path):
            continue
        cap = cv2.VideoCapture(clip_path)
        n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if n_frames > 0:
            for frac in (0.30, 0.72):
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(n_frames * frac)))
                ret, frm = cap.read()
                if ret and frm is not None:
                    _try_add_candidate(frm, "clip", clip_path, frac, 1.35 if idx < 5 else 1.15)
        cap.release()
        if len(raw_pool) >= 16:
            break

    if video_path and os.path.exists(video_path):
        cap_src = cv2.VideoCapture(video_path)
        if total_dur <= 0:
            fps_src = cap_src.get(cv2.CAP_PROP_FPS) or 30.0
            total_dur = (cap_src.get(cv2.CAP_PROP_FRAME_COUNT) / fps_src) if fps_src > 0 else 0.0
        timestamps = _gather_source_sample_timestamps(face_free_segs, chapters_with_scenes, total_dur)
        if not timestamps and total_dur > 40:
            step_fb = max(6.0, (total_dur - 40.0) / 36.0)
            t = 22.0
            while t < total_dur - 15.0:
                timestamps.append((round(t, 2), 1.0))
                t += step_fb
        for t_sec, prio in timestamps:
            cap_src.set(cv2.CAP_PROP_POS_MSEC, t_sec * 1000.0)
            ret, frm = cap_src.read()
            if ret and frm is not None:
                _try_add_candidate(frm, "source", video_path, t_sec, prio)
            if len(raw_pool) >= 48:
                break
        cap_src.release()

    if not raw_pool:
        if all_final_clips and os.path.exists(all_final_clips[0]):
            cap = cv2.VideoCapture(all_final_clips[0])
            ret, fr = cap.read()
            cap.release()
            if ret and fr is not None:
                return _crop_9_16_centered(fr), 0.25, 0.78
        return None, 0.25, 0.78

    def _collect_portraits(sub_pool, picks):
        cands = []
        cand_hists = []
        cap_src = cv2.VideoCapture(video_path) if (video_path and os.path.exists(video_path)) else None
        any_upright = any(upr for _, _, upr in picks)
        for pool_idx, cx_norm, upright in picks:
            it = sub_pool[pool_idx]
            if it["kind"] == "source" and cap_src is not None:
                for dt in (-1.2, -0.5, 0.0, 0.5, 1.2):
                    t_q = max(1.0, it["t_sec"] + dt)
                    cap_src.set(cv2.CAP_PROP_POS_MSEC, t_q * 1000.0)
                    ret, raw = cap_src.read()
                    if not ret or raw is None:
                        continue
                    cropped = _crop_9_16_centered(raw, cx_norm=cx_norm)
                    if not _frame_is_clean_for_thumb(cropped, detector):
                        continue
                    h_c = _compute_frame_hist(cropped)
                    if any(cv2.compareHist(h_c, ex, cv2.HISTCMP_CORREL) > 0.96 for ex in cand_hists):
                        continue
                    cands.append(cropped)
                    cand_hists.append(h_c)
                    if (not any_upright) and len(cands) < 8:
                        rot90 = cv2.rotate(raw, cv2.ROTATE_90_CLOCKWISE)
                        rot_crop = _crop_9_16_centered(rot90, cx_norm=0.5)
                        if _frame_is_clean_for_thumb(rot_crop, detector):
                            cands.append(rot_crop)
                            cand_hists.append(_compute_frame_hist(rot_crop))
                    if len(cands) >= 9:
                        break
            else:
                cap_c = cv2.VideoCapture(it["path"])
                nf = int(cap_c.get(cv2.CAP_PROP_FRAME_COUNT))
                if nf > 0:
                    for f_frac in (0.25, 0.50, 0.78):
                        cap_c.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(nf * f_frac)))
                        ret, raw = cap_c.read()
                        if ret and raw is not None:
                            cropped = _crop_9_16_centered(raw, cx_norm=cx_norm)
                            if _frame_is_clean_for_thumb(cropped, detector):
                                cands.append(cropped)
                                if len(cands) >= 9:
                                    break
                cap_c.release()
            if len(cands) >= 9:
                break
        if cap_src is not None:
            cap_src.release()
        return cands

    # 3. Gemini Vision 2-Pass Selection (+ 1 rescue round jika putaran 1 ditolak karena 2+ HP / layar depan)
    pass1_pool = raw_pool[:36]
    if api_key:
        rejected_pool_idxs = set()
        for attempt_round in range(2):
            active_idxs = [i for i in range(len(raw_pool)) if i not in rejected_pool_idxs][:36]
            if not active_idxs:
                break
            sub_pool = [raw_pool[i] for i in active_idxs]
            picks = _vision_pass1_discover_back_phones(sub_pool, api_key)
            if not picks:
                break
            print(f"      [Thumbnail] Pass 1 (putaran {attempt_round + 1}) menemukan {len(picks)} zona kandidat 1-HP belakang dari {len(sub_pool)} adegan unik.", flush=True)
            portrait_cands = _collect_portraits(sub_pool, picks)
            if not portrait_cands:
                rejected_pool_idxs.update(active_idxs[p[0]] for p in picks)
                continue
            res_p2 = _vision_pass2_pick_best_portrait(portrait_cands[:9], api_key)
            if res_p2 is not None:
                b_idx, top_y, bot_y, rejected_local = res_p2
                if 0 <= b_idx < len(portrait_cands):
                    print(f"      [Thumbnail] Pass 2 memilih portrait #{b_idx + 1} (span HP: {int(top_y*100)}%..{int(bot_y*100)}%).", flush=True)
                    return portrait_cands[b_idx], top_y, bot_y
                # Jika semua ditolak Pass 2 (mis. ada 2 HP terdeteksi pasca-crop), kecualikan zona ini dan coba putaran rescue
                print("      [!] Pass 2 menolak kandidat (terdeteksi 2+ HP / bukan belakang HP tunggal) -> Mencari zona alternatif...", flush=True)
                rejected_pool_idxs.update(active_idxs[p[0]] for p in picks)
                continue
            valid_cands = [c for ci, c in enumerate(portrait_cands[:9])]
            if valid_cands:
                best_cand = max(valid_cands, key=lambda c: _heuristic_back_phone_score(c, 1.0))
                return best_cand, 0.25, 0.78

    # 4. Fallback heuristik penuh tanpa AI (prioritaskan klip B-roll tunggal terverifikasi)
    verified_clips = [x for x in raw_pool if x["kind"] == "clip"]
    fallback_pool = verified_clips if verified_clips else pass1_pool
    best_item = max(fallback_pool, key=lambda x: x["score"])
    if best_item["kind"] == "source" and video_path and os.path.exists(video_path):
        cap_src = cv2.VideoCapture(video_path)
        cap_src.set(cv2.CAP_PROP_POS_MSEC, best_item["t_sec"] * 1000.0)
        ret, raw = cap_src.read()
        cap_src.release()
        if ret and raw is not None:
            cand_916 = _crop_9_16_centered(raw)
            if _frame_is_clean_for_thumb(cand_916, detector):
                return cand_916, 0.25, 0.78
    return best_item["preview_916"], 0.25, 0.78


def escape_ass_text(txt):
    return str(txt or "").replace("\\", "").replace("{", "(").replace("}", ")")


def _rotated_rect_points(cx, cy, width, height, angle_deg):
    """Menghitung sudut poligon persegi panjang terotasi (konvensi layar sebanding \\frz pada ASS)."""
    rad = math.radians(angle_deg)
    ca, sa = math.cos(rad), math.sin(rad)
    hw, hh = width / 2.0, height / 2.0
    corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    pts = []
    for x, y in corners:
        rx = x * ca + y * sa + cx
        ry = -x * sa + y * ca + cy
        pts.append([int(round(rx)), int(round(ry))])
    return np.array(pts, dtype=np.int32)


def _draw_red_ribbon(canvas, cx, cy, ribbon_w, ribbon_h, angle_deg, bg_bgr=(22, 12, 232), full_width=True):
    """Menggambar pita/kotak merah tegas dengan drop-shadow lembut di belakang nama HP."""
    w_span = 1360 if full_width else ribbon_w
    pts = _rotated_rect_points(cx, cy, w_span, ribbon_h, angle_deg)
    sh_pts = _rotated_rect_points(cx + 3, cy + 9, w_span, ribbon_h, angle_deg)
    sh_layer = canvas.copy()
    cv2.fillPoly(sh_layer, [sh_pts], (0, 0, 0), lineType=cv2.LINE_AA)
    canvas[:] = cv2.addWeighted(sh_layer, 0.35, canvas, 0.65, 0)
    cv2.fillPoly(canvas, [pts], bg_bgr, lineType=cv2.LINE_AA)


def _estimate_text_width_px(text, fontsize, font_name):
    if font_name == "Poppins":
        narrow = set("iIlj1!|.,:;' ")
        wide = set("WMGOQD@%")
        total = sum(0.18 if c in narrow else (0.48 if c in wide else 0.35) for c in text)
        return total * fontsize
    narrow = set("I1!|.,:;' ")
    wide = set("WMQORHGDB@%") if font_name == "Bangers" else set("WM@%")
    base_f = 0.26 if font_name == "Bangers" else 0.25
    wide_f = 0.34 if font_name == "Bangers" else 0.33
    total = sum(0.15 if c in narrow else (wide_f if c in wide else base_f) for c in text)
    return total * fontsize


def _fit_fontsize(text, target_width_px, font_name, min_fs=72, max_fs=400):
    base = 100.0
    w_at_100 = max(1.0, _estimate_text_width_px(text, base, font_name))
    fs = int(round(base * (target_width_px / w_at_100)))
    return max(min_fs, min(max_fs, fs))


def generate_dynamic_short_thumbnail(all_final_clips, plan, video_title, lang, out_thumb_path, out_dir,
                                     detector=None, api_key=None, work_dir=None, video_path=None,
                                     face_free_segs=None, chapters_with_scenes=None, total_dur=0.0):
    """
    Merender Thumbnail YouTube Shorts dinamis & non-monoton (1080x1920):
    - Memilih foto full-bleed terbaik bagian belakang HP secara vertikal via 2-Pass Vision + cache bebas wajah.
    - Tanpa vignette gelap, tanpa bingkai kaku/kotak sudut/blok spek penuh teks.
    - Tipografi dinamis Bangers / Anton / Poppins Bold: Hook atas 2 warna miring,
      pita/blok merah nama model HP rapi, dan verdict kuning mencolok di bawahnya.
    """
    fonts_dir = ensure_thumbnail_fonts(work_dir)
    base_frame, phone_top_y, phone_bot_y = select_best_thumbnail_frame(
        all_final_clips,
        video_path=video_path,
        face_free_segs=face_free_segs,
        chapters_with_scenes=chapters_with_scenes,
        total_dur=total_dur,
        detector=detector,
        api_key=api_key,
    )
    if base_frame is None:
        return None

    h, w = 1920, 1080
    if base_frame.shape[0] != h or base_frame.shape[1] != w:
        base_frame = cv2.resize(base_frame, (w, h), interpolation=cv2.INTER_LANCZOS4)

    meta = ensure_dynamic_thumbnail_copy(plan, video_title, lang=lang)
    st = meta["style"]

    # ── 1. Peningkatan ketajaman alami tanpa menggelapkan foto produk ───────
    blurred = cv2.GaussianBlur(base_frame, (0, 0), 1.8)
    canvas = cv2.addWeighted(base_frame, 1.14, blurred, -0.14, 3)

    # Penyesuaian dinamis posisi Y berdasarkan ruang kepala & posisi bawah HP
    top_y_center = st["top_y_center"]
    if phone_top_y < 0.21:
        top_y_center = min(top_y_center, 225)
    elif phone_top_y > 0.30:
        top_y_center = max(top_y_center, 280)

    rib_cy = max(1510, min(1570, int(round(phone_bot_y * h + 35)) if 0.72 <= phone_bot_y <= 0.82 else st["rib_cy"]))

    # ── 2. Pita / Blok Merah Nama Model HP (Diperbesar 1 tingkat) ───────────
    phone_name = meta["phone_name"]
    ribbon_full = st["ribbon_full"]
    target_rib_w = 780 if ribbon_full else 820
    phone_fs = _fit_fontsize(phone_name, target_rib_w, "Poppins", min_fs=115, max_fs=190)
    est_phone_w = int(_estimate_text_width_px(phone_name, phone_fs, "Poppins"))
    rib_w = min(1020, max(520, est_phone_w + 76))
    rib_h = int(phone_fs * 0.96)

    ribbon_tilt = st["ribbon_tilt"]
    _draw_red_ribbon(canvas, 540, rib_cy, rib_w, rib_h, ribbon_tilt, bg_bgr=st["red_bgr"], full_width=ribbon_full)

    # ── 3. Render Tipografi ASS + custom fontsdir via FFmpeg ────────────────
    os.makedirs(out_dir, exist_ok=True)
    temp_bg_jpg = os.path.abspath(os.path.join(out_dir, f"_thumb_bg_{lang}.jpg"))
    ass_name = f"_thumb_overlay_{lang}.ass"
    temp_ass = os.path.join(out_dir, ass_name)
    abs_out_thumb = os.path.abspath(out_thumb_path)
    cv2.imwrite(temp_bg_jpg, canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 96])

    top_font = st["top_font"]
    bot_font = st["bot_font"]
    tilt_deg = st["tilt_deg"]
    c1 = "&H0000E6FF&" if st["color_order"] == "yellow_white" else "&H00FFFFFF&"
    c2 = "&H00FFFFFF&" if st["color_order"] == "yellow_white" else "&H0000E6FF&"
    # Nilai negatif \fax pada ASS membuat huruf miring ke KANAN (italic forward slant '/')
    slant_tag = "\\fax-0.18" if top_font == "Anton" else "\\fax-0.12"

    top_lines = [escape_ass_text(x) for x in meta["top_lines"]]
    top_dialogues = []
    scale_cap = 0.90 if phone_top_y < 0.21 else 1.0
    if len(top_lines) >= 2:
        fs1 = int(_fit_fontsize(top_lines[0], 880, top_font, min_fs=170, max_fs=350) * scale_cap)
        fs2 = int(_fit_fontsize(top_lines[1], 850, top_font, min_fs=170, max_fs=360) * scale_cap)
        if fs2 > fs1 * 1.18:
            fs2 = int(fs1 * 1.14)
        gap = int((fs1 + fs2) * 0.30)
        y1 = max(int(fs1 * 0.42) + 36, top_y_center - gap // 2)
        y2 = y1 + gap
        top_dialogues.append(
            f"Dialogue: 3,0:00:00.00,0:00:05.00,HookTop,,0,0,0,,{{\\q2\\pos(540,{y1}){slant_tag}\\frz{tilt_deg:.1f}\\fs{fs1}\\bord24\\shad10\\1c{c1}}}{top_lines[0]}"
        )
        top_dialogues.append(
            f"Dialogue: 3,0:00:00.00,0:00:05.00,HookTop,,0,0,0,,{{\\q2\\pos(540,{y2}){slant_tag}\\frz{tilt_deg:.1f}\\fs{fs2}\\bord24\\shad10\\1c{c2}}}{top_lines[1]}"
        )
    else:
        line = top_lines[0]
        fs = int(_fit_fontsize(line, 900, top_font, min_fs=190, max_fs=390) * scale_cap)
        top_y_safe = max(int(fs * 0.44) + 38, top_y_center)
        if " " in line:
            parts = line.split(" ", 1)
            tagged = f"{{\\q2{slant_tag}\\frz{tilt_deg:.1f}\\fs{fs}\\bord26\\shad11\\1c{c1}}}{parts[0]} {{\\1c{c2}}}{parts[1]}"
        else:
            tagged = f"{{\\q2{slant_tag}\\frz{tilt_deg:.1f}\\fs{fs}\\bord26\\shad11\\1c{c1}}}{line}"
        top_dialogues.append(
            f"Dialogue: 3,0:00:00.00,0:00:05.00,HookTop,,0,0,0,,{{\\pos(540,{top_y_safe})}}{tagged}"
        )

    bot_str = escape_ass_text(meta["bottom_text"])
    bot_fs = _fit_fontsize(bot_str, 900, bot_font, min_fs=135, max_fs=275)
    bot_slant = "\\fax-0.16" if bot_font == "Anton" else "\\fax-0.10"
    bot_y = min(1820, rib_cy + int(rib_h * 0.50) + int(bot_fs * 0.38) + 16)
    phone_esc = escape_ass_text(phone_name)
    phone_slant = "\\fax-0.08"

    ass_content = f"""[Script Info]
ScriptType: v4.00+
WrapStyle: 2
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: HookTop,{top_font},200,&H0000E6FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,2,0,1,22,9,5,10,10,10,1
Style: PhoneRib,Poppins,{phone_fs},&H00FFFFFF,&H000000FF,&H00000060,&H38000000,-1,0,0,0,100,100,0,0,1,0.6,2.5,5,10,10,10,1
Style: HookBot,{bot_font},{bot_fs},&H0000E6FF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,2,0,1,19,8,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + "\n".join(top_dialogues) + f"""
Dialogue: 4,0:00:00.00,0:00:05.00,PhoneRib,,0,0,0,,{{\\q2{phone_slant}\\pos(540,{rib_cy})\\frz{ribbon_tilt:.1f}}}{phone_esc}
Dialogue: 4,0:00:00.00,0:00:05.00,HookBot,,0,0,0,,{{\\q2\\pos(540,{bot_y}){bot_slant}\\frz{ribbon_tilt:.1f}}}{bot_str}
"""
    with open(temp_ass, "w", encoding="utf-8") as f:
        f.write(ass_content)

    esc_fonts = fonts_dir.replace("\\", "/").replace(":", "\\:")
    try:
        subprocess.run([
            "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
            "-i", temp_bg_jpg,
            "-vf", f"ass='{ass_name}':fontsdir='{esc_fonts}'",
            "-frames:v", "1", "-q:v", "2",
            abs_out_thumb
        ], cwd=out_dir, check=True)
    except Exception:
        shutil.copy(temp_bg_jpg, abs_out_thumb)

    for tmp_f in (temp_bg_jpg, temp_ass):
        if os.path.exists(tmp_f):
            try:
                os.remove(tmp_f)
            except Exception:
                pass

    return out_thumb_path, meta

def _build_deterministic_active_plan(active_plan, video_title, total_dur, lang="id"):
    """Fallback naskah deterministik hanya untuk adegan aktif terklasifikasi bila seluruh model teks AI sibuk."""
    short_title = re.sub(r"[^a-zA-Z0-9\s\-]", "", video_title).strip()[:38] or ("this flagship phone" if lang == "en" else "HP Flagship ini")
    if lang == "en":
        _, _, en_cta_fb = pick_english_cta_style_and_fallback(video_title)
        _, _, en_hook_tpl = pick_english_opening_hook_style(video_title)
        open_hook = en_hook_tpl.format(phone=short_title)
        templates = {
            "body": f"{open_hook} Its sleek frame feels solid and well crafted in hand.",
            "ketahanan_fisik": "Built tough to handle daily splashes, dust, and accidental drops confidently.",
            "design_layar": "The vibrant high refresh rate display stays super sharp and bright.",
            "baterai_daya": "A large all-day battery pairs smoothly with rapid fast charging support.",
            "os": "Its clean software interface delivers fluid animations and smart daily controls.",
            "benchmark_dapur_pacu": "Powered by a fast chipset, multitasking and demanding games run super smoothly.",
            "speaker": "Dual stereo speakers produce clear, balanced audio with punchy volume.",
            "fitur_unik": "Complete hardware extras like NFC and fast fingerprint unlock stand out clearly.",
            "kamera": "Its main and selfie cameras capture crisp photos and steady video footage.",
            "cta": en_cta_fb,
        }
        plan = {
            "caption": f"Quick Verdict on {short_title}!",
            "hashtags": "#SmartphoneReview #TechShorts #GadgetReview #Shorts"
        }
    else:
        templates = {
            "body": f"{short_title} hadir dengan desain bodi ramping, material kokoh, dan genggaman sangat nyaman.",
            "ketahanan_fisik": "Ketahanan fisiknya tangguh menghadapi cipratan air, debu, serta benturan pemakaian harian.",
            "design_layar": "Layarnya tampil tajam memanjakan mata dengan bezel tipis serta refresh rate super mulus.",
            "baterai_daya": "Kapasitas baterainya tahan seharian dan didukung pengisian daya cepat sangat praktis.",
            "os": "Antarmuka sistem operasinya terasa ringan, rapi, dan responsif untuk navigasi harian.",
            "benchmark_dapur_pacu": "Dapur pacunya bertenaga kencang untuk melibas benchmark berat maupun bermain game lancar.",
            "speaker": "Keluaran suara speaker stereonya terdengar lantang, jernih, dan seimbang di telinga.",
            "fitur_unik": "Dilengkapi fitur unggulan lengkap mulai dari sensor sidik jari gesit hingga konektivitas NFC.",
            "kamera": "Kamera depan dan belakangnya menghasilkan foto tajam serta rekaman video stabil jernih.",
            "cta": "Paket lengkap di kelas harganya, langsung cek info harga promo dan link pembeliannya sekarang!"
        }
        plan = {
            "caption": f"Review Singkat {short_title}!",
            "hashtags": "#ReviewHP #GadgetIndonesia #Smartphone #Shorts"
        }

    for idx, sc in enumerate(active_plan):
        cid = sc["id"]
        clips = sc.get("assigned_clips", [])
        s_t = clips[0]["start_s"] if clips else 35.0
        e_t = clips[-1]["end_s"] if clips else min(total_dur - 10.0, s_t + 30.0)
        txt = templates.get(cid, sc["title"])
        if idx == 0 and cid != "body":
            txt = (f"{open_hook} {txt}" if lang == "en" else f"{short_title} tampil memikat! {txt}")
        if cid == "cta":
            prev_txt = plan[active_plan[idx - 1]["id"]]["script"] if idx > 0 and active_plan[idx - 1]["id"] in plan else ""
            if lang == "en":
                txt = ensure_english_like_and_subscribe_cta(txt, templates["cta"], prev_text=prev_txt)
            else:
                _, _, id_fb = pick_indonesian_cta_style_and_fallback(video_title)
                txt = ensure_indonesian_affiliate_soft_selling_cta(txt, id_fb, prev_text=prev_txt)
        plan[cid] = {"start_sec": s_t, "end_sec": e_t, "script": txt, "scenes": []}
    return plan

def _window_in_same_shot(video_path, core_s, core_e, ext_s, ext_dur, min_corr=0.78):
    """Memastikan perluasan jendela [ext_s, ext_s + ext_dur] masih berada pada satu shot visual yang sama dengan [core_s, core_e]."""
    cap = cv2.VideoCapture(video_path)
    try:
        hists = []
        for t_q in ((core_s + core_e) * 0.5, ext_s + 0.12, ext_s + max(0.25, ext_dur - 0.12)):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t_q) * 1000.0)
            ret, frm = cap.read()
            if not ret or frm is None:
                return False
            hists.append(_compute_frame_hist(crop_center_9_16(frm)))
        return (
            cv2.compareHist(hists[0], hists[1], cv2.HISTCMP_CORREL) >= min_corr
            and cv2.compareHist(hists[0], hists[2], cv2.HISTCMP_CORREL) >= min_corr
        )
    finally:
        cap.release()


def _safe_remove_file(path):
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass


def _extract_clip_mid_hist(clip_path):
    cap = cv2.VideoCapture(clip_path)
    try:
        nf = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, nf // 2)
        ret, frm = cap.read()
        if ret and frm is not None:
            return _compute_frame_hist(frm)
        return None
    finally:
        cap.release()


def _is_window_consumed(s_t, e_t, consumed_keys):
    mid_t = (float(s_t) + float(e_t)) * 0.5
    for cs, ce in consumed_keys:
        if max(float(s_t), cs) < min(float(e_t), ce) - 0.25:
            return True
        if abs(mid_t - ((cs + ce) * 0.5)) < 3.2:
            return True
    return False


def _cut_classified_clip_fit(video_path, clip_obj, exact_dur, clip_out, clip_detector, face_free_segs, is_cam_chap):
    """Memotong tepat durasi VO dari klip terklasifikasi tanpa meluber keluar batas shot maupun wajah dan tanpa duplikasi."""
    c_start = float(clip_obj["start_s"])
    c_end = float(clip_obj["end_s"])
    avail = max(0.5, c_end - c_start)

    if avail >= exact_dur:
        seg_start = c_start + (avail - exact_dur) * 0.5
        cut_exact_broll_clip_1080p(video_path, seg_start, exact_dur, clip_out)
        if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
            return True
        _safe_remove_file(clip_out)
        return False

    # Utamakan fit halus di dalam batas shot terverifikasi [c_start, c_end] agar tidak meluber ke shot berteks di sebelah!
    if avail >= (exact_dur / 1.90):
        cut_exact_broll_clip_1080p(video_path, c_start, exact_dur, clip_out, avail_dur=avail)
        if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
            return True
        _safe_remove_file(clip_out)
        return False

    # Hanya perluas bila sangat pendek (< exact_dur / 1.90) DAN terbukti secara histogram masih satu shot yang sama!
    enclosing = next(((float(fs), float(fe)) for fs, fe in face_free_segs if float(fs) - 0.1 <= c_start and float(fe) + 0.1 >= c_end), None)
    if enclosing and (enclosing[1] - enclosing[0]) >= exact_dur:
        ext_s = max(enclosing[0], min(enclosing[1] - exact_dur, c_start - (exact_dur - avail) * 0.5))
        if _window_in_same_shot(video_path, c_start, c_end, ext_s, exact_dur):
            if verify_source_window_clean(video_path, ext_s, exact_dur, clip_detector, is_camera_chap=is_cam_chap):
                cut_exact_broll_clip_1080p(video_path, ext_s, exact_dur, clip_out)
                if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
                    return True
                _safe_remove_file(clip_out)

    # Fit halus ke durasi eksak pada klip terklasifikasi bersih jika selisih masih wajar (tanpa meluber ke shot lain)
    if avail >= (exact_dur / 2.15):
        cut_exact_broll_clip_1080p(video_path, c_start, exact_dur, clip_out, avail_dur=avail)
        if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
            return True
    _safe_remove_file(clip_out)
    return False

def main():
    parser = argparse.ArgumentParser(description="AI Agent Pro Clipper 1080p (Visual-First Classified Scene Pipeline)")
    parser.add_argument("--url", required=True)
    parser.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY"))
    parser.add_argument("--lang", choices=["id", "en"], default="id")
    parser.add_argument("--voice", default="Despina")
    parser.add_argument("--tts-model", default=None)
    parser.add_argument("--cookies", default=None, help="Path opsional cookies.txt untuk unduhan YouTube/subtitle bebas 429")
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

    # Tahap 1: Unduh Video + Subtitle Anti-429 (+ Fallback Transkrip Audio Gemini & YouTube Chapters)
    video_path, sub_file, video_title, video_desc, vid_id, youtube_chapters = download_video_and_subs(
        args.url, work_dir, args.skip_download, cookies_path=args.cookies
    )

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_dur = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
    cap.release()

    events = load_transcript_events(sub_file)
    if not events:
        events = transcribe_video_audio_with_gemini(
            video_path, vid_id, work_dir, total_dur, args.api_key, youtube_chapters=youtube_chapters
        )
    timestamped_transcript = build_timestamped_transcript_digest(events, youtube_chapters=youtube_chapters)

    face_free_segs = get_or_scan_face_free_segments(
        video_path, model_path, total_dur, vid_id, work_dir, min_duration=1.8, force_rescan=args.rescan_faces
    )

    clip_detector = cv2.FaceDetectorYN.create(
        model=model_path, config="", input_size=(270, 480),
        score_threshold=0.36, nms_threshold=0.3, top_k=5000
    )

    # Tahap 2: Klasifikasi Setiap Frame/Shot ke 10 Jenis Adegan & Pangkas Adegan Tanpa Klip Memadai
    print("\n[*] Tahap 1/4: Klasifikasi Frame per Jenis Adegan (Anti-Random & Anti-Pengulangan)...", flush=True)
    classified_pools = classify_all_candidate_clips(
        video_path, vid_id, work_dir, face_free_segs, clip_detector,
        events, youtube_chapters, total_dur, args.api_key
    )
    active_plan = select_active_scenes_and_assign_slots(classified_pools)
    if not active_plan:
        print("[ERROR] Tidak ditemukan klip B-roll produk bersih (bebas wajah & maksimal 1 HP) yang memadai untuk disusun menjadi video.", flush=True)
        sys.exit(1)

    print(f"\n[*] Tahap 2/4: Menyusun Naskah VO Khusus {len(active_plan)} Adegan Aktif (Selaras 1:1 dengan Klip Terklasifikasi)...", flush=True)
    plan_raw = analyze_native_transcript_and_build_chapters(
        video_title, video_desc, timestamped_transcript, total_dur, args.api_key,
        lang=args.lang, active_scenes_plan=active_plan, youtube_chapters=youtube_chapters
    )
    if isinstance(plan_raw, list) and len(plan_raw) > 0:
        plan = plan_raw[0] if isinstance(plan_raw[0], dict) else {}
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

    active_ids = [s["id"] for s in active_plan]
    if not plan or sum(1 for k in active_ids if isinstance(plan.get(k), dict) and plan[k].get("script")) < max(1, len(active_ids) // 2):
        print("   [!] Mengaktifkan penyusun naskah deterministik terklasifikasi untuk adegan aktif...", flush=True)
        fb_plan = _build_deterministic_active_plan(active_plan, video_title, total_dur, lang=args.lang)
        for k, v in fb_plan.items():
            if not plan.get(k) or (isinstance(plan.get(k), dict) and not plan[k].get("script")):
                plan[k] = v

    chapters_with_scenes = []
    chapter_scripts = []
    scene_clip_queues = {}
    print("\n📋 Adegan Aktif & Pemetaan Klip Terklasifikasi (0 Pengulangan):", flush=True)
    for idx, sc_plan in enumerate(active_plan, 1):
        cid = sc_plan["id"]
        c_data = plan.get(cid, {})
        if not isinstance(c_data, dict):
            c_data = {"start_sec": 35.0, "end_sec": min(total_dur - 10.0, 90.0), "script": str(c_data or "")}
        assigned_clips = list(sc_plan.get("assigned_clips", []))
        spare_clips = list(sc_plan.get("spare_clips", []))
        scene_clip_queues[cid] = assigned_clips + spare_clips

        built_scenes = ensure_chapter_scenes(
            sc_plan, c_data, events, total_dur,
            assigned_clips=assigned_clips,
            max_cuts=sc_plan["max_cuts"]
        )
        s_sec = float(c_data.get("start_sec", 40.0))
        e_sec = float(c_data.get("end_sec", min(total_dur - 10.0, s_sec + 60.0)))
        s_txt = sanitize_subtitle_text(c_data.get("script", ""))
        if cid == "cta":
            prev_ch_txt = chapter_scripts[-1] if chapter_scripts else ""
            if args.lang == "en":
                _, _, cta_fb = pick_english_cta_style_and_fallback(video_title)
                s_txt = ensure_english_like_and_subscribe_cta(s_txt, cta_fb, prev_text=prev_ch_txt)
            else:
                _, _, cta_fb = pick_indonesian_cta_style_and_fallback(video_title)
                s_txt = ensure_indonesian_affiliate_soft_selling_cta(s_txt, cta_fb, prev_text=prev_ch_txt)
            c_data["script"] = s_txt
            if len(built_scenes) == 1:
                built_scenes[0]["script"] = s_txt
        chapter_scripts.append(s_txt)
        chapters_with_scenes.append({
            "id": cid,
            "title": sc_plan["title"],
            "start_sec": s_sec,
            "end_sec": e_sec,
            "max_cuts": sc_plan["max_cuts"],
            "script": s_txt,
            "scenes": built_scenes
        })
        clips_lbl = ", ".join(f"[{int(c['start_s'])}-{int(c['end_s'])}s]" for c in assigned_clips)
        print(f"   Adegan {idx} [{sc_plan['title']}] ({len(assigned_clips)} klip: {clips_lbl}): \"{s_txt}\"", flush=True)

    caption_txt = plan.get("caption", " ".join(chapter_scripts)[:140]).strip()
    hashtags_txt = normalize_hashtags(plan.get("hashtags", ""), lang=args.lang)

    print("\n[*] Tahap 3/4: Memanggil Gemini TTS & Menyelaraskan Subtitle Presisi (DP Acoustic Alignment)...", flush=True)
    full_wav_path = os.path.join(out_dir, f"full_vo_{args.lang}.wav")
    ok_tts, used_model = generate_single_gemini_tts_chapters(
        chapter_scripts, full_wav_path, args.api_key, args.voice, args.tts_model, lang=args.lang
    )
    if not ok_tts:
        print("[ERROR] Gagal membuat audio TTS.", flush=True)
        sys.exit(1)

    ass_path = os.path.join(out_dir, f"pro_subtitles_1080p_{args.lang}.ass")
    srt_path = os.path.join(out_dir, f"final_subtitles_{args.lang}.srt")
    sync_json_path = os.path.join(out_dir, f"scene_vo_sync_{args.lang}.json")
    chapter_durations, target_final_dur, all_visual_cuts = analyze_wav_scenes_and_build_subtitles(
        chapters_with_scenes, full_wav_path, ass_path, srt_path, sync_json_path, lang=args.lang
    )
    print(f"🎙️ Sukses TTS ({used_model}) | Total Durasi: {target_final_dur:.2f}s | {len(all_visual_cuts)} Cut Adegan Terkunci Subtitle!", flush=True)
    for cut_item in all_visual_cuts:
        print(
            f"   ⏱️ [{cut_item['audio_start_s']:05.2f}s -> {cut_item['audio_end_s']:05.2f}s | {cut_item['duration_s']:.2f}s] "
            f"{cut_item['scene_id']} (Cut {cut_item['cut_in_scene_idx']}): \"{cut_item['cut_spoken_text']}\"",
            flush=True
        )

    print("\n[*] Memotong Klip 1080p 1:1 Sesuai Klasifikasi Jenis Adegan (0 Pengulangan & 100% Lolos Verifikasi)...", flush=True)
    all_final_clips = []
    consumed_clip_keys = set()
    consumed_hists = []

    def _try_classified_candidate(cand_clip, exact_dur, clip_out, is_cam_chap):
        cs, ce = float(cand_clip["start_s"]), float(cand_clip["end_s"])
        if _is_window_consumed(cs, ce, consumed_clip_keys):
            return False
        cand_h = cand_clip.get("mid_hist")
        if cand_h is not None and is_visually_duplicate(cand_h, consumed_hists, threshold=0.86):
            return False
        if not _cut_classified_clip_fit(video_path, cand_clip, exact_dur, clip_out, clip_detector, face_free_segs, is_cam_chap):
            return False
        out_h = _extract_clip_mid_hist(clip_out)
        if out_h is not None and is_visually_duplicate(out_h, consumed_hists, threshold=0.86):
            _safe_remove_file(clip_out)
            return False
        consumed_clip_keys.add((round(cs, 2), round(ce, 2)))
        if out_h is not None:
            consumed_hists.append(out_h)
        return True

    for cut_idx, cut_item in enumerate(all_visual_cuts, 1):
        cid = cut_item["chapter_id"]
        exact_dur = max(1.15, float(cut_item["duration_s"]))
        is_cam_chap = (cid == "kamera")

        clip_out = os.path.join(
            out_dir,
            f"chap_{cut_item['chap_idx']:02d}_scene_{cut_item['scene_idx']:02d}_cut_{cut_item['cut_in_scene_idx']:02d}.mp4"
        )

        print(
            f"\n ---> Visual Cut {cut_idx}/{len(all_visual_cuts)} [{cid} | {cut_item['scene_id']}] "
            f"| Durasi VO: {exact_dur:.2f}s | VO: \"{cut_item['cut_spoken_text']}\"",
            flush=True
        )

        queue = scene_clip_queues.get(cid, [])
        cut_ok = False
        while queue:
            cand_clip = queue.pop(0)
            if _try_classified_candidate(cand_clip, exact_dur, clip_out, is_cam_chap):
                print(f"      ✅ Klip [{cand_clip['start_s']:.1f}s-{cand_clip['end_s']:.1f}s] ({cand_clip.get('visual_note', cid)}) -> LOLOS UNIK", flush=True)
                cut_ok = True
                break
            print(f"      [!] Klip [{cand_clip['start_s']:.1f}s-{cand_clip['end_s']:.1f}s] ditolak/duplikat -> Ambil cadangan kelas {cid}...", flush=True)

        # Tier Cadangan 1: Klip terklasifikasi lain yang BELUM terpakai di pool sejenis (mis. body/fitur_unik untuk non-kamera)
        if not cut_ok and not is_cam_chap:
            for alt_cid in ("body", "fitur_unik", "design_layar", "cta"):
                if alt_cid == cid:
                    continue
                for alt_cl in list(classified_pools.get(alt_cid, [])):
                    if _try_classified_candidate(alt_cl, exact_dur, clip_out, False):
                        print(f"      ✅ Klip kompatibel dari [{alt_cid}] [{alt_cl['start_s']:.1f}s-{alt_cl['end_s']:.1f}s] -> LOLOS UNIK", flush=True)
                        cut_ok = True
                        break
                if cut_ok:
                    break

        # Tier Cadangan 2 (Wajib Gemini Vision + OpenCV — dilarang keras meloloskan segmen mentah tanpa Vision!)
        if not cut_ok:
            safe_min_res = 38.0 if total_dur > 140.0 else 15.0
            safe_max_res = max(safe_min_res + 30.0, total_dur - 15.0) if total_dur > 140.0 else (total_dur - 4.0)
            min_src_dur = max(1.6, exact_dur / 1.90)
            for fs_s, fs_e in face_free_segs:
                s0 = max(float(fs_s), safe_min_res)
                e0 = min(float(fs_e), safe_max_res)
                while (e0 - s0) >= min_src_dur:
                    cand_s = s0 + 0.12
                    src_span_res = min(exact_dur, e0 - cand_s)
                    cand_e = cand_s + src_span_res
                    s0 += max(2.2, src_span_res * 0.75)
                    if src_span_res < min_src_dur or cand_e > e0:
                        break
                    if _is_window_consumed(cand_s, cand_e, consumed_clip_keys):
                        continue
                    sub_ctx = get_transcript_slice(events, max(0.0, cand_s - 3.5), cand_e + 3.5).lower()
                    if any(bkw in sub_ctx for bkw in SUBSCRIBE_BLACKLIST_KEYWORDS):
                        continue
                    if not verify_source_window_clean(video_path, cand_s, src_span_res, clip_detector, samples=12, is_camera_chap=is_cam_chap):
                        continue
                    b64_res, hist_res = extract_storyboard_and_hist(video_path, cand_s, cand_e, detector=clip_detector, is_camera_chap=is_cam_chap)
                    if not b64_res or (hist_res is not None and is_visually_duplicate(hist_res, consumed_hists, threshold=0.86)):
                        continue
                    vis_res = check_clean_broll_segment(
                        b64_res, sub_ctx, cut_item.get("chapter_title", cid), is_cam_chap, args.api_key,
                        visual_focus=cut_item.get("visual_focus", cid), scene_vo=cut_item.get("cut_spoken_text", "")
                    )
                    if not (
                        vis_res
                        and vis_res.get("is_product_broll") is True
                        and vis_res.get("has_face") is False
                        and vis_res.get("has_editor_overlay") is False
                        and vis_res.get("has_subscribe_popup", False) is False
                        and vis_res.get("has_multiple_phones", False) is False
                        and (is_cam_chap or vis_res.get("is_static_image", False) is False)
                    ):
                        continue
                    avail_arg = src_span_res if src_span_res < (exact_dur - 0.08) else None
                    cut_exact_broll_clip_1080p(video_path, cand_s, exact_dur, clip_out, avail_dur=avail_arg)
                    if verify_clip_100pct_face_free(clip_out, clip_detector, is_camera_chap=is_cam_chap):
                        out_h = _extract_clip_mid_hist(clip_out)
                        consumed_clip_keys.add((round(cand_s, 2), round(cand_e, 2)))
                        if out_h is not None:
                            consumed_hists.append(out_h)
                        print(f"      ⚠️ Vision Rescue bersih [{cand_s:.1f}s-{cand_e:.1f}s] -> OK", flush=True)
                        cut_ok = True
                        break
                    _safe_remove_file(clip_out)
                if cut_ok:
                    break

        if cut_ok and os.path.exists(clip_out):
            all_final_clips.append(clip_out)
        else:
            _safe_remove_file(clip_out)
            print(f"      [SKIP] Tidak ada klip cadangan yang lolos verifikasi ketat untuk cut ini.", flush=True)

    if not all_final_clips:
        print("[ERROR] Seluruh potongan klip gagal verifikasi bersih (anti-wajah/statis/identitas channel).", flush=True)
        sys.exit(1)

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

    print(f"\n[*] Tahap 4/4: Merender Video Akhir 1080p ({len(all_final_clips)} Cut Terklasifikasi + Subtitle Sinkron VO)...", flush=True)
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
        detector=clip_detector, api_key=args.api_key,
        work_dir=work_dir, video_path=video_path,
        face_free_segs=face_free_segs, chapters_with_scenes=chapters_with_scenes,
        total_dur=total_dur
    )
    if thumb_res and os.path.exists(thumb_output):
        _, thumb_meta = thumb_res
        top_str = " / ".join(thumb_meta.get("top_lines", []))
        st_name = thumb_meta.get("style", {}).get("name", "dynamic")
        print(
            f"🖼️ Thumbnail Siap ({st_name}): {top_str} | [{thumb_meta['phone_name']}] | {thumb_meta['bottom_text']}",
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
        print(f" ✅ SELESAI! ({len(all_visual_cuts)} Cut Adegan Terklasifikasi & Sinkron VO | Durasi: {target_final_dur:.1f}s)", flush=True)
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
