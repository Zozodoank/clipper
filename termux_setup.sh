#!/bin/bash
# Panduan Setup Clipper Tahap 2 di Termux (proot-distro) Android

# 1. Buka aplikasi Termux di HP Android Anda, dan jalankan perintah berikut:
termux-setup-storage
termux-wake-lock
pkg update && pkg upgrade -y
pkg install proot-distro -y

# 2. Install dan masuk ke dalam environment Ubuntu
proot-distro install ubuntu
proot-distro login ubuntu

# --- MULAI DARI SINI ANDA BERADA DI DALAM UBUNTU PROOT ---

# 3. Update repository dan install dependensi sistem (Python, FFmpeg, git)
apt update && apt upgrade -y
apt install python3 python3-pip python3-venv ffmpeg git -y

# 4. Clone atau copy project Clipper ke dalam Termux
# (Asumsikan Anda sudah meng-copy folder clipper ke dalam termux)
# cd /path/to/clipper

# 5. Buat virtual environment dan install dependensi Python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt kaggle

# 6. Jalankan autentikasi OAuth untuk yt-dlp secara langsung!
# Karena Anda berada di HP, Anda bisa langsung tap/klik link yang muncul.
yt-dlp --username oauth2 --password '' "https://www.youtube.com/watch?v=gT8_G0lW310"
# Selesaikan login di browser HP Anda. Cache akan otomatis tersimpan.
# CATATAN: Setting DISABLE_COOKIES=true di config tetap aman karena auth yt-dlp via OAuth sudah di-cache terpisah!

# 7. Konfigurasi .env
# Buat file .env dan atur kredensial Anda.
# Dapatkan Token Kaggle dari https://kaggle.com -> Settings -> API -> Create New Token
# Anda juga butuh NGROK_AUTH_TOKEN (opsional jika kaggle secrets diatur)
cat <<EOF > .env
GEMINI_API_KEY=Kunci_Gemini_Anda
KAGGLE_USERNAME=Username_Kaggle_Anda
KAGGLE_KEY=Key_Kaggle_Anda
NGROK_AUTH_TOKEN=Token_Ngrok_Anda
PORT=5000
EOF

# 8. Jalankan Auto-Start Kaggle Oracle dan FastAPI Backend di Termux
bash scripts/start_termux.sh
