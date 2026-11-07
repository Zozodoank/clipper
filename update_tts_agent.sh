#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[*] Memperbarui auto_broll_agent.py dengan opsi pilihan Bahasa (--lang id / en)..."

cat << 'PYEOF' > ~/broll-agent/auto_broll_agent.py
import os
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

# Prioritas Utama: Gemini 3.8 Flash TTS, 3.7 Flash TTS, dan 3.1 Flash TTS
TTS_MODELS = [
    "gemini-3.8-flash-tts",
    "gemini-3.7-flash-tts",
    "gemini-3.1-flash-tts",
    "gemini-3.8-flash-preview-tts",
    "gemini-3.7-flash-preview-tts",
    "gemini-3.1-flash-preview-tts",
    "gemini-2.5-flash-preview-tts"
]

# Model Vision utama dengan fallback otomatis
VISION_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.1-flash",
    "gemini-2.5-flash"
]

FEATURE_KEYWORDS = [
    "kamera", "layar", "baterai", "chipset", "performa", "desain", "bodi",
    "gaming", "speaker", "charging", "cas", "ram", "storage", "memori",
    "antutu", "fps", "suhu", "panas", "fitur", "spesifikasi", "amoled",
    "ips", "refresh rate", "hz", "megapixel", "mp", "ois", "stabil",
    "camera", "display", "screen", "battery", "performance", "design",
    "processor", "fast charging", "build quality", "benchmark", "zoom"
]

def download_video_and_subs(url, work_dir, skip_download=False):
    video_out = os.path.join(work_dir, "source_video.mp4")
    sub_file = None
    for f in os.listdir(work_dir):
        if f.startswith("source_video") and f.endswith(".json3"):
            sub_file = os.path.join(work_dir, f)
            break

    if skip_download and os.path.exists(video_out):
        print("\n[*] Menggunakan video & transkrip lokal yang sudah terunduh...")
        return video_out, sub_file

    print("\n[*] Mengunduh video 1080p dan transkrip dari YouTube...")
    if os.path.exists(video_out):
        os.remove(video_out)

    # Unduh video + coba ambil subtitle Indonesia atau Inggris tanpa memicu error 429 fatal
    cmd = [
        "yt-dlp",
        "--ignore-errors",
        "--js-runtimes", "node",
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
            "yt-dlp", "--js-runtimes", "node",
            "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", video_out, url
        ], check=True)

    for f in os.listdir(work_dir):
        if f.startswith("source_video") and f.endswith(".json3"):
            sub_file = os.path.join(work_dir, f)
            break
    return video_out, sub_file

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
    print(f"[+] Ditemukan {len(merged)} zona waktu pembahasan fitur HP.")
    return merged

def is_in_windows(t, windows):
    return any(w_s <= t <= w_e for w_s, w_e in windows)

def crop_center_9_16(frame):
    h, w = frame.shape[:2]
    crop_w = int(h * 9 / 16)
    crop_w = crop_w - (crop_w % 2)
    start_x = int((w - crop_w) / 2)
    return frame[0:h, start_x:start_x + crop_w]

def scan_face_free_segments(video_path, model_path, feature_windows, min_duration=3.0):
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

    print(f"[+] Ditemukan {len(candidates)} kandidat segmen bebas wajah.")
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

def verify_and_script_with_gemini(b64_img, raw_sub, duration_s, api_key, lang="id"):
    max_words = max(5, int(duration_s * 2.4))
    
    if lang == "en":
        lang_instruction = (
            f"TASK 2 (COPYRIGHT-SAFE ENGLISH VOICEOVER):\n"
            f"- Write a natural, engaging, and punchy smartphone review voiceover sentence in **ENGLISH** based on the visual and original transcript (MAXIMUM {max_words} WORDS so it fits comfortably within {duration_s:.1f} seconds).\n"
            f"- Even if the source transcript is in Indonesian or another language, translate and adapt it into natural English.\n"
            f"- Never mention the original reviewer or channel name."
        )
    else:
        lang_instruction = (
            f"TUGAS 2 (MODIFIKASI VOICE OVER BAHASA INDONESIA ANTI-HAK CIPTA):\n"
            f"- Buat kalimat narasi voice-over dalam **BAHASA INDONESIA** yang natural, menarik, dan memodifikasi transkrip asli sesuai visual HP yang tampil (MAKSIMAL {max_words} KATA agar pas dibaca dalam {duration_s:.1f} detik).\n"
            f"- Meskipun transkrip aslinya berbahasa Inggris, terjemahkan dan adaptasikan ke Bahasa Indonesia yang luwes.\n"
            f"- Jangan menyebut nama channel atau reviewer asli."
        )

    prompt = (
        f"Gambar ini berisi 3 frame berurutan hasil crop 9:16 dari review HP (durasi klip: {duration_s:.1f} detik).\n"
        f"Transkrip asli di detik ini: \"{raw_sub}\"\n\n"
        "TUGAS 1 (FILTER VISUAL KETAT / STRICT VISUAL FILTER):\n"
        "- has_face = true jika ada wajah manusia.\n"
        "- has_editor_overlay = true HANYA JIKA ada subtitle pembicara, teks spesifikasi tempelan editor, watermark, atau grafis animasi.\n"
        "- has_editor_overlay = false jika teks yang terlihat adalah TEKS FISIK NYATA pada bodi HP, layar UI HP yang menyala, kardus HP, atau background nyata.\n"
        "- is_product_broll = true jika menyorot fisik/fitur HP.\n\n"
        f"{lang_instruction}"
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64_img}}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "is_product_broll": {"type": "BOOLEAN"},
                    "has_face": {"type": "BOOLEAN"},
                    "has_editor_overlay": {"type": "BOOLEAN"},
                    "reason": {"type": "STRING"},
                    "vo_script": {"type": "STRING"}
                },
                "required": ["is_product_broll", "has_face", "has_editor_overlay", "reason", "vo_script"]
            }
        }
    }

    for v_model in VISION_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{v_model}:generateContent?key={api_key}"
        for attempt in range(2):
            try:
                resp = requests.post(url, json=payload, timeout=35)
                if resp.status_code == 404:
                    break
                if resp.status_code == 429:
                    time.sleep(4 * (attempt + 1))
                    continue
                resp.raise_for_status()
                text_out = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text_out)
            except Exception as e:
                if attempt == 1 and v_model == VISION_MODELS[-1]:
                    print(f" [!] Error API Vision ({v_model}): {e}")
                time.sleep(2)
    return None

def generate_gemini_tts(text_script, out_wav, api_key, voice_name="Despina", lang="id", custom_model=None):
    models_to_try = [custom_model] if custom_model else TTS_MODELS
    
    if lang == "en":
        tts_prompt = f"Read this smartphone review script in clear, enthusiastic, and natural English: {text_script}"
    else:
        tts_prompt = f"Bacakan naskah review gadget ini dalam Bahasa Indonesia dengan intonasi yang jelas, natural, dan antusias: {text_script}"

    payload = {
        "contents": [{"parts": [{"text": tts_prompt}]}],
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

    for model_name in models_to_try:
        if not model_name:
            continue
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        for attempt in range(2):
            try:
                resp = requests.post(url, json=payload, timeout=40)
                if resp.status_code == 404:
                    break
                if resp.status_code == 429:
                    time.sleep(4)
                    continue
                resp.raise_for_status()
                data = resp.json()
                b64_audio = data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
                pcm_bytes = base64.b64decode(b64_audio)

                with wave.open(out_wav, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(24000)
                    wf.writeframes(pcm_bytes)
                return True, model_name
            except Exception:
                time.sleep(1)
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

def render_clip_with_tts(video_path, start_s, end_s, wav_path, out_path):
    safe_start = start_s + 0.2
    clip_dur = (end_s - 0.2) - safe_start
    if clip_dur < 1.8:
        return 0.0

    audio_dur = get_media_duration(wav_path)
    atempo_filter = "apad"
    if audio_dur > clip_dur and clip_dur > 0:
        ratio = min(1.35, audio_dur / (clip_dur - 0.1))
        if ratio > 1.02:
            atempo_filter = f"atempo={ratio:.2f},apad"

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{safe_start:.2f}", "-t", f"{clip_dur:.2f}", "-i", video_path,
        "-i", wav_path,
        "-vf", "crop=ih*9/16:ih:(iw-ow)/2:0,scale=1080:1920:flags=lanczos",
        "-af", atempo_filter,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-shortest", out_path
    ]
    subprocess.run(cmd, check=True)
    return get_media_duration(out_path)

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
    parser = argparse.ArgumentParser(description="AI Agent B-Roll 9:16 + Gemini TTS (Despina) + Pilihan Bahasa ID/EN")
    parser.add_argument("--url", required=True, help="Link YouTube review HP")
    parser.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY"), help="Gemini API Key")
    parser.add_argument("--lang", choices=["id", "en"], default="id", help="Pilihan bahasa Voiceover & Subtitle: 'id' (Indonesia) atau 'en' (Inggris)")
    parser.add_argument("--voice", default="Despina", help="Nama suara Gemini TTS (default: Despina)")
    parser.add_argument("--tts-model", default=None, help="Paksa model spesifik: gemini-3.8-flash-tts / gemini-3.7-flash-tts / gemini-3.1-flash-tts")
    parser.add_argument("--min-duration", type=float, default=3.2, help="Durasi minimal per klip (detik)")
    parser.add_argument("--max-clips", type=int, default=12, help="Batas maksimal klip yang digabung")
    parser.add_argument("--skip-download", action="store_true", help="Gunakan video yang sudah didownload sebelumnya")
    args = parser.parse_args()

    if not args.api_key:
        print("[ERROR] Harap masukkan API Key dengan --api-key")
        sys.exit(1)

    lang_label = "BAHASA INDONESIA" if args.lang == "id" else "ENGLISH"
    work_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(work_dir, "face_detection_yunet.onnx")
    out_dir = os.path.join(work_dir, "output_clips")
    os.makedirs(out_dir, exist_ok=True)

    video_path, sub_file = download_video_and_subs(args.url, work_dir, args.skip_download)
    events = load_transcript_events(sub_file)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_dur = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
    cap.release()

    windows = parse_feature_windows(events, total_dur)
    candidates = scan_face_free_segments(video_path, model_path, windows, args.min_duration)

    approved_clips = []
    sub_timeline = []
    current_timeline_sec = 0.0

    print(f"\n[*] Memverifikasi B-Roll & membuat Voice Over [{lang_label}] (Suara: {args.voice})...")
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
            b64 = build_storyboard_base64(video_path, sub_s, sub_e)
            if not b64:
                continue

            raw_sub = get_transcript_slice(events, sub_s, sub_e)
            clip_target_dur = (sub_e - sub_s) - 0.4
            res = verify_and_script_with_gemini(b64, raw_sub, clip_target_dur, args.api_key, args.lang)
            if not res:
                continue

            is_clean = (
                res.get("is_product_broll") is True
                and res.get("has_face") is False
                and res.get("has_editor_overlay") is False
            )
            vo_script = res.get("vo_script", "").strip()
            status = "LOLOS" if is_clean else "DITOLAK"
            print(f" -> [{sub_s:.1f}s - {sub_e:.1f}s] {status} | {res.get('reason')}")

            if is_clean and vo_script:
                idx_num = len(approved_clips) + 1
                wav_path = os.path.join(out_dir, f"tts_{args.lang}_{idx_num:02d}.wav")
                ok_tts, used_model = generate_gemini_tts(
                    vo_script, wav_path, args.api_key, args.voice, args.lang, args.tts_model
                )
                if not ok_tts:
                    print("    [!] Gagal membuat audio TTS untuk segmen ini, melewati...")
                    continue

                print(f"    🎙️ TTS [{args.lang.upper()}] ({used_model} - {args.voice}): \"{vo_script}\"")
                clip_name = f"broll_vo_{args.lang}_{idx_num:02d}_{int(sub_s)}s_{int(sub_e)}s.mp4"
                clip_path = os.path.join(out_dir, clip_name)

                actual_dur = render_clip_with_tts(video_path, sub_s, sub_e, wav_path, clip_path)
                if actual_dur > 0:
                    approved_clips.append(clip_path)
                    sub_timeline.append((current_timeline_sec, current_timeline_sec + actual_dur, vo_script))
                    current_timeline_sec += actual_dur

    if not approved_clips:
        print("\n[!] Tidak ada klip yang lolos filter.")
        sys.exit(0)

    list_file = os.path.join(out_dir, "concat_list.txt")
    with open(list_file, "w") as f:
        for c in approved_clips:
            f.write(f"file '{os.path.abspath(c)}'\n")

    raw_merged = os.path.join(out_dir, f"merged_no_sub_{args.lang}.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", list_file, "-c", "copy", raw_merged
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

    print(f"\n=====================================================")
    print(f" ✅ SELESAI! Video Shorts [{lang_label}] Siap Upload:")
    print(f" 📁 File Utama: {final_output}")
    print(f" ⏱️ Total Durasi: {current_timeline_sec:.1f} detik ({len(approved_clips)} segmen)")

    target_hp_dir = "/sdcard/Download/Broll_Clips"
    try:
        os.makedirs(target_hp_dir, exist_ok=True)
        shutil.copy(final_output, target_hp_dir)
        shutil.copy(srt_path, target_hp_dir)
        for c in approved_clips:
            shutil.copy(c, target_hp_dir)
        print(f" 📲 Tersalin otomatis ke Memori HP: /sdcard/Download/Broll_Clips/{os.path.basename(final_output)}")
    except Exception as e:
        print(f" [!] Info salin ke memori HP: {e}")
    print("=====================================================")

if __name__ == "__main__":
    main()
PYEOF

echo "✅ Pembaruan selesai! Gunakan flag --lang id atau --lang en saat eksekusi."
