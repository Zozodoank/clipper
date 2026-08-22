# 🎬 Local AI Affiliate Clipper

A local web application built with **React (Vite)** and **Node.js (Express)** that automates transforming YouTube videos into viral, high-converting **9:16 vertical reels** for **Shopee Affiliate Marketing**.

Powered by **Aivene AI (`gpt-4o-mini` & `gemini-1.5-flash`)**, **Google AI Studio Ad Advisor Standards**, **yt-dlp**, and **FFmpeg** anti-detection video rendering.

---

## 🌟 Key Features

1. **YouTube Downloader**: Automatically downloads source videos at 720p resolution using `yt-dlp`.
2. **Visual Keyframe Sampling**: Samples 1 frame every 2 seconds via `ffmpeg` and converts to Base64.
3. **Ad Advisor AI Analysis (`gpt-4o-mini`)**:
   - **🎬 Kotak Scene (Scene Breakdown)**: Detailed scene-by-scene timing (`timeRange`), visual cue descriptions (`visualDescription`), exact spoken line (`voiceover`), and director notes (`adAdvisorNotes`).
   - **📋 Sample Context**: Comprehensive product summary, unique selling points (USPs), target audience, and psychological buying triggers.
   - **🎙️ Voiceover Script (Indonesian)**: Structured according to Ad Advisor best practices:
     - `[HOOK 0-3s]`: Viral hook to stop the scroll
     - `[DEMO & BENEFIT 3-15s]`: Highlighting product value seen in visual frames
     - `[CALL TO ACTION 15-30s]`: Clear Shopee affiliate checkout CTA
   - **🤖 Google AI Studio / Gemini Manual Prompt**: Pre-formatted copyable prompt template ready to copy-paste into Google AI Studio or Gemini for manual fine-tuning.
   - **📱 Reels & TikTok Caption**: Viral caption with emojis, trending hashtags, and embedded Shopee affiliate link.
4. **Anti-Detection FFmpeg Rendering Pipeline**:
   - Crops & scales to **9:16 vertical ratio (720x1280)**.
   - Alters video speed to **1.03x** (`setpts=0.97*PTS`, audio `atempo=1.03`) to alter frame timing.
   - Modifies color fingerprint with contrast & saturation tweaks (`eq=contrast=1.05:saturation=1.05`).
   - Reverses orientation with **Horizontal Flip (`hflip`)** filter.
   - Preserves crisp synchronized audio.
5. **Local Preview & Instant Download**:
   - HTML5 9:16 Video Player preview.
   - 1-Click Copy for all 5 creative assets (Kotak Scene, Script, Context, Prompt, Caption).
   - Direct download button for the rendered `.mp4` file.
   - Automatic temp file cleanup.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons.
- **Backend**: Node.js, Express.js, Server-Sent Events (SSE).
- **Engines**: FFmpeg (`ffmpeg-static`), yt-dlp (`yt-dlp-wrap` / binary).
- **AI Integration**: Official `openai` npm package configured for Aivene (`https://api.aivene.com/v1`, models: `gpt-4o-mini`, `gemini-1.5-flash`).

---

## 🚀 Step-by-Step Installation & Execution

### 1. Open Terminal in the Project Directory
```powershell
cd "c:\Users\SEMOGA AWET\Documents\Clippers"
```

### 2. Install Dependencies (If not already installed)
```powershell
npm run install:all
```

### 3. Run Development Servers
Start both backend (Port 5000) and frontend (Port 3000) concurrently:
```powershell
npm run dev
```

### 4. Access the Web Application
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 📱 How to Use

1. **Select Model**: Choose **gpt-4o-mini** (Recommended for Ad Advisor scene breakdown & scripts) or **gemini-1.5-flash**.
2. **Enter YouTube Video URL**: Paste the link of the product review or unboxing video.
3. **Enter Shopee Affiliate Link**: Paste your Shopee referral link.
4. **Enter Aivene API Key**: Paste your API key (saved locally in browser).
5. **Click "Generate Local Clip & Script"**:
   - The engine downloads the video, samples frames, and analyzes them with Ad Advisor logic.
   - Once finished, preview the 9:16 video and access all 5 generated assets in the tabbed panel:
     - **Kotak Scene**: Copy scene-by-scene breakdown for manual editing or storyboard.
     - **Script Voiceover**: Copy the complete Indonesian spoken narration.
     - **Sample Context**: Review target audience, core problem, and USPs.
     - **AI Studio Prompt**: Copy-paste into Google AI Studio / Gemini to experiment with alternate scripts.
     - **Caption & Shopee Link**: Copy ready-to-post caption with hashtags and link.
   - Click **Download 9:16 Video (.mp4)** to save the video to your disk.
