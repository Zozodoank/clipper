#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "====================================================="
echo " [1/4] Menginstal Dependensi Ringan (Bebas Error Rust)"
echo "====================================================="
pip install -U yt-dlp requests tqdm

echo "====================================================="
echo " [2/4] Membuat Direktori Kerja & Symlink Memori HP"
echo "====================================================="
mkdir -p ~/broll-agent/output_clips
cd ~/broll-agent
if [ ! -L ~/broll-agent/hp_downloads ]; then
    ln -s ~/storage/downloads ~/broll-agent/hp_downloads || true
fi

echo "====================================================="
echo " [3/4] Mengunduh Model Deteksi Wajah YuNet ONNX"
echo "====================================================="
if [ ! -f "face_detection_yunet.onnx" ]; then
    wget -q --show-progress -O face_detection_yunet.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
fi

echo "====================================================="
echo " [4/4] Merakit Aplikasi auto_broll_agent.py"
echo "====================================================="
cat << 'PYEOF' > ~/broll-agent/auto_broll_agent.py
import os
import sys
import cv2
import json
import time
import base64
import shutil
import argparse
import subprocess
import numpy as np
import requests
from tqdm import tqdm

# Kata kunci fitur HP (Bahasa Indonesia & Inggris)
FEATURE_KEYWORDS = [
    "kamera", "layar", "baterai", "chipset", "performa", "desain", "bodi",
    "gaming", "speaker", "charging", "cas", "ram", "storage", "memori",
    "antutu", "fps", "suhu", "panas", "fitur", "spesifikasi", "amoled",
    "ips", "refresh rate", "hz", "megapixel", "mp", "ois", "stabil",
    "camera", "display", "screen", "battery", "performance", "design"
]

def download_video_and_subs(url, work_dir):
    print("\n[*] Mengunduh video 1080p dan transkrip dari YouTube...")
    video_out = os.path.join(work_dir, "source_video.mp4")
    if os.path.exists(video_out):
        os.remove(video_out)

    cmd = [
        "yt-dlp",
        "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--write-auto-sub", "--write-sub",
        "--sub-lang", "id,en",
        "--sub-format", "json3",
        "-o", os.path.join(work_dir, "source_video.%(ext)s"),
        url
    ]
    subprocess.run(cmd, check=True)
    
    sub_file = None
    for f in os.listdir(work_dir):
        if f.startswith("source_video") and f.endswith(".json3"):
            sub_file = os.path.join(work_dir, f)
            break
    return video_out, sub_file

def parse_feature_windows(sub_file, total_duration):
    if not sub_file or not os.path.exists(sub_file):
        print("[!] Subtitle tidak ditemukan. Memindai 80% bagian tengah video (skip intro/outro).")
        return [(total_duration * 0.08, total_duration * 0.92)]

    print(f"[*] Menganalisis transkrip ({os.path.basename(sub_file)}) untuk mencari pembahasan fitur...")
    try:
        with open(sub_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        events = data.get("events", [])
        windows = []
        for ev in events:
            segs = ev.get("segs", [])
            text = "".join([s.get("utf8", "") for s in segs]).lower()
            if any(k in text for k in FEATURE_KEYWORDS):
                start_s = ev.get("tStartMs", 0) / 1000.0
                dur_s = ev.get("dDurationMs", 5000) / 1000.0
                # Perlebar window +- 4 detik karena B-roll sering muncul sesaat setelah diucapkan
                w_start = max(5.0, start_s - 2.0)
                w_end = min(total_duration - 5.0, start_s + dur_s + 4.0)
                windows.append((w_start, w_end))

        if not windows:
            return [(total_duration * 0.08, total_duration * 0.92)]

        # Gabungkan window yang tumpang tindih
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
    except Exception as e:
        print(f"[!] Gagal memproses subtitle ({e}), memindai area utama video.")
        return [(total_duration * 0.08, total_duration * 0.92)]

def is_in_windows(t, windows):
    for w_start, w_end in windows:
        if w_start <= t <= w_end:
            return True
    return False

def crop_center_9_16(frame):
    h, w = frame.shape[:2]
    crop_w = int(h * 9 / 16)
    crop_w = crop_w - (crop_w % 2)
    start_x = int((w - crop_w) / 2)
    return frame[0:h, start_x:start_x + crop_w]

def scan_face_free_segments(video_path, model_path, feature_windows, min_duration=2.8):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    ret, sample_frame = cap.read()
    if not ret:
        raise RuntimeError("Gagal membaca video sumber.")
    
    roi_sample = crop_center_9_16(sample_frame)
    roi_h, roi_w = roi_sample.shape[:2]

    # Inisialisasi YuNet Face Detector khusus untuk ukuran crop 9:16
    detector = cv2.FaceDetectorYN.create(
        model=model_path,
        config="",
        input_size=(roi_w, roi_h),
        score_threshold=0.55,
        nms_threshold=0.3,
        top_k=5000
    )

    step_sec = 0.5  # Sampling 2 FPS
    step_frames = max(1, int(fps * step_sec))
    
    timestamps = []
    face_flags = []

    print(f"\n[*] Memindai area tengah 9:16 ({roi_w}x{roi_h}) dengan YuNet ONNX...")
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
        has_face = 1 if (faces is not None and len(faces) > 0) else 0
        
        timestamps.append(t)
        face_flags.append(has_face)

    cap.release()

    # Algoritma Hysteresis Smoothing:
    # Abaikan 1 frame false-positive jika diapit oleh frame bersih (0, 1, 0 -> 0, 0, 0)
    smoothed = list(face_flags)
    for i in range(1, len(smoothed) - 1):
        if smoothed[i] == 1 and smoothed[i - 1] == 0 and smoothed[i + 1] == 0:
            smoothed[i] = 0

    # Kelompokkan menjadi segmen kandidat bebas wajah
    candidates = []
    seg_start = None
    prev_t = None

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
            if seg_start is not None and prev_t is not None:
                if (prev_t - seg_start) >= min_duration:
                    candidates.append((seg_start, prev_t))
            seg_start = None
            prev_t = None

    if seg_start is not None and prev_t is not None and (prev_t - seg_start) >= min_duration:
        candidates.append((seg_start, prev_t))

    print(f"[+] Ditemukan {len(candidates)} kandidat segmen bebas wajah (durasi >= {min_duration}s).")
    return candidates

def build_storyboard_base64(video_path, start_s, end_s):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    mid_s = (start_s + end_s) / 2.0
    sample_times = [start_s + 0.25, mid_s, max(start_s + 0.3, end_s - 0.25)]
    
    crops = []
    for t in sample_times:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ret, frame = cap.read()
        if ret:
            roi = crop_center_9_16(frame)
            # Perkecil ke tinggi 640px agar hemat kuota & cepat dikirim
            h, w = roi.shape[:2]
            scale = 640.0 / h
            resized = cv2.resize(roi, (int(w * scale), 640))
            crops.append(resized)
    cap.release()

    if not crops:
        return None
    # Gabungkan 3 frame (Awal, Tengah, Akhir) secara horizontal
    storyboard = np.hstack(crops)
    _, buf = cv2.imencode(".jpg", storyboard, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    return base64.b64encode(buf).decode("utf-8")

def verify_with_gemini_vision(b64_img, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    prompt = (
        "Gambar ini berisi 3 frame berurutan (awal, tengah, akhir) hasil crop 9:16 dari video review HP.\n"
        "Evaluasi dengan aturan KETAT berikut:\n"
        "1. TOLAK (has_face = true) jika ada wajah manusia (reviewer/orang lain) yang terlihat.\n"
        "2. TOLAK (has_editor_overlay = true) HANYA JIKA ada subtitle pembicara, teks spesifikasi tambahan dari editor video, lower-third, atau grafis animasi promosi di layar.\n"
        "3. IZINKAN (has_editor_overlay = false) jika teks yang terlihat adalah TEKS FISIK NYATA: tulisan merek/kamera di bodi HP (misal '50MP OIS'), tampilan UI/teks di dalam layar HP yang sedang dipegang, tulisan di kotak HP, atau objek nyata di background meja.\n"
        "4. Pastikan gambar benar-benar menyorot produk HP/fitur (is_product_broll = true).\n"
        "Kembalikan HANYA format JSON murni sesuai skema."
    )

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": b64_img}}
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "is_product_broll": {"type": "BOOLEAN"},
                    "has_face": {"type": "BOOLEAN"},
                    "has_editor_overlay": {"type": "BOOLEAN"},
                    "reason": {"type": "STRING"}
                },
                "required": ["is_product_broll", "has_face", "has_editor_overlay", "reason"]
            }
        }
    }

    for attempt in range(3):
        try:
            resp = requests.post(url, json=payload, timeout=30)
            if resp.status_code == 429:
                time.sleep(4 * (attempt + 1))
                continue
            resp.raise_for_status()
            data = resp.json()
            text_out = data["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text_out)
        except Exception as e:
            if attempt == 2:
                print(f" [!] Error API Vision: {e}")
            time.sleep(2)
    return None

def render_clean_clip(video_path, start_s, end_s, out_path, keep_audio=False):
    # Safety trimming 0.2 detik di ujung awal & akhir agar bersih dari transisi
    safe_start = start_s + 0.2
    safe_dur = (end_s - 0.2) - safe_start
    if safe_dur < 1.8:
        return False

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{safe_start:.2f}",
        "-i", video_path,
        "-t", f"{safe_dur:.2f}",
        "-vf", "crop=ih*9/16:ih:(iw-ow)/2:0,scale=1080:1920:flags=lanczos",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20"
    ]
    if keep_audio:
        cmd += ["-c:a", "aac", "-b:a", "128k"]
    else:
        cmd += ["-an"]

    cmd.append(out_path)
    subprocess.run(cmd, check=True)
    return True

def main():
    parser = argparse.ArgumentParser(description="AI Agent Pemotong B-Roll HP 9:16 Bersih")
    parser.add_argument("--url", required=True, help="Link YouTube video review HP")
    parser.add_argument("--api-key", default=os.environ.get("GEMINI_API_KEY"), help="Gemini API Key")
    parser.add_argument("--min-duration", type=float, default=2.8, help="Durasi minimal klip (detik)")
    parser.add_argument("--max-clips", type=int, default=15, help="Batas maksimal klip yang diekstrak")
    parser.add_argument("--keep-audio", action="store_true", help="Pertahankan suara asli video")
    parser.add_argument("--merge", action="store_true", help="Gabungkan semua klip bersih jadi 1 video")
    args = parser.parse_args()

    if not args.api_key:
        print("[ERROR] Harap masukkan Gemini API Key dengan --api-key atau export GEMINI_API_KEY='...'")
        sys.exit(1)

    work_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(work_dir, "face_detection_yunet.onnx")
    out_dir = os.path.join(work_dir, "output_clips")
    os.makedirs(out_dir, exist_ok=True)

    video_path, sub_file = download_video_and_subs(args.url, work_dir)
    
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_dur = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
    cap.release()

    windows = parse_feature_windows(sub_file, total_dur)
    candidates = scan_face_free_segments(video_path, model_path, windows, args.min_duration)

    approved_clips = []
    print("\n[*] Memverifikasi kebersihan teks editor vs teks fisik produk dengan Gemini Vision API...")
    for idx, (s_start, s_end) in enumerate(candidates):
        if len(approved_clips) >= args.max_clips:
            break
        
        # Pecah segmen yang terlalu panjang (> 8 detik) agar lebih dinamis untuk Shorts
        sub_segments = []
        curr = s_start
        while (s_end - curr) > 8.0:
            sub_segments.append((curr, curr + 6.0))
            curr += 6.0
        if (s_end - curr) >= args.min_duration:
            sub_segments.append((curr, s_end))

        for sub_s, sub_e in sub_segments:
            if len(approved_clips) >= args.max_clips:
                break
            b64 = build_storyboard_base64(video_path, sub_s, sub_e)
            if not b64:
                continue
            res = verify_with_gemini_vision(b64, args.api_key)
            if not res:
                continue

            is_clean = (
                res.get("is_product_broll") is True
                and res.get("has_face") is False
                and res.get("has_editor_overlay") is False
            )
            status = "LOLOS" if is_clean else "DITOLAK"
            print(f" -> [{sub_s:.1f}s - {sub_e:.1f}s] {status} | Alasan: {res.get('reason')}")

            if is_clean:
                clip_name = f"broll_{len(approved_clips)+1:02d}_{int(sub_s)}s_{int(sub_e)}s.mp4"
                clip_path = os.path.join(out_dir, clip_name)
                if render_clean_clip(video_path, sub_s, sub_e, clip_path, args.keep_audio):
                    approved_clips.append(clip_path)

    print(f"\n=====================================================")
    print(f" SELESAI! Berhasil mengekstrak {len(approved_clips)} klip B-Roll 9:16 Bersih.")
    print(f" Lokasi file: {out_dir}")

    # Salin otomatis ke folder Download HP jika symlink tersedia
    hp_dl = os.path.join(work_dir, "hp_downloads")
    if os.path.exists(hp_dl) and approved_clips:
        target_hp_dir = os.path.join(hp_dl, "Broll_Clips")
        os.makedirs(target_hp_dir, exist_ok=True)
        for c in approved_clips:
            shutil.copy(c, target_hp_dir)
        print(f" Tersalin otomatis ke Memori Internal HP: Download/Broll_Clips/")

    if args.merge and len(approved_clips) > 1:
        list_file = os.path.join(out_dir, "concat_list.txt")
        with open(list_file, "w") as f:
            for c in approved_clips:
                f.write(f"file '{os.path.abspath(c)}'\n")
        merged_out = os.path.join(out_dir, "FINAL_MERGED_BROLL_9_16.mp4")
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
            "-i", list_file, "-c", "copy", merged_out
        ], check=True)
        print(f" Video Gabungan Siap: {merged_out}")
        if os.path.exists(hp_dl):
            shutil.copy(merged_out, os.path.join(hp_dl, "Broll_Clips"))
    print("=====================================================")

if __name__ == "__main__":
    main()
PYEOF

echo ""
echo "✅ INSTALASI & PEMBUATAN APLIKASI SELESAI 100%!"
echo "Skrip tersimpan di: ~/broll-agent/auto_broll_agent.py"
