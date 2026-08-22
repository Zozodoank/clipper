import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { checkSystemDependencies } from './services/binaryChecker.js';
import { downloadYouTubeVideo } from './services/downloader.js';
import { extractFrames } from './services/frameExtractor.js';
import { analyzeVideoWithAivene, generateVoiceoverAudio } from './services/aiService.js';
import { generateSrtSubtitles } from './services/subtitleService.js';
import { renderAntiDetectionVideo } from './services/videoRenderer.js';
import { cleanupTempFiles } from './services/cleaner.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Directories
const tempDir = path.join(__dirname, 'temp');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-memory active job status tracker for SSE / polling
const jobProgress = new Map();

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
      if (latest.status === 'completed' || latest.status === 'error') {
        clearInterval(interval);
        res.end();
      }
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// 3. Main Pipeline: Generate Affiliate Clip & Ad Advisor Assets
app.post('/api/generate', async (req, res) => {
  const {
    youtubeUrl,
    shopeeLink,
    apiKey,
    model = 'gemini-2.5-flash',
    options = {},
    jobId: clientJobId
  } = req.body;

  if (!youtubeUrl) {
    return res.status(400).json({ error: 'YouTube Video URL is required.' });
  }

  const jobId = clientJobId || crypto.randomBytes(6).toString('hex');
  const sessionTempDir = path.join(tempDir, `job_${jobId}`);
  const sessionFramesDir = path.join(sessionTempDir, 'frames');
  const outputFileName = `affiliate_clip_${jobId}.mp4`;
  const finalOutputPath = path.join(outputDir, outputFileName);

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
    message: 'Initiating Ad Advisor & Video Pipeline...',
    progress: 5,
    status: 'running'
  });

  const filesToDelete = [];
  const dirsToDelete = [sessionFramesDir, sessionTempDir];

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

    // --- Step 2: Frame Extraction every 2 seconds & Base64 encoding (FFmpeg) ---
    updateProgress({ step: 'frames', message: 'Extracting keyframes from video with FFmpeg...', progress: 38, status: 'running' });
    const { frames } = await extractFrames(
      rawVideoPath,
      sessionFramesDir,
      updateProgress
    );

    // --- Step 3: Ad Advisor Analysis with Aivene (gemini-2.5-flash / gpt-4o-mini) ---
    updateProgress({
      step: 'ai_vision',
      message: `Analyzing visual frames with Aivene (${model}) for Scene Breakdown & Scripting...`,
      progress: 55,
      status: 'running'
    });
    const aiAnalysis = await analyzeVideoWithAivene({
      apiKey,
      model,
      frames,
      videoMetadata: videoMeta,
      shopeeLink: shopeeLink || '',
      onProgress: updateProgress,
    });

    // Optional TTS if requested in options
    let generatedAudio = null;
    if (options.enableTts) {
      updateProgress({ step: 'tts', message: 'Generating Indonesian voiceover narration...', progress: 75, status: 'running' });
      const ttsAudioPath = path.join(sessionTempDir, `voiceover_${jobId}.mp3`);
      const ttsResult = await generateVoiceoverAudio({
        apiKey,
        voiceoverScript: aiAnalysis.voiceoverScript,
        outputPath: ttsAudioPath,
        voice: options.voice || 'alloy',
        onProgress: updateProgress,
      });
      if (ttsResult.audioPath) {
        generatedAudio = ttsResult.audioPath;
        filesToDelete.push(generatedAudio);
      }
    }

    // --- Step 4: Subtitles Preparation (Optional) ---
    let srtPath = null;
    if (options.enableSubtitles) {
      updateProgress({ step: 'subtitles', message: 'Generating synchronized subtitles...', progress: 80, status: 'running' });
      srtPath = path.join(sessionTempDir, `subtitles_${jobId}.srt`);
      generateSrtSubtitles(aiAnalysis.voiceoverScript, aiAnalysis.duration, srtPath);
      filesToDelete.push(srtPath);
    }

    // --- Step 5: Anti-Detection FFmpeg Rendering Pipeline ---
    // (9:16 vertical crop 720x1280, 1.03x speed, color alteration, hflip, pitch-sync)
    updateProgress({ step: 'render', message: 'Rendering 9:16 Anti-Detection vertical video...', progress: 85, status: 'running' });
    await renderAntiDetectionVideo({
      inputVideo: rawVideoPath,
      startTime: aiAnalysis.startTime,
      endTime: aiAnalysis.endTime,
      outputVideo: finalOutputPath,
      customAudio: generatedAudio,
      srtPath: options.enableSubtitles ? srtPath : null,
      hflip: options.hflip !== undefined ? options.hflip : true,
      speedMultiplier: options.speedMultiplier || 1.03,
      onProgress: updateProgress,
    });

    // --- Step 6: Cleanup Temp Files ---
    updateProgress({ step: 'cleanup', message: 'Cleaning up temporary frame images and raw downloads...', progress: 98, status: 'running' });
    cleanupTempFiles(filesToDelete, dirsToDelete);

    // Build final response with Ad Advisor assets
    const result = {
      success: true,
      jobId,
      modelUsed: model,
      filename: outputFileName,
      videoUrl: `/api/video/${outputFileName}`,
      downloadUrl: `/api/download/${outputFileName}`,
      localPath: finalOutputPath,
      highlight: {
        startTime: aiAnalysis.startTime,
        endTime: aiAnalysis.endTime,
        duration: aiAnalysis.duration,
      },
      productHook: aiAnalysis.productHook,
      sampleContext: aiAnalysis.sampleContext,
      scenes: aiAnalysis.scenes,
      voiceoverScript: aiAnalysis.voiceoverScript,
      aiStudioPrompt: aiAnalysis.aiStudioPrompt,
      caption: aiAnalysis.caption,
      shopeeLink: shopeeLink || '',
      videoTitle: videoMeta.title,
    };

    updateProgress({
      step: 'completed',
      message: 'Local 9:16 Affiliate Reel & Ad Advisor Assets Generated Successfully!',
      progress: 100,
      status: 'completed',
      result
    });

    res.json(result);
  } catch (error) {
    console.error(`[Job ${jobId}] Pipeline Error:`, error);
    cleanupTempFiles(filesToDelete, dirsToDelete);

    updateProgress({
      step: 'error',
      message: error.message || 'An error occurred during video processing.',
      progress: 0,
      status: 'error',
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: error.message,
      jobId
    });
  }
});

// 4. Stream output video for HTML5 Player
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

// 5. Download endpoint with forced attachment
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
