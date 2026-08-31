# 🎬 Local AI Affiliate Clipper

A local web application built with **React (Vite)** and **Node.js (Express)** that automates transforming YouTube videos into viral, high-converting **9:16 vertical reels** for **Shopee Affiliate Marketing**.

Powered by **Google Gemini 2.5 Flash** (100% Free - 1,500 video/day for faceless product clipping, crop focus, and Ad Advisor scripting) with **Aivene AI** as fallback, **yt-dlp**, and **FFmpeg** anti-detection rendering with voiceover upload and synchronized subtitle burning.

---

## 🌟 2-Stage Workflow Overview

```mermaid
flowchart TD
    subgraph TAHAP 1: Clipping & Scripting AI
        A[Judul & Deskripsi Produk + URL YouTube + Link Shopee] --> B[yt-dlp: Unduh Ringan 360p]
        B --> C[FFmpeg: Ekstraksi 36 Frame Sumber]
        C --> D[Google Gemini 2.5 Flash: Pilih Highlight Faceless + Fokus Crop Produk]
        D --> E[yt-dlp: Unduh 1080p Full HD + FFmpeg Render Crop 9:16]
        E --> F[FFmpeg: Ekstraksi Frame Video Potongan]
        F --> G[Google Gemini 2.5 Flash: Buat Kotak Scene, Context & Naskah Akurat]
        G --> H[Preview 9:16 Muted Clip + Kotak Scene + Naskah]
    end

    subgraph TAHAP 2: Upload Voiceover & Burn Subtitle
        H --> I[User Generate TTS di Google AI Studio]
        I --> J[User Upload File .mp3 ke Aplikasi]
        J --> K[Backend: Generate Subtitle Sinkron .ass]
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

## 🚀 Cara Menjalankan Aplikasi Secara Lokal / Termux

### 1. Buka Terminal di Folder Proyek
```bash
cd "c:\Users\SEMOGA AWET\Documents\clipper"
# atau di Termux: cd ~/clipper
```

### 2. Jalankan Server & Client Bersamaan
```bash
npm run dev
```

> **Alamat Layanan:**
> - **Frontend (React/Vite)**: `http://localhost:3000`
> - **Backend (Express API)**: `http://localhost:5000`

---

## 📱 Panduan Penggunaan 2-Tahap

1. **Tahap 1 (Clipping & Scripting)**:
   - Pastikan `GEMINI_API_KEY` sudah terisi di file `server/.env` (Dapatkan gratis di [aistudio.google.com](https://aistudio.google.com)).
   - Masukkan **Judul / Nama Produk** (Contoh: *Mini Portable Blender USB 350ml Rechargeable*).
   - Masukkan **Deskripsi & Spesifikasi Produk** (Poin penting & keunggulan barang).
   - Masukkan **YouTube Video URL** dan **Shopee Affiliate Link**.
   - Klik **"Generate Kotak Scene & Video 9:16"**.
   - **Google Gemini 2.5 Flash** menganalisis 36 frame visual, memilih cuplikan peragaan produk tanpa wajah, dan membuat Kotak Scene & Naskah Ad Advisor.
   - **FFmpeg** merender video 9:16 bersih tanpa audio bawaan YouTube.
2. **Tahap 2 (Upload Voiceover & Finalisasi)**:
   - Buka tab **Prompt Google AI Studio** atau **Naskah Voiceover** dan copy teksnya.
   - Generate audio TTS di [Google AI Studio](https://aistudio.google.com) lalu download file `.mp3`.
   - Drag & drop file `.mp3` ke kotak **Tahap 2: Upload Voiceover AI Studio**.
   - Klik **"Gabungkan Voiceover & Bakar Subtitle (Final Video)"**.
   - Preview video final dengan subtitle dan klik **Download Video .mp4 (Final with Subtitles)**.

---

## ☁️ Panduan Codespaces & Termux (Hemat Kuota)

Aplikasi secara default mengaktifkan fitur **Smart Two-Stage Download** untuk menghemat kuota internet hingga **90%**:
1. **Tahap 1 (Analisa Ringan 360p):** Video diunduh dalam format ultra-ringan (hanya berukuran **~1 - 3 MB**) untuk diekstrak framenya dan dianalisis oleh AI Vision.
2. **Eliminasi Cepat:** Jika kandidat video tidak cocok, kandidat langsung dibuang tanpa mengunduh video berat.
3. **Tahap 2 (Unduh 1080p Full HD HANYA untuk Video yang Lolos):** Begitu AI memvalidasi video layak dipotong, barulah sistem mendownload video 1080p Full HD asli untuk proses pemotongan 9:16 vertikal dan dubbing voiceover.

*(Opsional)* Anda dapat mengatur `LOW_DATA_MODE=true` atau `LOW_DATA_MODE=false` di file `server/.env`.
