# 🎬 Local AI Affiliate Clipper

A local web application built with **React (Vite)** and **Node.js (Express)** that automates transforming YouTube videos into viral, high-converting **9:16 vertical reels** for **Shopee Affiliate Marketing**.

Powered by **Aivene AI (`gemini-1.5-flash`)**, **yt-dlp**, and **FFmpeg** anti-detection video rendering with burned-in subtitles and Indonesian voiceover generation.

---

## 🌟 Key Features

1. **YouTube Downloader**: Automatically downloads source videos at 720p resolution using `yt-dlp`.
2. **Visual Keyframe Sampling**: Samples 1 frame every 2 seconds via `ffmpeg` and converts to Base64.
3. **AI Vision & Affiliate Scripting**:
   - Analyzes frames with **Aivene API** (`baseURL: 'https://api.aivene.com/v1'`, model: `gemini-1.5-flash`).
   - Identifies the best **15-30 second viral highlight segment** (`startTime`, `endTime`).
   - Produces a high-converting **Indonesian voiceover script** and **social media caption** with viral hashtags and embedded Shopee CTA link.
4. **Indonesian Voiceover Synthesis (TTS)**: Synthesizes high quality Indonesian promotional audio.
5. **Anti-Detection FFmpeg Rendering Pipeline**:
   - Crops & scales to **9:16 vertical ratio (720x1280)**.
   - Adjusts video speed to **1.03x** (`setpts=0.97*PTS`) to alter frame timing.
   - Modifies color fingerprint with contrast & saturation tweaks (`eq=contrast=1.05:saturation=1.05`).
   - Reverses orientation with **Horizontal Flip (`hflip`)** filter.
   - Layers TTS voiceover audio over ducked background sound.
   - Burns synchronized, high-contrast **subtitles** into the video.
6. **Local Preview & Instant Download**:
   - HTML5 9:16 Video Player preview.
   - 1-Click Copy for Instagram/Facebook Reels Caption with hashtags and Shopee affiliate link.
   - Direct download button for the rendered `.mp4` file.
   - Automatic temp file cleanup.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons.
- **Backend**: Node.js, Express.js, Server-Sent Events (SSE).
- **Engines**: FFmpeg (`ffmpeg-static`), yt-dlp (`yt-dlp-wrap` / binary).
- **AI Integration**: Official `openai` npm package configured for Aivene (`https://api.aivene.com/v1`).

---

## 📋 Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)
- **Aivene API Key** (from [aivene.com](https://aivene.com))

> [!NOTE]
> `ffmpeg-static` is bundled in the server dependencies, and `yt-dlp` will auto-download its standalone executable to `./server/bin/` if not present in your system PATH.

---

## 🚀 Step-by-Step Installation & Execution

### 1. Clone or Open Project Directory
```bash
cd Clippers
```

### 2. Install Dependencies
You can install dependencies for both backend and frontend in one command:
```bash
npm run install:all
```
*Or manually:*
```bash
cd server && npm install
cd ../client && npm install
```

### 3. (Optional) Configure Environment Variables
You can copy the server `.env.example` to `.env`:
```bash
# In server directory
cp .env.example .env
```
You can also input your Aivene API key directly into the Web UI.

### 4. Run Development Servers
Start both backend (Port 5000) and frontend (Port 3000) concurrently:
```bash
npm run dev
```

*Or start them in separate terminals:*
```bash
# Terminal 1 - Backend:
npm run server:dev

# Terminal 2 - Frontend:
npm run client
```

### 5. Access the Web Application
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 📱 How to Use

1. **Enter YouTube Video URL**: Paste the link of the product unboxing or review video.
2. **Enter Shopee Affiliate Link**: Paste your Shopee product referral/affiliate link.
3. **Enter Aivene API Key**: Paste your API key (it will be saved locally in your browser).
4. **Customize Anti-Detection Filters (Optional)**: Click **Settings** to toggle horizontal flip, adjust speed (1.00x - 1.08x), subtitle burning, or voice profile.
5. **Click "Generate Local Clip"**:
   - Watch the live step-by-step progress bar and logs.
   - When finished, preview the 9:16 vertical video in the player.
   - Click **Copy Caption** to copy the generated caption + Shopee link.
   - Click **Download 9:16 Video (.mp4)** to save the video to your local disk.

---

## 📁 Project Structure

```
Clippers/
├── dev-runner.js             # Root launcher script for concurrent client & server
├── package.json              # Root workspace management
├── README.md                 # Documentation and instructions
│
├── server/                   # Backend Express Engine
│   ├── package.json
│   ├── server.js             # API routes (/api/generate, /api/progress, /api/video, etc.)
│   ├── .env.example
│   ├── services/
│   │   ├── binaryChecker.js  # Resolves & auto-downloads FFmpeg & yt-dlp executables
│   │   ├── downloader.js     # Downloads 720p video via yt-dlp
│   │   ├── frameExtractor.js # Extracts 1 frame / 2s and Base64 encodes
│   │   ├── aiService.js      # Aivene API gemini-1.5-flash vision analysis & TTS
│   │   ├── subtitleService.js# Generates timed SRT subtitles
│   │   ├── videoRenderer.js  # FFmpeg anti-detection rendering pipeline
│   │   └── cleaner.js        # Cleans up intermediate temp files
│   ├── temp/                 # Temporary storage (auto-cleaned)
│   ├── output/               # Rendered 9:16 MP4 video outputs
│   └── bin/                  # Local standalone executables
│
└── client/                   # Frontend React (Vite) Application
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── index.css
        ├── App.jsx
        └── components/
            ├── Navbar.jsx
            ├── DependenciesStatus.jsx
            ├── InputCard.jsx
            ├── ProgressCard.jsx
            ├── VideoPlayer.jsx
            ├── CaptionCard.jsx
            └── SettingsModal.jsx
```

---

## 🛡️ Anti-Detection Video Filters Explained

- **9:16 Aspect Ratio (720x1280)**: Converts widescreen landscape videos into vertical reels.
- **Speed Multiplier (1.03x / `0.97*PTS`)**: Modifies video playback speed and audio tempo to disrupt audio-visual fingerprint hash matching.
- **Color EQ Alteration (`contrast=1.05:saturation=1.05:brightness=0.01`)**: Alters RGB histograms and pixel values.
- **Horizontal Flip (`hflip`)**: Reverses left/right orientation to bypass perceptual video matching algorithms.
- **Voiceover Layering & Subtitles**: Generates fresh Indonesian promotional voiceover and burns styled subtitle typography onto the frame.
