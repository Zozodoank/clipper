# 🎬 Local AI Affiliate Clipper

A local web application built with **React (Vite)** and **Node.js (Express)** that automates transforming YouTube videos into viral, high-converting **9:16 vertical reels** for **Shopee Affiliate Marketing**.

Powered by **Aivene gemini-3.7-flash** (30-60s faceless visual highlight clipping, product-aware crop focus, and Ad Advisor scripting), **yt-dlp**, and **FFmpeg** anti-detection rendering with voiceover upload and bottom-safe synchronized subtitle burning.

---

## 🌟 2-Stage Workflow Overview

```mermaid
flowchart TD
    subgraph TAHAP 1: Clipping & Scripting AI
        A[Judul & Deskripsi Produk + URL YouTube + Link Shopee] --> B[yt-dlp: Unduh 720p]
        B --> C[FFmpeg: Ekstraksi Frame Sumber]
        C --> D[Gemini 3.7 Flash: Pilih Highlight Faceless + Fokus Crop Produk]
        D --> E[FFmpeg: Render Crop Produk/Tangan 9:16 Tanpa Suara -an]
        E --> F[FFmpeg: Ekstraksi Frame Video Potongan]
        F --> G[Gemini 3.7 Flash: Buat Kotak Scene, Context & Naskah Akurat]
        G --> H[Preview 9:16 Muted Clip + Kotak Scene + Naskah]
    end

    subgraph TAHAP 2: Upload Voiceover & Burn Subtitle
        H --> I[User Generate TTS di Google AI Studio]
        I --> J[User Upload File .mp3 ke Aplikasi]
        J --> K[Backend: Generate Subtitle Sinkron .srt]
        K --> L[FFmpeg: Gabung Audio + Bakar Subtitle Kontras]
        L --> M[Video Final 9:16 Siap Upload + Download Button]
    end
```

---

## 🎯 5 Output Tab Kreatif Siap Pakai

1. **🎬 Kotak Scene**: Rincian per adegan (`timeRange`, deskripsi visual adegan, teks narasi spoken line, dan catatan sutradara *Ad Advisor* seperti SFX & text-on-screen).
2. **📋 Sample Context**: Rangkuman nama produk, target audiens, masalah utama yang diselesaikan (*pain points*), keunggulan utama (USPs), dan trigger psikologis pembelian.
3. **🎙️ Naskah Voiceover (ID)**: Format standar *Ad Advisor* (`[HOOK 0-3s]` → `[DEMO & BENEFIT 3-20s]` → `[VALUE PROPOSITION 20-35s]` → `[CALL TO ACTION 35-60s]`) berbasis judul & deskripsi produk spesifik.
4. **🤖 Prompt Google AI Studio**: Prompt terstruktur siap copy-paste langsung ke Google AI Studio untuk generate TTS audio.
5. **📱 Reels Caption & Shopee Link**: Caption siap posting lengkap dengan emoji, hashtag viral (#racunshopee, #spillracun, dll.), dan link Shopee Affiliate Anda.

---

## 🚀 Cara Menjalankan Aplikasi Secara Lokal

### 1. Buka Terminal di Folder Proyek
```powershell
cd "c:\Users\SEMOGA AWET\Documents\Clippers"
```

### 2. Jalankan Server & Client Bersamaan
```powershell
npm run dev
```

> **Alamat Layanan:**
> - **Frontend (React/Vite)**: `http://localhost:3000`
> - **Backend (Express API)**: `http://localhost:5000`

---

## 📱 Panduan Penggunaan 2-Tahap

1. **Tahap 1 (Clipping & Scripting)**:
   - Pastikan `AIVENE_API_KEY` sudah terisi di file `server/.env`.
   - Masukkan **Judul / Nama Produk** (Contoh: *Mini Portable Blender USB 350ml Rechargeable*).
   - Masukkan **Deskripsi & Spesifikasi Produk** (Poin penting & keunggulan barang).
   - Masukkan **YouTube Video URL** dan **Shopee Affiliate Link**.
   - Klik **"Generate Kotak Scene & Video 9:16"**.
   - **Gemini 3.7 Flash** memotong segmen 30-60 detik yang faceless, memilih fokus crop produk/tangan, dan menghindari teks bawaan video.
   - **FFmpeg** merender video 9:16 penuh tanpa suara (`-an`) tanpa bar hitam besar, dengan crop area atas untuk menghindari wajah creator.
   - **Gemini 3.7 Flash** membuat Kotak Scene, Sample Context, dan Naskah Voiceover yang akurat sesuai detail produk Anda.
2. **Tahap 2 (Upload Voiceover & Finalisasi)**:
   - Buka tab **Prompt Google AI Studio** atau **Naskah Voiceover** dan copy teksnya.
   - Generate audio TTS di [Google AI Studio](https://aistudio.google.com) lalu download file `.mp3`.
   - Drag & drop file `.mp3` ke kotak **Tahap 2: Upload Voiceover AI Studio**.
   - Klik **"Gabungkan Voiceover & Bakar Subtitle (Final Video)"**.
   - Preview video final dengan subtitle dan klik **Download Video .mp4 (Final with Subtitles)**.

---

---

## ☁️ Panduan Lengkap: Menjalankan di GitHub Codespaces / Cloud Server

Menjalankan backend di cloud server (seperti GitHub Codespaces / Azure / AWS) memerlukan penanganan khusus karena YouTube secara aktif memblokir IP Datacenter. Berikut adalah prosedur resmi dan teruji agar pencarian dan pengunduhan video berjalan 100% lancar:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 GITHUB CODESPACES                       │
                  │                                                         │
   [Search Video] ├─► RapidAPI (yt-api.p.rapidapi.com) ───────────────────► │
                  │                                                         │
 [Download Video] ├─► yt-dlp + Node JS Runtime + EJS Solver                 │
                  │        │                                                │
                  │        ▼                                                │
                  │   Cloudflare WARP (socks5://127.0.0.1:40000)            │
                  │        │                                                │
                  │        ▼                                                │
                  │   Client Spoofing (android_vr, android, ios, web) ────► │
                  └─────────────────────────────────────────────────────────┘
```

---

### 1. Konfigurasi Environment (`server/.env`)

Buat file `server/.env` di Codespace dengan konfigurasi berikut:

```env
PORT=5000

# API Key untuk AI Scripting & Visual Analysis
AIVENE_API_KEY=your_aivene_api_key_here

# RapidAPI (Digunakan untuk Search Video & Download Stream Delegasi)
RAPIDAPI_KEY=your_rapidapi_key_here
RAPIDAPI_HOST=yt-api.p.rapidapi.com

# (Opsional) Cobalt API Delegasi Ekstraksi (Bebas Blokir 100%)
# COBALT_API_URL=https://your-cobalt-instance.up.railway.app
# COBALT_API_KEY=your_optional_cobalt_token
```

---

### 2. Arsitektur 3-Tier Multi-Delegasi Downloader

Backend secara otomatis menggunakan 3 lapisan pengunduhan video:
1. **Tier 1 (Cobalt API):** Jika `COBALT_API_URL` diatur, backend akan mengirim request ke instance Cobalt untuk mengekstrak dan mengunduh video tanpa batasan scraping.
2. **Tier 2 (RapidAPI Stream Extractor):** Jika `RAPIDAPI_KEY` aktif, backend mengekstrak link stream langsung dari cluster RapidAPI dan mengunduh file video mentah tanpa login.
3. **Tier 3 (Direct Client Spoofing `ios, tv, android, web`):** Fallback yt-dlp native dengan jeda request `--sleep-requests 3` dan `--rm-cache-dir`.

---

### 3. Menjalankan Aplikasi (100% Bebas Cookies)

Tidak perlu mengekspor atau menggunakan cookie akun Google pribadi lagi. Arsitektur backend menggunakan teknik **Client Spoofing** (`android_vr`, `android`, `ios`, `web`) sehingga aman dan bebas blokir akun:

```bash
# Sinkronkan kode terbaru
git fetch origin main
git reset --hard origin/main

# Bersihkan sisa job gagal jika ada
node server/clean-failed-jobs.js

# Jalankan server
node dev-runner.js
```

---

### 🛡️ Parameter Kunci `yt-dlp` yang Digunakan Backend

Backend mengombinasikan 4 teknologi bypass otomatis tanpa cookies:
- `--extractor-args "youtube:player_client=ios,tv,android,web"` : Memanipulasi protokol player native (iOS & Smart TV) yang tidak memerlukan cookies maupun GVS PO Token.
- `--js-runtimes node` : Menggunakan engine Node.js lokal untuk mengeksekusi challenge script YouTube.
- `--remote-components ejs:github` : Mengunduh solver enkripsi *n-challenge* terbaru langsung dari repository resmi GitHub secara otomatis.
- `--proxy socks5://127.0.0.1:40000` : Melewati jaringan Cloudflare WARP jika diperlukan masking IP.


