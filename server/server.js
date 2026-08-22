import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import multer from 'multer';

import { checkSystemDependencies } from './services/binaryChecker.js';
import { downloadYouTubeVideo } from './services/downloader.js';
import { extractFrames } from './services/frameExtractor.js';
import {
  selectHighlightWithGemini25Flash,
  generateAdAdvisorScriptWithGpt4oMini
} from './services/aiService.js';
import { generateSrtSubtitles } from './services/subtitleService.js';
import {
  renderSilentAntiDetectionVideo,
  mergeVoiceoverAndBurnSubtitles
} from './services/videoRenderer.js';
import { cleanupTempFiles } from './services/cleaner.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Directories
const tempDir = path.join(__dirname, 'temp');
const outputDir = path.join(__dirname, 'output');
const uploadsDir = path.join(tempDir, 'uploads');

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage for uploaded voiceover audio
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `voiceover_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-memory active jobs registry and progress tracker
const jobProgress = new Map();
const activeJobs = new Map();

// 1. Health & Dependency Check
app.get('/api/health', async (req, res) => {
  try {
    const deps = await checkSystemDependencies();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      dependencies: deps,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 2. SSE endpoint for live progress streaming
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const current = jobProgress.get(jobId) || { step: 'init', message: 'Initializing...', progress: 0 };
  sendProgress(current);

  const interval = setInterval(() => {
    const latest = jobProgress.get(jobId);
    if (latest) {
      sendProgress(latest);
      if (latest.status === 'completed' || latest.status === 'error' || latest.status === 'awaiting_voiceover') {
        clearInterval(interval);
        res.end();
      }
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// 3. STAGE 1: Video Clipping & AI Scripting (Gemini 2.5 Flash + GPT-4o Mini)
app.post('/api/generate', async (req, res) => {
  const {
    youtubeUrl,
    shopeeLink,
    apiKey,
    options = {},
    jobId: clientJobId
  } = req.body;

  if (!youtubeUrl) {
    return res.status(400).json({ error: 'YouTube Video URL is required.' });
  }

  const jobId = clientJobId || crypto.randomBytes(6).toString('hex');
  const sessionTempDir = path.join(tempDir, `job_${jobId}`);
  const rawFramesDir = path.join(sessionTempDir, 'raw_frames');
  const trimmedFramesDir = path.join(sessionTempDir, 'trimmed_frames');
  const silentFileName = `silent_clip_${jobId}.mp4`;
  const silentOutputPath = path.join(outputDir, silentFileName);

  if (!fs.existsSync(sessionTempDir)) fs.mkdirSync(sessionTempDir, { recursive: true });

  const updateProgress = (data) => {
    const payload = typeof data === 'string'
      ? { step: 'processing', message: data, progress: 50, jobId }
      : { ...data, jobId };
    jobProgress.set(jobId, payload);
    console.log(`[Job ${jobId}] [${payload.progress || 0}%] ${payload.message}`);
  };

  updateProgress({
    step: 'start',
    message: 'Starting Stage 1: Video Clipping & AI Scripting Pipeline...',
    progress: 5,
    status: 'running'
  });

  const filesToDelete = [];
  const dirsToDelete = [rawFramesDir, trimmedFramesDir, sessionTempDir];

  try {
    // --- Step 1: Download YouTube Video at 720p (yt-dlp) ---
    updateProgress({ step: 'download', message: 'Downloading source video (720p) via yt-dlp...', progress: 12, status: 'running' });
    const { filePath: rawVideoPath, metadata: videoMeta } = await downloadYouTubeVideo(
      youtubeUrl,
      sessionTempDir,
      jobId,
      updateProgress
    );
    filesToDelete.push(rawVideoPath);

    // --- Step 2: Extract Keyframes from Raw Video ---
    updateProgress({ step: 'frames_raw', message: 'Extracting source frames for Gemini 2.5 Flash...', progress: 35, status: 'running' });
    const { frames: rawFrames } = await extractFrames(
      rawVideoPath,
      rawFramesDir,
      updateProgress
    );

    // --- Step 3: Gemini 2.5 Flash Highlight Selection (30-60s) ---
    updateProgress({
      step: 'gemini_vision',
      message: 'Gemini 2.5 Flash analyzing frames to identify best 30-60s highlight...',
      progress: 48,
      status: 'running'
    });
    const highlight = await selectHighlightWithGemini25Flash({
      apiKey,
      frames: rawFrames,
      videoMetadata: videoMeta,
      shopeeLink,
      onProgress: updateProgress,
    });

    // --- Step 4: Render 30-60s Silent 9:16 Anti-Detection Video (-an, no subs) ---
    updateProgress({
      step: 'render_silent',
      message: `Rendering 9:16 Silent Vertical Video (${highlight.startTime} - ${highlight.endTime})...`,
      progress: 62,
      status: 'running'
    });
    await renderSilentAntiDetectionVideo({
      inputVideo: rawVideoPath,
      startTime: highlight.startTime,
      endTime: highlight.endTime,
      outputVideo: silentOutputPath,
      hflip: options.hflip !== undefined ? options.hflip : true,
      speedMultiplier: options.speedMultiplier || 1.03,
      onProgress: updateProgress,
    });

    // --- Step 5: Extract Frames from the Trimmed 30-60s Silent Video for GPT-4o-mini ---
    updateProgress({
      step: 'frames_trimmed',
      message: 'Sampling frames from trimmed 30-60s video for GPT-4o-mini...',
      progress: 72,
      status: 'running'
    });
    const { frames: trimmedFrames } = await extractFrames(
      silentOutputPath,
      trimmedFramesDir,
      updateProgress
    );

    // --- Step 6: GPT-4o-mini Generates Kotak Scene, Context & Naskah ---
    updateProgress({
      step: 'gpt_scripting',
      message: 'GPT-4o-mini generating Kotak Scene, Sample Context, and Naskah Voiceover...',
      progress: 80,
      status: 'running'
    });
    const scriptData = await generateAdAdvisorScriptWithGpt4oMini({
      apiKey,
      trimmedFrames,
      videoMetadata: videoMeta,
      shopeeLink,
      productHook: highlight.productHook,
      segmentDuration: highlight.duration,
      onProgress: updateProgress,
    });

    // Clean up temporary frame folders and raw downloads
    cleanupTempFiles(filesToDelete, dirsToDelete);

    // Store Job State in Memory for Stage 2
    const stage1Result = {
      jobId,
      stage: 'awaiting_voiceover',
      silentFileName,
      silentVideoUrl: `/api/video/${silentFileName}`,
      silentLocalPath: silentOutputPath,
      highlight: {
        startTime: highlight.startTime,
        endTime: highlight.endTime,
        duration: highlight.duration,
      },
      productHook: highlight.productHook,
      sampleContext: scriptData.sampleContext,
      scenes: scriptData.scenes,
      voiceoverScript: scriptData.voiceoverScript,
      aiStudioPrompt: scriptData.aiStudioPrompt,
      caption: scriptData.caption,
      shopeeLink: shopeeLink || '',
      videoTitle: videoMeta.title,
    };

    activeJobs.set(jobId, stage1Result);

    updateProgress({
      step: 'awaiting_voiceover',
      message: 'Stage 1 Complete! Kotak Scene, Naskah, and Muted 9:16 Video Ready. Upload your voiceover to finalize.',
      progress: 100,
      status: 'awaiting_voiceover',
      result: stage1Result
    });

    res.json(stage1Result);
  } catch (error) {
    console.error(`[Job ${jobId}] Stage 1 Pipeline Error:`, error);
    cleanupTempFiles(filesToDelete, dirsToDelete);

    updateProgress({
      step: 'error',
      message: error.message || 'An error occurred during video processing.',
      progress: 0,
      status: 'error',
      error: error.message
    });

    res.status(500).json({ success: false, error: error.message, jobId });
  }
});

// 4. STAGE 2: Upload Voiceover Audio & Merge Subtitles (Final Video)
app.post('/api/upload-voiceover', upload.single('audio'), async (req, res) => {
  const { jobId } = req.body;
  const audioFile = req.file;

  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required.' });
  }
  if (!audioFile) {
    return res.status(400).json({ error: 'Voiceover audio file is required (.mp3, .wav, .m4a).' });
  }

  const job = activeJobs.get(jobId);
  if (!job || !fs.existsSync(job.silentLocalPath)) {
    return res.status(404).json({ error: 'Job session expired or silent video not found. Please regenerate Stage 1.' });
  }

  const finalFileName = `final_clip_${jobId}.mp4`;
  const finalOutputPath = path.join(outputDir, finalFileName);
  const srtPath = path.join(uploadsDir, `subtitles_${jobId}.srt`);

  const updateProgress = (data) => {
    const payload = typeof data === 'string'
      ? { step: 'processing', message: data, progress: 50, jobId }
      : { ...data, jobId };
    jobProgress.set(jobId, payload);
    console.log(`[Job ${jobId}] [${payload.progress || 0}%] ${payload.message}`);
  };

  updateProgress({
    step: 'merge_start',
    message: 'Starting Stage 2: Merging voiceover & burning synchronized subtitles...',
    progress: 20,
    status: 'running'
  });

  try {
    // 1. Generate Synchronized Subtitles (.srt) from Naskah
    updateProgress({ step: 'subtitles', message: 'Generating synchronized subtitle captions...', progress: 40, status: 'running' });
    generateSrtSubtitles(job.voiceoverScript, job.highlight?.duration || 45, srtPath);

    // 2. FFmpeg Merge Audio + Burn Subtitles
    updateProgress({ step: 'render_final', message: 'Rendering final 9:16 video with Voiceover & Subtitles...', progress: 60, status: 'running' });
    await mergeVoiceoverAndBurnSubtitles({
      silentVideoPath: job.silentLocalPath,
      voiceoverAudioPath: audioFile.path,
      srtPath,
      outputVideoPath: finalOutputPath,
      onProgress: updateProgress,
    });

    // 3. Clean up uploaded voiceover and srt
    cleanupTempFiles([audioFile.path, srtPath]);

    const finalResult = {
      ...job,
      stage: 'completed',
      finalFileName,
      videoUrl: `/api/video/${finalFileName}`,
      downloadUrl: `/api/download/${finalFileName}`,
      finalLocalPath: finalOutputPath,
    };

    activeJobs.set(jobId, finalResult);

    updateProgress({
      step: 'completed',
      message: 'Final 9:16 Video with Voiceover & Subtitles Ready for Upload!',
      progress: 100,
      status: 'completed',
      result: finalResult
    });

    res.json({
      success: true,
      ...finalResult
    });
  } catch (error) {
    console.error(`[Job ${jobId}] Stage 2 Error:`, error);
    cleanupTempFiles([audioFile?.path, srtPath]);

    updateProgress({
      step: 'error',
      message: error.message || 'Failed to merge voiceover audio.',
      progress: 0,
      status: 'error',
      error: error.message
    });

    res.status(500).json({ success: false, error: error.message, jobId });
  }
});

// 5. Stream output video for HTML5 Player
app.get('/api/video/:filename', (req, res) => {
  const filePath = path.join(outputDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Video not found.');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// 6. Download endpoint with forced attachment
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(outputDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  res.download(filePath, req.params.filename, (err) => {
    if (err) {
      console.error('[Download] Error downloading file:', err);
    }
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎬 Local AI Affiliate Clipper Backend Server`);
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
  console.log(`📡 Health endpoint: http://localhost:${PORT}/api/health`);
  console.log(`======================================================\n`);
});
