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
const jobsFilePath = path.join(__dirname, 'jobs.json');

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

// ─── Persistent Job Store ────────────────────────────────────────────────────

/** Load jobs from disk into memory */
function loadJobsFromDisk() {
  try {
    if (fs.existsSync(jobsFilePath)) {
      const raw = fs.readFileSync(jobsFilePath, 'utf-8');
      const obj = JSON.parse(raw);
      for (const [jobId, jobData] of Object.entries(obj)) {
        activeJobs.set(jobId, jobData);
      }
      console.log(`[Jobs] Loaded ${Object.keys(obj).length} persisted job(s) from disk.`);
    }
  } catch (err) {
    console.warn('[Jobs] Could not load jobs.json:', err.message);
  }
}

/** Save a single job entry to disk */
function persistJob(jobId, jobData) {
  try {
    let existing = {};
    if (fs.existsSync(jobsFilePath)) {
      existing = JSON.parse(fs.readFileSync(jobsFilePath, 'utf-8'));
    }
    existing[jobId] = jobData;
    fs.writeFileSync(jobsFilePath, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Jobs] Could not persist job to disk:', err.message);
  }
}

/** Delete a job from disk */
function deletePersistedJob(jobId) {
  try {
    if (fs.existsSync(jobsFilePath)) {
      const existing = JSON.parse(fs.readFileSync(jobsFilePath, 'utf-8'));
      delete existing[jobId];
      fs.writeFileSync(jobsFilePath, JSON.stringify(existing, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('[Jobs] Could not delete job from disk:', err.message);
  }
}

/**
 * Scan temp/ directory for orphaned downloaded videos from interrupted jobs.
 * These are jobs that downloaded the video but failed before stage 1 completed.
 * We reconstruct a minimal job stub so user can retry them.
 */
function scanOrphanedJobs() {
  try {
    const jobDirs = fs.readdirSync(tempDir).filter(name => name.startsWith('job_'));
    let found = 0;

    for (const dirName of jobDirs) {
      const jobId = dirName.replace('job_', '');

      // Skip if already tracked
      if (activeJobs.has(jobId)) continue;

      const jobTempDir = path.join(tempDir, dirName);
      const videoFiles = fs.readdirSync(jobTempDir).filter(f => f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv'));

      if (videoFiles.length === 0) continue;

      const videoPath = path.join(jobTempDir, videoFiles[0]);
      const stat = fs.statSync(videoPath);

      // Only consider files larger than 5MB as valid partial downloads
      if (stat.size < 5 * 1024 * 1024) continue;

      const stub = {
        jobId,
        stage: 'interrupted',
        downloadedVideoPath: videoPath,
        downloadedAt: stat.mtime.toISOString(),
        productTitle: '',
        productDescription: '',
        youtubeUrl: '',
        shopeeLink: '',
        isOrphan: true,
      };

      activeJobs.set(jobId, stub);
      persistJob(jobId, stub);
      found++;
    }

    if (found > 0) {
      console.log(`[Jobs] Found ${found} orphaned job(s) with downloaded video in temp/.`);
    }
  } catch (err) {
    console.warn('[Jobs] Could not scan orphaned jobs:', err.message);
  }
}

// In-memory active jobs registry and progress tracker
const jobProgress = new Map();
const activeJobs = new Map();

// Load existing jobs from disk on startup
loadJobsFromDisk();
// Detect any interrupted jobs that still have videos in temp/
scanOrphanedJobs();

// ─── Routes ──────────────────────────────────────────────────────────────────

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

// 2. List all persisted jobs (for Job History UI)
app.get('/api/jobs', (req, res) => {
  const jobs = [];
  for (const [jobId, job] of activeJobs.entries()) {
    // Enrich with disk check: does the downloaded video or silent clip still exist?
    const silentClipPath = path.join(outputDir, `silent_clip_${jobId}.mp4`);
    const hasSilentClip = fs.existsSync(silentClipPath);
    const finalClipPath = path.join(outputDir, `final_clip_${jobId}.mp4`);
    const hasFinalClip = fs.existsSync(finalClipPath);
    const tempJobDir = path.join(tempDir, `job_${jobId}`);
    const hasDownloadedVideo = (() => {
      try {
        if (job.downloadedVideoPath && fs.existsSync(job.downloadedVideoPath)) return true;
        if (fs.existsSync(tempJobDir)) {
          const files = fs.readdirSync(tempJobDir).filter(f =>
            f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')
          );
          return files.length > 0;
        }
      } catch {}
      return false;
    })();

    jobs.push({
      jobId,
      stage: hasFinalClip ? 'completed' : hasSilentClip ? 'awaiting_voiceover' : job.stage || 'unknown',
      productTitle: job.productTitle || '(Tidak diketahui)',
      productDescription: job.productDescription || '',
      youtubeUrl: job.youtubeUrl || '',
      shopeeLink: job.shopeeLink || '',
      createdAt: job.createdAt || job.downloadedAt || null,
      hasDownloadedVideo,
      hasSilentClip,
      hasFinalClip,
      isOrphan: job.isOrphan || false,
      silentVideoUrl: hasSilentClip ? `/api/video/silent_clip_${jobId}.mp4` : null,
      videoUrl: hasFinalClip ? `/api/video/final_clip_${jobId}.mp4` : null,
      downloadUrl: hasFinalClip ? `/api/download/final_clip_${jobId}.mp4` : null,
      // Include full job data if stage 1 completed
      ...(hasSilentClip ? {
        scenes: job.scenes,
        voiceoverScript: job.voiceoverScript,
        aiStudioPrompt: job.aiStudioPrompt,
        sampleContext: job.sampleContext,
        caption: job.caption,
        highlight: job.highlight,
        productHook: job.productHook,
      } : {}),
    });
  }

  // Sort newest first
  jobs.sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  res.json({ jobs });
});

// 3. Delete a specific job
app.delete('/api/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  activeJobs.delete(jobId);
  deletePersistedJob(jobId);
  res.json({ success: true, jobId });
});

// 4. SSE endpoint for live progress streaming
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

// 5. STAGE 1: Video Clipping & AI Scripting
app.post('/api/generate', async (req, res) => {
  const {
    youtubeUrl,
    shopeeLink,
    productTitle,
    productDescription,
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

  // Persist job metadata early so it survives interruptions
  const jobMeta = {
    jobId,
    stage: 'running',
    productTitle: productTitle || '',
    productDescription: productDescription || '',
    youtubeUrl: youtubeUrl || '',
    shopeeLink: shopeeLink || '',
    createdAt: new Date().toISOString(),
    isOrphan: false,
  };
  activeJobs.set(jobId, jobMeta);
  persistJob(jobId, jobMeta);

  updateProgress({
    step: 'start',
    message: 'Starting Stage 1: Video Clipping & AI Scripting Pipeline...',
    progress: 5,
    status: 'running'
  });

  try {
    // --- Step 1: Download with Smart Cache ---
    let rawVideoPath;
    let videoMeta = { title: productTitle || 'Product Video', duration: 60 };

    // Look for already-downloaded video files in session temp dir
    const existingVideoInTemp = (() => {
      try {
        if (fs.existsSync(sessionTempDir)) {
          const files = fs.readdirSync(sessionTempDir).filter(f =>
            (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')) &&
            !f.startsWith('voiceover')
          );
          if (files.length > 0) {
            const fullPath = path.join(sessionTempDir, files[0]);
            if (fs.statSync(fullPath).size > 5 * 1024 * 1024) return fullPath;
          }
        }
      } catch {}
      return null;
    })();

    // Also check if a persisted job stored the path
    const existingJob = activeJobs.get(jobId);
    const cachedVideoPath = existingVideoInTemp ||
      (existingJob?.downloadedVideoPath && fs.existsSync(existingJob.downloadedVideoPath)
        ? existingJob.downloadedVideoPath
        : null);

    if (cachedVideoPath) {
      rawVideoPath = cachedVideoPath;
      updateProgress({
        step: 'download',
        message: `♻️ Video sudah ada (${(fs.statSync(rawVideoPath).size / 1024 / 1024).toFixed(1)} MB). Skip download, langsung proses.`,
        progress: 30,
        status: 'running'
      });
    } else {
      updateProgress({ step: 'download', message: 'Downloading source video (720p) via yt-dlp...', progress: 12, status: 'running' });
      const dlResult = await downloadYouTubeVideo(youtubeUrl, sessionTempDir, jobId, updateProgress);
      rawVideoPath = dlResult.filePath;
      videoMeta = dlResult.metadata;

      // Update persisted job with video path
      const updatedMeta = { ...jobMeta, downloadedVideoPath: rawVideoPath, stage: 'downloaded' };
      activeJobs.set(jobId, updatedMeta);
      persistJob(jobId, updatedMeta);
    }

    // --- Step 2: Extract frames ---
    updateProgress({ step: 'frames_raw', message: 'Extracting source frames for Gemini 2.5 Flash...', progress: 38, status: 'running' });
    const { frames: rawFrames } = await extractFrames(rawVideoPath, rawFramesDir, updateProgress);

    // --- Step 3: Gemini 2.5 Flash ---
    updateProgress({ step: 'gemini_vision', message: 'Gemini 2.5 Flash analyzing frames...', progress: 48, status: 'running' });
    const highlight = await selectHighlightWithGemini25Flash({
      apiKey, frames: rawFrames, videoMetadata: videoMeta,
      productTitle, productDescription, shopeeLink, onProgress: updateProgress,
    });

    // --- Step 4: Render Silent 9:16 ---
    updateProgress({ step: 'render_silent', message: `Rendering 9:16 Silent Video (${highlight.startTime} - ${highlight.endTime})...`, progress: 62, status: 'running' });
    await renderSilentAntiDetectionVideo({
      inputVideo: rawVideoPath, startTime: highlight.startTime,
      endTime: highlight.endTime, outputVideo: silentOutputPath,
      hflip: options.hflip !== undefined ? options.hflip : true,
      speedMultiplier: options.speedMultiplier || 1.03, onProgress: updateProgress,
    });

    // --- Step 5: Extract trimmed frames ---
    updateProgress({ step: 'frames_trimmed', message: 'Sampling frames from trimmed video for GPT-4o-mini...', progress: 72, status: 'running' });
    const { frames: trimmedFrames } = await extractFrames(silentOutputPath, trimmedFramesDir, updateProgress);

    // --- Step 6: GPT-4o-mini scripting ---
    updateProgress({ step: 'gpt_scripting', message: 'GPT-4o-mini generating Kotak Scene, Context, Naskah...', progress: 80, status: 'running' });
    const scriptData = await generateAdAdvisorScriptWithGpt4oMini({
      apiKey, trimmedFrames, videoMetadata: videoMeta, productTitle, productDescription,
      shopeeLink, productHook: highlight.productHook, segmentDuration: highlight.duration,
      onProgress: updateProgress,
    });

    // Cleanup raw frames only (keep downloaded video for future voiceover merge)
    cleanupTempFiles([], [rawFramesDir, trimmedFramesDir]);

    // Full Stage 1 result
    const stage1Result = {
      jobId,
      stage: 'awaiting_voiceover',
      createdAt: jobMeta.createdAt,
      silentFileName,
      silentVideoUrl: `/api/video/${silentFileName}`,
      silentLocalPath: silentOutputPath,
      downloadedVideoPath: rawVideoPath,
      productTitle: productTitle || videoMeta.title,
      productDescription: productDescription || '',
      youtubeUrl,
      shopeeLink: shopeeLink || '',
      highlight: { startTime: highlight.startTime, endTime: highlight.endTime, duration: highlight.duration },
      productHook: highlight.productHook,
      sampleContext: scriptData.sampleContext,
      scenes: scriptData.scenes,
      voiceoverScript: scriptData.voiceoverScript,
      aiStudioPrompt: scriptData.aiStudioPrompt,
      caption: scriptData.caption,
      videoTitle: videoMeta.title,
      isOrphan: false,
    };

    activeJobs.set(jobId, stage1Result);
    persistJob(jobId, stage1Result);

    updateProgress({
      step: 'awaiting_voiceover',
      message: 'Tahap 1 Selesai! Kotak Scene, Naskah, dan Muted 9:16 Video Ready.',
      progress: 100, status: 'awaiting_voiceover', result: stage1Result
    });

    res.json(stage1Result);
  } catch (error) {
    console.error(`[Job ${jobId}] Stage 1 Pipeline Error:`, error);

    // Persist error state (keep downloadedVideoPath so retry works)
    const currentJob = activeJobs.get(jobId) || {};
    const errorJob = {
      ...currentJob,
      stage: 'error',
      lastError: error.message,
      errorAt: new Date().toISOString(),
    };
    activeJobs.set(jobId, errorJob);
    persistJob(jobId, errorJob);

    const isQuotaError = error.message.toLowerCase().includes('saldo') ||
      error.message.toLowerCase().includes('insufficient') ||
      error.message.toLowerCase().includes('balance') ||
      error.message.toLowerCase().includes('quota') ||
      error.message.toLowerCase().includes('credit');

    updateProgress({
      step: 'error',
      message: error.message || 'An error occurred during video processing.',
      progress: 0, status: 'error', error: error.message, isQuotaError, canRetry: true
    });

    res.status(500).json({ success: false, error: error.message, isQuotaError, canRetry: true, jobId });
  }
});

// 6. STAGE 2: Upload Voiceover & Merge Subtitles
app.post('/api/upload-voiceover', upload.single('audio'), async (req, res) => {
  const { jobId } = req.body;
  const audioFile = req.file;

  if (!jobId) return res.status(400).json({ error: 'Job ID is required.' });
  if (!audioFile) return res.status(400).json({ error: 'Voiceover audio file is required.' });

  const job = activeJobs.get(jobId);
  const silentPath = job?.silentLocalPath || path.join(outputDir, `silent_clip_${jobId}.mp4`);

  if (!job || !fs.existsSync(silentPath)) {
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

  updateProgress({ step: 'merge_start', message: 'Merging voiceover & burning subtitles...', progress: 20, status: 'running' });

  try {
    updateProgress({ step: 'subtitles', message: 'Generating synchronized subtitle captions...', progress: 40, status: 'running' });
    generateSrtSubtitles(job.voiceoverScript, job.highlight?.duration || 45, srtPath);

    updateProgress({ step: 'render_final', message: 'Rendering final 9:16 video with Voiceover & Subtitles...', progress: 60, status: 'running' });
    await mergeVoiceoverAndBurnSubtitles({
      silentVideoPath: silentPath, voiceoverAudioPath: audioFile.path,
      srtPath, outputVideoPath: finalOutputPath, onProgress: updateProgress,
    });

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
    persistJob(jobId, finalResult);

    updateProgress({ step: 'completed', message: 'Final 9:16 Video Ready!', progress: 100, status: 'completed', result: finalResult });

    res.json({ success: true, ...finalResult });
  } catch (error) {
    console.error(`[Job ${jobId}] Stage 2 Error:`, error);
    cleanupTempFiles([audioFile?.path, srtPath]);
    updateProgress({ step: 'error', message: error.message, progress: 0, status: 'error', error: error.message });
    res.status(500).json({ success: false, error: error.message, jobId });
  }
});

// 7. Stream output video
app.get('/api/video/:filename', (req, res) => {
  const filePath = path.join(outputDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Video not found.');
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes', 'Content-Length': chunksize, 'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
  }
});

// 8. Download endpoint
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(outputDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found.' });
  res.download(filePath, req.params.filename);
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎬 Local AI Affiliate Clipper Backend Server`);
  console.log(`🌐 Running at: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
