import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import multer from 'multer';
import { exec, spawn } from 'child_process';

import { checkSystemDependencies } from './services/binaryChecker.js';
import { downloadYouTubeVideo, extractVideoId } from './services/downloader.js';
import { extractFrames } from './services/frameExtractor.js';
import {
  selectHighlightWithAI,
  generateAdAdvisorScriptWithAI
} from './services/aiService.js';
import { generateSrtSubtitles } from './services/subtitleService.js';
import {
  renderSilentAntiDetectionVideo,
  mergeVoiceoverAndBurnSubtitles,
  getMediaDurationSec,
  getVideoDimensions
} from './services/videoRenderer.js';
import { generateVoiceoverTTS, cleanScriptForTTS } from './services/ttsService.js';
import {
  cleanupTempFiles,
  deleteJobTempDirectory,
  deleteJobFiles
} from './services/cleaner.js';
import {
  discoverShopeeProducts,
  discoverSingleShopeeProduct,
  discoverYouTubeCandidatesForProduct,
  DEFAULT_AUTO_KEYWORDS,
  getAutoKeywords
} from './services/discoveryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from multiple candidate paths. Keep server/.env as the primary
// Termux/local source, but still accept root-level .env files for portability.
const envCandidates = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '.env.txt'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.txt'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '.env.txt')
];

const PLACEHOLDER_ENV_VALUES = new Set([
  '',
  'your_gemini_api_key_here',
  'your_aivene_api_key_here',
  'your_rapidapi_key_here',
  'your_cobalt_api_key_here',
]);

let loadedEnvFiles = [];

function cleanEnvValue(value) {
  let cleaned = String(value || '').trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function isPlaceholderEnvValue(value) {
  return PLACEHOLDER_ENV_VALUES.has(cleanEnvValue(value).toLowerCase());
}

export function reloadEnvironment() {
  const loaded = [];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      try {
        const raw = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
        const parsed = dotenv.parse(raw);
        for (const [key, value] of Object.entries(parsed)) {
          const cleaned = cleanEnvValue(value);
          if (isPlaceholderEnvValue(cleaned)) continue;
          process.env[key] = cleaned;
          process.env[key.toUpperCase()] = cleaned;
        }
        const lines = raw.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const k = trimmed.slice(0, eqIdx).replace(/^\uFEFF/, '').trim();
            const v = cleanEnvValue(trimmed.slice(eqIdx + 1));
            if (v && !isPlaceholderEnvValue(v)) {
              process.env[k] = v;
              process.env[k.toUpperCase()] = v;
            }
          }
        }
        loaded.push(envPath);
      } catch (err) {
        console.warn(`[Env] Could not load ${envPath}:`, err.message);
      }
    }
  }
  loadedEnvFiles = [...new Set(loaded)];
  return loadedEnvFiles;
}

reloadEnvironment();

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
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus']);
    const mime = String(file.mimetype || '').toLowerCase();
    if (allowedExts.has(ext) || mime.startsWith('audio/')) return cb(null, true);
    cb(new Error('File voiceover harus berupa audio (.mp3, .wav, .m4a, .aac, .ogg, .opus).'));
  },
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveOutputVideoPath(filename) {
  const safeName = String(filename || '').trim();
  if (!/^(silent|final)_clip_[a-zA-Z0-9_-]+\.mp4$/.test(safeName)) {
    return null;
  }
  const resolved = path.resolve(outputDir, safeName);
  const outputRoot = path.resolve(outputDir) + path.sep;
  return resolved.startsWith(outputRoot) ? resolved : null;
}

// ─── Persistent Job Store ────────────────────────────────────────────────────

/** In-memory stores */
const activeJobs = new Map();
const jobProgress = new Map();
const autoRuns = new Map();
const autoRetryRuns = new Map();

/** Load jobs from disk into memory */
function loadJobsFromDisk() {
  try {
    if (fs.existsSync(jobsFilePath)) {
      const raw = fs.readFileSync(jobsFilePath, 'utf-8');
      const obj = JSON.parse(raw);
      let cleaned = false;
      for (const [jobId, jobData] of Object.entries(obj)) {
        // Purge any failed / error jobs so the history only displays valid, successful jobs
        if (jobData.stage === 'error' || jobData.lastError || (jobData.stage === 'running' && !jobData.silentLocalPath)) {
          delete obj[jobId];
          deleteJobFiles(jobId, outputDir, tempDir);
          cleaned = true;
          continue;
        }
        activeJobs.set(jobId, jobData);
      }
      if (cleaned) {
        fs.writeFileSync(jobsFilePath, JSON.stringify(obj, null, 2), 'utf-8');
      }
      console.log(`[Jobs] Loaded ${activeJobs.size} valid persisted job(s) from disk.`);
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
    existing[jobId] = {
      ...jobData,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(jobsFilePath, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[Jobs] Could not persist job ${jobId}:`, err.message);
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
    console.warn(`[Jobs] Could not delete job ${jobId} from disk:`, err.message);
  }
}

loadJobsFromDisk();

/** Helper: get all YouTube video IDs from existing active & successfully completed jobs */
function getAllUsedYouTubeVideoIds() {
  const used = new Set();
  for (const job of activeJobs.values()) {
    // Only exclude video if the job actually SUCCEEDED or is currently processing
    if (job.youtubeUrl && (job.stage === 'completed' || job.stage === 'awaiting_voiceover' || job.stage === 'running')) {
      const vid = extractVideoId(job.youtubeUrl);
      if (vid) used.add(vid);
    }
  }
  return used;
}

function isVideoFilePath(p) {
  if (!p) return false;
  const lower = p.toLowerCase();
  return !['.m4a', '.mp3', '.aac', '.wav', '.opus'].some(ext => lower.endsWith(ext)) &&
    ['.mp4', '.webm', '.mkv', '.mov'].some(ext => lower.endsWith(ext));
}

function isQuotaErrorMessage(msg = '') {
  const lower = String(msg).toLowerCase();
  return lower.includes('saldo') || lower.includes('insufficient') ||
    lower.includes('balance') || lower.includes('quota') || lower.includes('kuota') ||
    lower.includes('credit') || lower.includes('fish audio');
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// 1. Health check & dependency verification
app.get('/api/health', async (req, res) => {
  const envFiles = reloadEnvironment();
  const rawOpenRouterKey = (
    process.env.OPENROUTER_API_KEY || ''
  ).trim().replace(/^["']|["']$/g, '');
  const openRouterKeySet = Boolean(rawOpenRouterKey && !rawOpenRouterKey.startsWith('your_') && !rawOpenRouterKey.endsWith('_here'));

  const rawGeminiKey = (
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
  ).trim().replace(/^["']|["']$/g, '');
  const geminiKeySet = Boolean(rawGeminiKey && !rawGeminiKey.startsWith('your_') && !rawGeminiKey.endsWith('_here'));

  const activeAiEngine = openRouterKeySet ? 'openrouter' : (geminiKeySet ? 'gemini' : 'none');

  const binaryCheck = await checkSystemDependencies();

  res.json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    ffmpeg: binaryCheck.ffmpeg,
    ytdlp: binaryCheck.ytdlp,
    dependencies: {
      ffmpeg: binaryCheck.ffmpeg,
      ytdlp: binaryCheck.ytdlp,
    },
    openRouterKeyConfigured: openRouterKeySet,
    geminiKeyConfigured: geminiKeySet,
    geminiFallbackConfigured: geminiKeySet,
    activeAiEngine,
    defaultAiProvider: 'openrouter',
    tts: {
      available: true,
      defaultVoice: 'RINDI (Fish Audio S2.1 Pro)',
      provider: 'fish_audio',
      modelId: process.env.FISH_AUDIO_MODEL_ID || '9c94fb1d0504466898beb87481df9fa1',
      fishAudioConfigured: Boolean(process.env.FISH_AUDIO_API_KEY && !process.env.FISH_AUDIO_API_KEY.startsWith('your_')),
    },
    envFilesLoaded: envFiles.map((envPath) => path.relative(path.resolve(__dirname, '..'), envPath).replace(/\\/g, '/')),
    ready: binaryCheck.ffmpeg.available && binaryCheck.ytdlp.available,
  });
});

function sanitizeCaptionText(caption = '') {
  if (!caption || typeof caption !== 'string') return '';
  return caption
    .replace(/(?:🛒\s*)?(?:link\s+(?:produk|shopee|pembelian)?\s*:\s*)?https?:\/\/[^\s]+/gi, '')
    .replace(/(?:🛒\s*)?(?:link\s+(?:produk|shopee|pembelian)?\s*:\s*)?shope\.ee\/[^\s]+/gi, '')
    .replace(/(?:🛒\s*)?(?:cek\s+selengkapnya\s+)?(?:cek\s+)?(?:link\s+)?(?:di\s+)?(?:kolom\s+)?komentar\s+(?:pertama|ke-1|1|pin|bawah)?(?:\s+ya)?(?:\s*[,!?. -]*[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+)*(?:\s*[,!?. -])*/gi, '')
    .replace(/cek\s+selengkapnya\s+di\s+komentar(?:\s*[,!?.])?/gi, '')
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/gu, '')
    .replace(/^[ \t]*[,!?. -]+[ \t]*$/gm, '')
    .replace(/^[ \t]*[,!?. -]+(?=\s*#)/gm, '')
    .replace(/,\s*([!?.])/g, '$1')
    .replace(/,\s*,+/g, ',')
    .replace(/[ \t]+([,!?.])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const stripShopeeLinkFromCaption = sanitizeCaptionText;

// 2. Get all jobs history
app.get('/api/jobs', (req, res) => {
  const jobs = [];
  for (const [jobId, job] of activeJobs.entries()) {
    const silentPath = job.silentLocalPath || path.join(outputDir, `silent_clip_${jobId}.mp4`);
    const finalPath = job.finalLocalPath || path.join(outputDir, `final_clip_${jobId}.mp4`);

    jobs.push({
      jobId,
      stage: job.stage || 'unknown',
      productTitle: job.productTitle || '',
      productDescription: job.productDescription || '',
      youtubeUrl: job.youtubeUrl || '',
      shopeeLink: job.shopeeLink || '',
      createdAt: job.createdAt || '',
      updatedAt: job.updatedAt || '',
      errorAt: job.errorAt || '',
      lastError: job.lastError || '',
      hasSilentVideo: fs.existsSync(silentPath),
      hasFinalVideo: fs.existsSync(finalPath),
      silentVideoUrl: job.silentVideoUrl || (fs.existsSync(silentPath) ? `/api/video/silent_clip_${jobId}.mp4` : null),
      finalVideoUrl: job.videoUrl || (fs.existsSync(finalPath) ? `/api/video/final_clip_${jobId}.mp4` : null),
      scenes: job.scenes || [],
      voiceoverScript: job.voiceoverScript || '',
      aiStudioPrompt: job.aiStudioPrompt || '',
      cleanScript: job.cleanScript || '',
      ttsVoice: job.ttsVoice || 'Gadis Indonesia (Neural)',
      voiceoverAudioUrl: job.voiceoverAudioUrl || null,
      sampleContext: job.sampleContext || null,
      caption: stripShopeeLinkFromCaption(job.caption || ''),
      highlight: job.highlight || null,
      productHook: job.productHook || '',
      videoTitle: job.videoTitle || job.productTitle || '',
      isAutoRetrying: autoRetryRuns.get(jobId)?.status === 'running',
    });
  }

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
  deleteJobFiles(jobId, outputDir, tempDir);
  activeJobs.delete(jobId);
  deletePersistedJob(jobId);
  res.json({ success: true, jobId });
});

function updateJobProgress(jobId, data) {
  const payload = typeof data === 'string'
    ? { step: 'processing', message: data, progress: 50, jobId, status: 'running' }
    : { status: 'running', ...data, jobId };
  jobProgress.set(jobId, payload);
  console.log(`[Job ${jobId}] [${payload.progress || 0}%] ${payload.message || ''}`);
}

// 3b. Retry / Regenerate an existing completed or failed job with fresh 1080p video & voiceover
app.post('/api/jobs/:jobId/retry', async (req, res) => {
  reloadEnvironment();
  const { jobId } = req.params;
  const { forceNewCandidate = true } = req.body || {};

  const job = activeJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: `Job ${jobId} tidak ditemukan.` });
  }

  console.log(`[Retry] Starting full regeneration for job ${jobId} ("${job.productTitle}")...`);

  // Delete old outputs and temp files to ensure bad old video/audio is completely replaced
  deleteJobFiles(jobId, outputDir, tempDir);
  job.downloadedVideoPath = null;
  job.hasDownloadedVideo = false;
  job.hasFinalVideo = false;
  job.hasSilentVideo = false;
  job.stage = 'running';
  job.updatedAt = new Date().toISOString();
  activeJobs.set(jobId, job);
  persistJob(jobId, job);

  // Initialize progress state so SSE client immediately sees running status
  updateJobProgress(jobId, {
    step: 'retry_start',
    message: `Menyiapkan generate ulang untuk "${job.productTitle}"...`,
    progress: 5,
    status: 'running',
  });

  // Trigger regeneration asynchronously so SSE progress streams live to the frontend
  (async () => {
    try {
      let targetCandidates = [];
      const usedVids = getAllUsedYouTubeVideoIds();
      const oldVid = extractVideoId(job.youtubeUrl);
      if (oldVid) usedVids.add(oldVid);

      if (forceNewCandidate && job.productTitle) {
        updateJobProgress(jobId, { step: 'auto_youtube_search', message: `Mencari video 1080p baru untuk "${job.productTitle.slice(0, 30)}..."`, progress: 8, status: 'running' });
        const fresh = await discoverYouTubeCandidatesForProduct({
          productTitle: job.productTitle,
          productDescription: job.productDescription,
          limit: 8,
          excludeVideoIds: usedVids,
          onProgress: (p) => updateJobProgress(jobId, { ...p, status: 'running' }),
        });
        if (fresh && fresh.length > 0) {
          targetCandidates = fresh;
        }
      }

      // If no search candidates found or manual retry, fallback to the current job URL
      if (!targetCandidates.length) {
        targetCandidates = [{ url: job.youtubeUrl, title: job.productTitle || 'YouTube Video' }];
      }

      let retrySuccess = false;
      let lastRetryErr = null;

      for (let i = 0; i < targetCandidates.length; i++) {
        const candidate = targetCandidates[i];
        const candVid = extractVideoId(candidate.url) || candidate.id;
        if (candVid) usedVids.add(candVid);

        updateJobProgress(jobId, {
          step: 'download',
          message: targetCandidates.length > 1
            ? `[Kandidat ${i + 1}/${targetCandidates.length}] Memproses video 1080p: "${(candidate.title || job.productTitle).slice(0, 30)}..."`
            : `Memproses video 1080p baru: "${(candidate.title || job.productTitle).slice(0, 30)}..."`,
          progress: 10 + Math.round((i / targetCandidates.length) * 15),
          status: 'running',
        });

        try {
          job.youtubeUrl = candidate.url;
          activeJobs.set(jobId, job);
          persistJob(jobId, job);

          await runStage1Pipeline({
            jobId,
            youtubeUrl: candidate.url,
            shopeeLink: job.shopeeLink,
            productTitle: job.productTitle,
            productDescription: job.productDescription,
            apiKey: undefined,
            options: { aiProvider: 'openrouter' },
            requireCleanGeminiPlan: true,
          });

          retrySuccess = true;
          console.log(`[Retry ${jobId}] Kandidat ${i + 1} (${candidate.url}) sukses di-generate 1080p!`);
          break;
        } catch (candErr) {
          console.warn(`[Retry ${jobId}] Kandidat ${i + 1} (${candidate.url}) gagal: ${candErr.message}. Mencoba kandidat berikutnya...`);
          lastRetryErr = candErr;
          deleteJobFiles(jobId, outputDir, tempDir);
        }
      }

      if (!retrySuccess) {
        throw lastRetryErr || new Error('Tidak ada kandidat video YouTube yang dapat diunduh dalam kualitas 1080p Full HD.');
      }

      console.log(`[Retry ${jobId}] Full regeneration completed successfully.`);
    } catch (retryErr) {
      console.error(`[Retry ${jobId}] Regeneration failed:`, retryErr.message);
      job.stage = 'error';
      job.lastError = retryErr.message;
      job.errorAt = new Date().toISOString();
      activeJobs.set(jobId, job);
      persistJob(jobId, job);
      updateJobProgress(jobId, { step: 'error', status: 'error', error: retryErr.message, message: `Gagal generate ulang: ${retryErr.message}` });
    }
  })();

  res.json({ success: true, jobId, message: 'Job sedang di-generate ulang dengan source video 1080p baru & voiceover baru.' });
});

// ─── 3c. Auto Retry Engine for Exact Product Match ───────────────────────────

function publicAutoRetryState(run) {
  if (!run) return { status: 'idle' };
  return {
    jobId: run.jobId,
    status: run.status,
    attemptCount: run.attemptCount || 0,
    currentVideoTitle: run.currentVideoTitle || '',
    message: run.message || '',
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  };
}

async function runAutoRetryWorker(jobId, run) {
  try {
    const job = activeJobs.get(jobId);
    if (!job || !job.productTitle) {
      run.status = 'error';
      run.message = 'Job tidak memiliki judul produk yang valid.';
      run.updatedAt = new Date().toISOString();
      updateJobProgress(jobId, { step: 'error', status: 'error', error: run.message, isAutoRetrying: false });
      return;
    }

    const targetTitle = job.productTitle;
    console.log(`[AutoRetry ${jobId}] Memulai Auto Retry pencarian video persis untuk "${targetTitle}"...`);
    updateJobProgress(jobId, {
      step: 'auto_retry_start',
      message: `[Auto Retry] Memulai pencarian video yang cocok persis & faceless untuk "${targetTitle.slice(0, 30)}..."`,
      progress: 5,
      status: 'running',
      isAutoRetrying: true,
      attemptCount: 0,
    });

    const usedVids = getAllUsedYouTubeVideoIds();
    const oldVid = extractVideoId(job.youtubeUrl);
    if (oldVid) usedVids.add(oldVid);

    let foundSuccess = false;

    while (run.status === 'running') {
      if (run.attemptCount >= 60) {
        run.status = 'error';
        run.message = 'Mencapai batas maksimal 60 percobaan pencarian video.';
        run.updatedAt = new Date().toISOString();
        break;
      }

      run.message = `[Percobaan ke-${run.attemptCount + 1}] Mencari video YouTube cocok persis untuk "${targetTitle.slice(0, 30)}..."`;
      run.updatedAt = new Date().toISOString();
      updateJobProgress(jobId, {
        step: 'auto_youtube_search',
        message: run.message,
        progress: 8,
        status: 'running',
        isAutoRetrying: true,
        attemptCount: run.attemptCount + 1,
      });

      const candidates = await discoverYouTubeCandidatesForProduct({
        productTitle: targetTitle,
        productDescription: job.productDescription,
        limit: 8,
        excludeVideoIds: usedVids,
        searchIteration: run.searchIteration,
        onProgress: (p) => updateJobProgress(jobId, { ...p, status: 'running', isAutoRetrying: true }),
      });
      run.searchIteration++;

      if (!candidates || candidates.length === 0) {
        run.message = `Tidak ada kandidat baru pada pencarian ini. Mencoba variasi kata kunci lain...`;
        updateJobProgress(jobId, { step: 'auto_retry_wait', message: run.message, progress: 10, status: 'running', isAutoRetrying: true });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      for (const candidate of candidates) {
        if (run.status === 'stopping' || run.status === 'stopped') break;

        const candVid = extractVideoId(candidate.url) || candidate.id;
        if (candVid) usedVids.add(candVid);

        run.attemptCount++;
        run.currentVideoTitle = candidate.title || '';
        run.message = `[Percobaan ke-${run.attemptCount}] Menguji video: "${(candidate.title || targetTitle).slice(0, 35)}..."`;
        run.updatedAt = new Date().toISOString();

        updateJobProgress(jobId, {
          step: 'download',
          message: run.message,
          progress: 12,
          status: 'running',
          isAutoRetrying: true,
          attemptCount: run.attemptCount,
        });

        // Clean any old outputs / temp files before testing this candidate
        deleteJobFiles(jobId, outputDir, tempDir);

        try {
          job.youtubeUrl = candidate.url;
          activeJobs.set(jobId, job);
          persistJob(jobId, job);

          await runStage1Pipeline({
            jobId,
            youtubeUrl: candidate.url,
            shopeeLink: job.shopeeLink,
            productTitle: targetTitle,
            productDescription: job.productDescription,
            apiKey: undefined,
            options: { aiProvider: 'openrouter' },
            requireCleanGeminiPlan: true,
            onProgress: (p) => updateJobProgress(jobId, {
              ...p,
              status: 'running',
              isAutoRetrying: true,
              attemptCount: run.attemptCount,
              message: `[Percobaan ke-${run.attemptCount}] ${p.message || ''}`
            }),
          });

          foundSuccess = true;
          run.status = 'completed';
          run.message = `✅ Auto Retry berhasil pada percobaan ke-${run.attemptCount}! Video cocok persis & 100% faceless selesai.`;
          run.updatedAt = new Date().toISOString();
          console.log(`[AutoRetry ${jobId}] BERHASIL pada percobaan ke-${run.attemptCount} dengan video: ${candidate.url}`);
          break;
        } catch (candErr) {
          console.warn(`[AutoRetry ${jobId}] Kandidat ke-${run.attemptCount} (${candidate.url}) ditolak/gagal: ${candErr.message}`);
          deleteJobFiles(jobId, outputDir, tempDir);
          updateJobProgress(jobId, {
            step: 'auto_retry_next',
            message: `[Percobaan ke-${run.attemptCount} Ditolak] ${candErr.message.slice(0, 80)}... Mencoba kandidat berikutnya...`,
            progress: 10,
            status: 'running',
            isAutoRetrying: true,
            attemptCount: run.attemptCount,
          });
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      if (foundSuccess) break;
      if (run.status === 'stopping' || run.status === 'stopped') break;

      // Jitter delay between search query batches to prevent YouTube scraping blocks
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    if (run.status === 'stopping' || run.status === 'stopped') {
      run.status = 'stopped';
      run.message = `Auto Retry dihentikan oleh pengguna setelah ${run.attemptCount} percobaan.`;
      run.updatedAt = new Date().toISOString();
      console.log(`[AutoRetry ${jobId}] Dihentikan oleh user.`);
      updateJobProgress(jobId, {
        step: 'auto_retry_stopped',
        message: run.message,
        progress: 100,
        status: 'completed',
        isAutoRetrying: false,
      });
    } else if (foundSuccess) {
      updateJobProgress(jobId, {
        step: 'completed',
        message: `🎉 Video Final 9:16 + Voiceover Gadis Indonesia & Subtitle Selesai (Auto Retry Berhasil)!`,
        progress: 100,
        status: 'completed',
        isAutoRetrying: false,
        result: activeJobs.get(jobId),
      });
    } else if (run.status === 'error') {
      updateJobProgress(jobId, {
        step: 'error',
        message: run.message,
        progress: 100,
        status: 'error',
        error: run.message,
        isAutoRetrying: false,
      });
    }
  } catch (workerErr) {
    console.error(`[AutoRetry ${jobId}] Fatal worker error:`, workerErr);
    run.status = 'error';
    run.message = workerErr.message;
    run.updatedAt = new Date().toISOString();
    updateJobProgress(jobId, {
      step: 'error',
      message: `Auto Retry gagal: ${workerErr.message}`,
      status: 'error',
      error: workerErr.message,
      isAutoRetrying: false,
    });
  }
}

app.post('/api/jobs/:jobId/auto-retry/start', async (req, res) => {
  reloadEnvironment();
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: `Job ${jobId} tidak ditemukan.` });
  }

  const existingRun = autoRetryRuns.get(jobId);
  if (existingRun && existingRun.status === 'running') {
    return res.json({ success: true, autoRetry: publicAutoRetryState(existingRun) });
  }

  const run = {
    jobId,
    status: 'running',
    attemptCount: 0,
    searchIteration: 0,
    currentVideoTitle: '',
    message: `Memulai Auto Retry untuk "${job.productTitle}"...`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  autoRetryRuns.set(jobId, run);

  // Trigger continuous auto-retry worker in background
  runAutoRetryWorker(jobId, run);

  res.json({ success: true, jobId, autoRetry: publicAutoRetryState(run) });
});

app.post('/api/jobs/:jobId/auto-retry/stop', (req, res) => {
  const { jobId } = req.params;
  const run = autoRetryRuns.get(jobId);
  if (run && run.status === 'running') {
    run.status = 'stopping';
    run.message = 'Menghentikan Auto Retry...';
    run.updatedAt = new Date().toISOString();
    autoRetryRuns.set(jobId, run);
    return res.json({ success: true, autoRetry: publicAutoRetryState(run) });
  }
  res.json({ success: true, autoRetry: publicAutoRetryState(run) });
});

app.get('/api/jobs/:jobId/auto-retry/status', (req, res) => {
  const { jobId } = req.params;
  const run = autoRetryRuns.get(jobId);
  res.json({ autoRetry: publicAutoRetryState(run) });
});

// 4. SSE endpoint for live job progress streaming
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

// ─── Stage 1 Pipeline Engine ─────────────────────────────────────────────────

export async function runStage1Pipeline({
  jobId,
  youtubeUrl,
  shopeeLink,
  productTitle,
  productDescription,
  apiKey,
  options = {},
  extraJobMeta = {},
  requireCleanGeminiPlan = true,
  onProgress = null,
}) {
  const sessionTempDir = path.join(tempDir, `job_${jobId}`);
  const rawFramesDir = path.join(sessionTempDir, 'raw_frames');
  const trimmedFramesDir = path.join(sessionTempDir, 'trimmed_frames');
  const silentFileName = `silent_clip_${jobId}.mp4`;
  const silentOutputPath = path.join(outputDir, silentFileName);

  if (!fs.existsSync(sessionTempDir)) fs.mkdirSync(sessionTempDir, { recursive: true });

  const updateProgress = onProgress || ((data) => {
    const payload = typeof data === 'string'
      ? { step: 'processing', message: data, progress: 50, jobId }
      : { ...data, jobId };
    jobProgress.set(jobId, payload);
    console.log(`[Job ${jobId}] [${payload.progress || 0}%] ${payload.message}`);
  });

  const jobMeta = {
    jobId,
    stage: 'running',
    productTitle: productTitle || '',
    productDescription: productDescription || '',
    youtubeUrl: youtubeUrl || '',
    shopeeLink: shopeeLink || '',
    createdAt: new Date().toISOString(),
    isOrphan: false,
    ...extraJobMeta,
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
    let rawVideoPath;
    let videoMeta = { title: productTitle || 'Product Video', duration: 60 };

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

    const existingJob = activeJobs.get(jobId);
    const cachedVideoPath = existingVideoInTemp ||
      (existingJob?.downloadedVideoPath && fs.existsSync(existingJob.downloadedVideoPath) && isVideoFilePath(existingJob.downloadedVideoPath)
        ? existingJob.downloadedVideoPath
        : null);

    let previewVideoPath = null;

    if (cachedVideoPath) {
      const cachedDims = await getVideoDimensions(cachedVideoPath);
      if (cachedDims && cachedDims.is1080pOrHigher) {
        rawVideoPath = cachedVideoPath;
        updateProgress({
          step: 'download',
          message: `Video 1080p sudah ada (${(fs.statSync(rawVideoPath).size / 1024 / 1024).toFixed(1)} MB). Skip download, langsung proses.`,
          progress: 30,
          status: 'running'
        });
      } else {
        // Hapus cache video lama jika di bawah 1080p agar tidak tercampur
        try { fs.unlinkSync(cachedVideoPath); } catch {}
        cachedVideoPath = null;
      }
    }

    if (!rawVideoPath) {
      // TAHAP 1: Unduh preview 360p ringan dari YouTube khusus untuk analisa visual AI
      updateProgress({ step: 'download', message: 'Mengunduh preview video (360p) untuk analisa visual AI...', progress: 12, status: 'running' });
      const previewDl = await downloadYouTubeVideo(youtubeUrl, sessionTempDir, jobId, updateProgress, { quality: 'preview', prefix: 'preview' });
      previewVideoPath = previewDl.filePath;
      videoMeta = previewDl.metadata;

      const realDuration = await getMediaDurationSec(previewVideoPath);
      if (realDuration && realDuration > 5) {
        videoMeta.duration = realDuration;
      }
      console.log(`[Job ${jobId}] Preview 360p siap untuk analisa AI: "${videoMeta.title}" duration=${videoMeta.duration}s file=${previewVideoPath}`);
    }

    const videoForFrames = previewVideoPath || rawVideoPath;
    updateProgress({ step: 'frames_raw', message: 'Mengekstrak frame preview untuk analisa AI...', progress: 38, status: 'running' });
    const { frames: rawFrames } = await extractFrames(videoForFrames, rawFramesDir, updateProgress, {
      sampleIntervalSec: 1,
      maxSampleFrames: 30,
    });

    const aiProvider = options.aiProvider || 'openrouter';
    const sceneDuration = Number(options.sceneDuration) || 3.3;

    console.log(`[Job ${jobId}] Mengirim ke AI: videoMeta.duration=${videoMeta.duration}s, ${rawFrames.length} frames, sceneDuration=${sceneDuration}s`);
    updateProgress({ step: 'gemini_vision', message: 'AI menganalisa frame produk dan menentukan cuplikan terbaik...', progress: 48, status: 'running' });
    const highlight = await selectHighlightWithAI({
      apiKey,
      aiProvider,
      frames: rawFrames,
      videoMetadata: videoMeta,
      productTitle, productDescription, shopeeLink,
      sceneDuration,
      allowFallbackClips: !requireCleanGeminiPlan,
      onProgress: updateProgress,
    });

    // TAHAP 2: AI telah menyetujui video! Backend langsung mengunduh video 1080p Full HD asli dari YouTube untuk rendering
    if (!rawVideoPath) {
      updateProgress({ step: 'download_hd', message: '✅ Video disetujui AI! Mengunduh kualitas 1080p Full HD langsung dari YouTube...', progress: 55, status: 'running' });
      try {
        const hdDl = await downloadYouTubeVideo(youtubeUrl, sessionTempDir, jobId, updateProgress, { quality: '1080p', prefix: 'raw' });
        if (!hdDl || !hdDl.filePath || !fs.existsSync(hdDl.filePath)) {
          throw new Error('File video 1080p tidak ditemukan setelah download.');
        }

        const hdDims = await getVideoDimensions(hdDl.filePath);
        const isStrict1080p = hdDims && hdDims.is1080pOrHigher;
        if (!isStrict1080p) {
          try { fs.unlinkSync(hdDl.filePath); } catch {}
          throw new Error(`Resolusi video YouTube (${hdDims?.width}x${hdDims?.height}) tidak memenuhi standar minimal 1080p Full HD ke atas.`);
        }

        console.log(`[Job ${jobId}] ✅ Video 1080p+ Full HD asli berhasil diunduh (${hdDims.width}x${hdDims.height}). Menggantikan preview 360p.`);
        rawVideoPath = hdDl.filePath;

        // Hapus file preview 360p agar tidak memakan ruang penyimpanan HP dan tidak tertukar
        try {
          if (previewVideoPath && fs.existsSync(previewVideoPath) && previewVideoPath !== rawVideoPath) {
            fs.unlinkSync(previewVideoPath);
          }
        } catch {}
      } catch (hdErr) {
        console.error(`[Job ${jobId}] ❌ Gagal mengunduh video 1080p Full HD dari YouTube: ${hdErr.message}`);
        // Wajib lempar error dan BATALKAN render jika 1080p gagal, TIDAK BOLEH render video 360p!
        throw new Error(`Gagal mengunduh video kualitas 1080p Full HD langsung dari YouTube untuk rendering: ${hdErr.message}`);
      }

      const updatedMeta = { ...jobMeta, downloadedVideoPath: rawVideoPath, stage: 'downloaded' };
      activeJobs.set(jobId, updatedMeta);
      persistJob(jobId, updatedMeta);
    }

    const isBrandDetected = highlight.hasProductBrand === true ||
      (Array.isArray(highlight.clips) && highlight.clips.some(c => c.hasProductBrand === true));
    const requestedHflip = options.hflip !== undefined ? Boolean(options.hflip) : false;
    const effectiveHflip = (isBrandDetected || highlight.allowHflip === false) ? false : requestedHflip;

    if (isBrandDetected && requestedHflip) {
      console.log(`[Job ${jobId}] Merek/Logo produk terdeteksi ("${highlight.detectedBrand || 'Brand'}"). Video mirror (H-Flip) dinonaktifkan otomatis agar logo/merek produk tidak terbalik.`);
    }

    const renderMessage = isBrandDetected
      ? `Rendering ${highlight.clips.length} cuplikan produk (${highlight.duration.toFixed(1)}s) [Mirror H-Flip OFF: Merek "${highlight.detectedBrand || 'Terdeteksi'}"]...`
      : `Rendering ${highlight.clips.length} AI-selected fast product shots (${highlight.duration.toFixed(1)}s)...`;

    updateProgress({ step: 'render_silent', message: renderMessage, progress: 62, status: 'running' });
    await renderSilentAntiDetectionVideo({
      inputVideo: rawVideoPath, startTime: highlight.startTime,
      endTime: highlight.endTime, outputVideo: silentOutputPath,
      clips: highlight.clips,
      hflip: effectiveHflip,
      speedMultiplier: options.speedMultiplier || 1,
      reframe: highlight.reframe,
      onProgress: updateProgress,
    });

    updateProgress({ step: 'frames_trimmed', message: 'Sampling frames from trimmed video for AI scripting...', progress: 72, status: 'running' });
    const { frames: trimmedFrames } = await extractFrames(silentOutputPath, trimmedFramesDir, updateProgress, {
      sampleIntervalSec: 3,
      maxSampleFrames: 6,
    });

    updateProgress({ step: 'gpt_scripting', message: 'AI generating Kotak Scene, Context, Naskah...', progress: 80, status: 'running' });
    const scriptData = await generateAdAdvisorScriptWithAI({
      apiKey,
      aiProvider: options.aiProvider || 'openrouter',
      trimmedFrames,
      videoMetadata: videoMeta,
      productTitle,
      productDescription,
      shopeeLink,
      productHook: highlight.productHook,
      segmentDuration: highlight.duration,
      sceneDuration,
      onProgress: updateProgress,
    });

    cleanupTempFiles([], [rawFramesDir, trimmedFramesDir]);

    // ─── TAHAP OTOMATIS: Voiceover TTS & Subtitle Burning ───────────────────────
    const rawVoiceScript = scriptData.aiStudioPrompt || scriptData.voiceoverScript || '';
    const voiceoverFileName = `voiceover_${jobId}.mp3`;
    const autoVoiceoverPath = path.join(uploadsDir, voiceoverFileName);

    updateProgress({
      step: 'tts_generating',
      message: '🎙️ Menghasilkan voice over RINDI (Fish Audio S2.1 Pro)...',
      progress: 84,
      status: 'running',
    });

    let ttsSucceeded = false;
    let ttsResult = null;
    try {
      ttsResult = await generateVoiceoverTTS({
        script: rawVoiceScript,
        outputPath: autoVoiceoverPath,
        onProgress: (msg) => updateProgress({ step: 'tts_generating', message: `🎙️ ${msg}`, progress: 86, status: 'running' }),
        jobId,
      });
      ttsSucceeded = true;
    } catch (ttsErr) {
      console.error(`[Job ${jobId}] Fish Audio TTS Error:`, ttsErr.message);
      throw ttsErr;
    }

    if (ttsSucceeded && fs.existsSync(autoVoiceoverPath)) {
      try {
        updateProgress({
          step: 'merge_start',
          message: 'Menggabungkan Voiceover AI & membakar subtitle ke video final 9:16...',
          progress: 90,
          status: 'running',
        });

        const finalFileName = `final_clip_${jobId}.mp4`;
        const finalOutputPath = path.join(outputDir, finalFileName);
        const srtPath = path.join(uploadsDir, `subtitles_${jobId}.ass`);

        const silentDurationSec = (await getMediaDurationSec(silentOutputPath)) || highlight.duration || 45;
        const audioDurationSec = await getMediaDurationSec(autoVoiceoverPath);
        const narrationDurationSec = (audioDurationSec && audioDurationSec > 0)
          ? Math.min(silentDurationSec, audioDurationSec)
          : silentDurationSec;

        updateProgress({
          step: 'subtitles',
          message: `Menyinkronkan subtitle narasi (${narrationDurationSec.toFixed(1)}s)...`,
          progress: 93,
          status: 'running',
        });
        generateSrtSubtitles(ttsResult.cleanScript || rawVoiceScript, narrationDurationSec, srtPath);

        updateProgress({
          step: 'render_final',
          message: 'Rendering video final 9:16 dengan Voiceover & Subtitles...',
          progress: 95,
          status: 'running',
        });
        await mergeVoiceoverAndBurnSubtitles({
          silentVideoPath: silentOutputPath,
          voiceoverAudioPath: autoVoiceoverPath,
          srtPath,
          outputVideoPath: finalOutputPath,
          targetDurationSec: silentDurationSec,
          onProgress: updateProgress,
        });

        cleanupTempFiles([srtPath]);
        deleteJobTempDirectory(jobId, tempDir);

        const cacheBuster = Date.now();
        const completedResult = {
          ...extraJobMeta,
          jobId,
          stage: 'completed',
          createdAt: jobMeta.createdAt,
          silentFileName,
          silentVideoUrl: `/api/video/${silentFileName}`,
          silentLocalPath: silentOutputPath,
          finalFileName,
          videoUrl: `/api/video/${finalFileName}?t=${cacheBuster}`,
          downloadUrl: `/api/download/${finalFileName}?t=${cacheBuster}`,
          finalLocalPath: finalOutputPath,
          voiceoverAudioUrl: `/api/audio/${voiceoverFileName}?t=${cacheBuster}`,
          ttsVoice: ttsResult.voice || 'Gadis Indonesia (Neural)',
          ttsProvider: ttsResult.provider || 'edge_neural',
          cleanScript: ttsResult.cleanScript,
          downloadedVideoPath: null,
          hasDownloadedVideo: false,
          hasFinalVideo: true,
          hasSilentVideo: true,
          productTitle: productTitle || videoMeta.title,
          productDescription: productDescription || '',
          youtubeUrl,
          shopeeLink: shopeeLink || '',
          highlight: {
            startTime: highlight.startTime,
            endTime: highlight.endTime,
            duration: highlight.duration,
            hasProductBrand: isBrandDetected,
            detectedBrand: highlight.detectedBrand || 'none',
            allowHflip: !isBrandDetected,
            reframe: highlight.reframe,
            clips: highlight.clips,
          },
          hasProductBrand: isBrandDetected,
          detectedBrand: highlight.detectedBrand || 'none',
          productHook: highlight.productHook,
          sampleContext: scriptData.sampleContext,
          scenes: scriptData.scenes,
          voiceoverScript: scriptData.voiceoverScript,
          aiStudioPrompt: scriptData.aiStudioPrompt,
          caption: scriptData.caption,
          videoTitle: videoMeta.title,
          isOrphan: false,
        };

        activeJobs.set(jobId, completedResult);
        persistJob(jobId, completedResult);

        updateProgress({
          step: 'completed',
          message: '🎉 Video Final 9:16 + Voiceover Gadis Indonesia & Subtitle Selesai!',
          progress: 100,
          status: 'completed',
          result: completedResult,
        });

        return completedResult;
      } catch (mergeErr) {
        console.warn(`[Job ${jobId}] Auto merge error, falling back to awaiting_voiceover:`, mergeErr.message);
      }
    }

    // Fallback: If TTS or auto merge fails, pause at awaiting_voiceover so user can still continue
    const stage1Result = {
      ...extraJobMeta,
      jobId,
      stage: 'awaiting_voiceover',
      createdAt: jobMeta.createdAt,
      silentFileName,
      silentVideoUrl: `/api/video/${silentFileName}`,
      silentLocalPath: silentOutputPath,
      downloadedVideoPath: rawVideoPath,
      hasSilentVideo: true,
      hasFinalVideo: false,
      productTitle: productTitle || videoMeta.title,
      productDescription: productDescription || '',
      youtubeUrl,
      shopeeLink: shopeeLink || '',
      highlight: {
        startTime: highlight.startTime,
        endTime: highlight.endTime,
        duration: highlight.duration,
        hasProductBrand: isBrandDetected,
        detectedBrand: highlight.detectedBrand || 'none',
        allowHflip: !isBrandDetected,
        reframe: highlight.reframe,
        clips: highlight.clips
      },
      hasProductBrand: isBrandDetected,
      detectedBrand: highlight.detectedBrand || 'none',
      productHook: highlight.productHook,
      sampleContext: scriptData.sampleContext,
      scenes: scriptData.scenes,
      voiceoverScript: scriptData.voiceoverScript,
      aiStudioPrompt: scriptData.aiStudioPrompt,
      cleanScript: cleanScriptForTTS(rawVoiceScript),
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

    return stage1Result;
  } catch (error) {
    console.error(`[Job ${jobId}] Stage 1 Pipeline Error:`, error);

    // Immediately clean up temporary files so disk storage is freed
    deleteJobTempDirectory(jobId, tempDir);

    const isAuto = Boolean(extraJobMeta?.isAutoGenerated);
    if (isAuto) {
      // Failed auto jobs should not clutter the job list or disk
      deleteJobFiles(jobId, outputDir, tempDir);
      activeJobs.delete(jobId);
      deletePersistedJob(jobId);
    } else {
      const currentJob = activeJobs.get(jobId) || jobMeta;
      const errorJob = {
        ...currentJob,
        ...extraJobMeta,
        stage: 'error',
        lastError: error.message,
        errorAt: new Date().toISOString(),
      };
      activeJobs.set(jobId, errorJob);
      persistJob(jobId, errorJob);
    }

    const isQuotaError = isQuotaErrorMessage(error.message);
    updateProgress({
      step: 'error',
      message: error.message || 'An error occurred during video processing.',
      progress: 0, status: 'error', error: error.message, isQuotaError, canRetry: true
    });

    error.jobId = jobId;
    error.isQuotaError = isQuotaError;
    throw error;
  }
}

// 5. Manual STAGE 1 Endpoint
app.post('/api/generate', async (req, res) => {
  reloadEnvironment();
  const {
    youtubeUrl,
    shopeeLink,
    productTitle,
    productDescription,
    apiKey,
    options = {},
    aiProvider,
    jobId: clientJobId,
  } = req.body;

  if (aiProvider) {
    options.aiProvider = aiProvider;
  }

  if (!youtubeUrl) {
    return res.status(400).json({ error: 'YouTube Video URL is required.' });
  }
  if (!isValidHttpUrl(youtubeUrl) || !extractVideoId(youtubeUrl)) {
    return res.status(400).json({ error: 'URL YouTube tidak valid. Gunakan URL youtube.com atau youtu.be yang berisi video ID.' });
  }
  if (shopeeLink && !isValidHttpUrl(shopeeLink)) {
    return res.status(400).json({ error: 'Link produk harus berupa URL http/https yang valid.' });
  }

  const jobId = clientJobId || crypto.randomBytes(6).toString('hex');
  if (clientJobId && req.body.forceFreshVideo) {
    console.log(`[Job ${clientJobId}] Force-fresh generation requested: cleaning up old files...`);
    deleteJobFiles(clientJobId, outputDir, tempDir);
    const existingJob = activeJobs.get(clientJobId);
    if (existingJob) {
      existingJob.downloadedVideoPath = null;
      existingJob.hasDownloadedVideo = false;
      existingJob.hasFinalVideo = false;
      existingJob.hasSilentVideo = false;
      existingJob.stage = 'running';
    }
  }

  try {
    const stage1Result = await runStage1Pipeline({
      jobId,
      youtubeUrl,
      shopeeLink,
      productTitle,
      productDescription,
      apiKey,
      options,
    });
    res.json(stage1Result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      isQuotaError: error.isQuotaError || false,
      canRetry: true,
      jobId,
    });
  }
});

// ─── Auto Mode State & Endpoints ─────────────────────────────────────────────

function publicAutoRunState(run) {
  if (!run) return { status: 'idle' };
  return {
    runId: run.runId,
    status: run.status,
    maxJobs: run.maxJobs,
    successfulJobs: run.successfulJobs,
    failedJobs: run.failedJobs,
    skippedProducts: run.skippedProducts,
    currentJobId: run.currentJobId,
    currentProductTitle: run.currentProductTitle,
    message: run.message,
    progress: run.progress,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt || null,
    failures: run.failures.slice(-10),
  };
}

function updateAutoRun(run, patch) {
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  autoRuns.set(run.runId, run);
  console.log(`[Auto ${run.runId}] [${run.progress || 0}%] ${run.message || run.status}`);
}

function getLatestAutoRun() {
  const all = Array.from(autoRuns.values()).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return all[0] || null;
}

async function runAutoStage1Worker(run) {
  try {
    updateAutoRun(run, { status: 'running', message: 'Memulai pencarian produk viral Shopee...', progress: 5 });

    // Thoroughly shuffle 1000+ keywords so each auto run picks varied, fresh product categories
    const candidateKeywords = getAutoKeywords(1000);

    const seenShopeeUrls = new Set();
    const usedYouTubeVideoIds = getAllUsedYouTubeVideoIds();

    for (const keyword of candidateKeywords) {
      if (run.status === 'stopping' || run.status === 'stopped') break;
      if (run.successfulJobs >= run.maxJobs) break;

      const currentTargetIndex = run.successfulJobs + 1;
      updateAutoRun(run, {
        message: `Mencari produk (${currentTargetIndex}/${run.maxJobs}): "${keyword}"...`,
        progress: Math.min(95, Math.round((run.successfulJobs / run.maxJobs) * 100) || 5),
      });

      const product = await discoverSingleShopeeProduct(keyword, seenShopeeUrls);
      if (!product) {
        continue;
      }

      updateAutoRun(run, {
        currentProductTitle: product.title,
        message: `[${currentTargetIndex}/${run.maxJobs}] Menemukan: "${product.title.slice(0, 35)}...". Mencari video YouTube...`,
        progress: Math.min(95, Math.round((run.successfulJobs / run.maxJobs) * 100) + 3),
      });

      const candidates = await discoverYouTubeCandidatesForProduct({
        productTitle: product.title,
        productDescription: product.description,
        limit: 8,
        excludeVideoIds: usedYouTubeVideoIds,
        onProgress: (p) => updateAutoRun(run, { message: `[${currentTargetIndex}/${run.maxJobs}] ${p.message}` }),
      });

      if (!candidates.length) {
        run.skippedProducts++;
        updateAutoRun(run, { message: `[${currentTargetIndex}/${run.maxJobs}] Skip "${product.title.slice(0, 25)}...": Tidak ada video YouTube baru yang cocok.` });
        continue;
      }

      let jobSuccess = false;
      for (const candidate of candidates) {
        if (run.status === 'stopping' || run.status === 'stopped') break;
        const candidateVid = extractVideoId(candidate.url) || candidate.id;
        if (candidateVid) {
          usedYouTubeVideoIds.add(candidateVid);
        }

        const autoJobId = `auto_${crypto.randomBytes(5).toString('hex')}`;
        run.currentJobId = autoJobId;

        try {
          updateAutoRun(run, {
            message: `[${currentTargetIndex}/${run.maxJobs}] Memproses video untuk "${product.title.slice(0, 30)}..."...`,
            progress: Math.min(95, Math.round((run.successfulJobs / run.maxJobs) * 100) + 5),
          });

          await runStage1Pipeline({
            jobId: autoJobId,
            youtubeUrl: candidate.url,
            shopeeLink: product.url,
            productTitle: product.title,
            productDescription: product.description,
            apiKey: undefined,
            options: { ...run.options, aiProvider: run.options?.aiProvider || 'openrouter' },
            extraJobMeta: { autoRunId: run.runId, isAutoGenerated: true },
            requireCleanGeminiPlan: true,
            onProgress: (p) => {
              const baseProgress = Math.round((run.successfulJobs / run.maxJobs) * 100);
              const stepFraction = Math.round(((p.progress || 0) / 100) * (100 / run.maxJobs));
              updateAutoRun(run, {
                message: `[${currentTargetIndex}/${run.maxJobs}] ${p.message}`,
                progress: Math.min(98, baseProgress + stepFraction),
              });
            },
          });

          run.successfulJobs++;
          jobSuccess = true;
          updateAutoRun(run, {
            message: `✅ [${run.successfulJobs}/${run.maxJobs}] Selesai: "${product.title.slice(0, 35)}..."`,
            progress: Math.round((run.successfulJobs / run.maxJobs) * 100),
          });
          break; // Success! Move to next product keyword immediately
        } catch (err) {
          console.warn(`[Auto] Candidate rejected for ${product.title}:`, err.message);
          // Delete any temporary files/directories created during this candidate attempt
          deleteJobFiles(autoJobId, outputDir, tempDir);
          activeJobs.delete(autoJobId);
          deletePersistedJob(autoJobId);

          run.failures.push({ productTitle: product.title, error: err.message, time: new Date().toISOString() });
          
          const msg = (err.message || '').toLowerCase();
          const isCriticalApiError = msg.includes('401') || msg.includes('403') || msg.includes('api key') || msg.includes('unauthorized') || msg.includes('saldo') || msg.includes('kuota') || msg.includes('billing') || msg.includes('quota') || msg.includes('authenticationerror');
          if (isCriticalApiError) {
            console.error('[Auto] Critical API error detected. Stopping Auto-Run entirely.');
            throw err;
          }
          
          // Try next YouTube candidate for this product
        }
      }

      if (!jobSuccess) {
        run.failedJobs++;
        updateAutoRun(run, {
          failedJobs: run.failedJobs,
          message: `❌ [${currentTargetIndex}/${run.maxJobs}] Gagal: "${product.title.slice(0, 30)}..."`,
        });
      }

      // Graceful jitter delay between product batches to prevent aggressive scraping blocks
      if (currentTargetIndex < run.maxJobs && (run.status === 'running' || run.status === 'starting')) {
        const delayMs = 3000 + Math.floor(Math.random() * 2000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const finalStatus = run.status === 'stopping' ? 'stopped' : 'completed';
    updateAutoRun(run, {
      status: finalStatus,
      message: `Auto Mode selesai. Berhasil: ${run.successfulJobs}/${run.maxJobs}, Gagal: ${run.failedJobs}, Dilewati: ${run.skippedProducts}.`,
      progress: 100,
      finishedAt: new Date().toISOString(),
      currentJobId: null,
      currentProductTitle: null,
    });
  } catch (err) {
    console.error('[Auto] Fatal worker error:', err);
    updateAutoRun(run, {
      status: 'error',
      message: err.message || 'Auto Mode terhenti karena error.',
      progress: 100,
      finishedAt: new Date().toISOString(),
    });
  }
}

app.get('/api/auto/status', (req, res) => {
  res.json({ run: publicAutoRunState(getLatestAutoRun()) });
});

app.post('/api/auto/start', (req, res) => {
  reloadEnvironment();
  const latest = getLatestAutoRun();
  if (latest && latest.status === 'running') {
    return res.json({ run: publicAutoRunState(latest) });
  }

  const { maxJobs = 10, options = {} } = req.body || {};
  const runId = `autorun_${crypto.randomBytes(4).toString('hex')}`;
  const run = {
    runId,
    status: 'starting',
    maxJobs: Math.max(1, Math.min(50, Number(maxJobs) || 10)),
    successfulJobs: 0,
    failedJobs: 0,
    skippedProducts: 0,
    currentJobId: null,
    currentProductTitle: null,
    message: 'Memulai pipeline Auto Mode...',
    progress: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options,
    failures: [],
  };

  autoRuns.set(runId, run);
  runAutoStage1Worker(run);
  res.json({ run: publicAutoRunState(run) });
});

app.post('/api/auto/stop', (req, res) => {
  const { runId } = req.body || {};
  const run = autoRuns.get(runId) || getLatestAutoRun();
  if (run && run.status === 'running') {
    updateAutoRun(run, { status: 'stopping', message: 'Menghentikan Auto Mode setelah job saat ini selesai...' });
  }
  res.json({ run: publicAutoRunState(run) });
});

app.get('/api/auto/progress/:runId', (req, res) => {
  const { runId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = () => {
    const run = autoRuns.get(runId);
    res.write(`data: ${JSON.stringify({ run: publicAutoRunState(run) })}\n\n`);
    if (run && ['completed', 'stopped', 'error'].includes(run.status)) {
      clearInterval(interval);
      res.end();
    }
  };

  const interval = setInterval(sendProgress, 800);
  sendProgress();

  req.on('close', () => clearInterval(interval));
});

// 6. STAGE 2: Upload Voiceover & Merge Subtitles
app.post('/api/upload-voiceover', upload.single('audio'), async (req, res) => {
  reloadEnvironment();
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
  const srtPath = path.join(uploadsDir, `subtitles_${jobId}.ass`);

  const updateProgress = (data) => {
    const payload = typeof data === 'string'
      ? { step: 'processing', message: data, progress: 50, jobId }
      : { ...data, jobId };
    jobProgress.set(jobId, payload);
    console.log(`[Job ${jobId}] [${payload.progress || 0}%] ${payload.message}`);
  };

  updateProgress({ step: 'merge_start', message: 'Merging voiceover & burning subtitles...', progress: 20, status: 'running' });

  try {
    const silentDurationSec = await getMediaDurationSec(silentPath) || job.highlight?.duration || 45;
    const audioDurationSec = await getMediaDurationSec(audioFile.path);

    // Synchronize subtitle timeline directly to the exact duration of the voiceover audio
    const narrationDurationSec = (audioDurationSec && audioDurationSec > 0)
      ? Math.min(silentDurationSec, audioDurationSec)
      : silentDurationSec;

    const scriptToUse = (req.body?.customScript && req.body.customScript.trim())
      ? req.body.customScript.trim()
      : (job.aiStudioPrompt || job.voiceoverScript || '');

    updateProgress({ step: 'subtitles', message: `Generating synchronized subtitle captions for ${narrationDurationSec.toFixed(1)}s voiceover...`, progress: 40, status: 'running' });
    generateSrtSubtitles(scriptToUse, narrationDurationSec, srtPath);

    updateProgress({ step: 'render_final', message: 'Rendering final 9:16 video with Voiceover & Subtitles...', progress: 60, status: 'running' });
    await mergeVoiceoverAndBurnSubtitles({
      silentVideoPath: silentPath, voiceoverAudioPath: audioFile.path,
      srtPath,
      outputVideoPath: finalOutputPath,
      targetDurationSec: silentDurationSec,
      onProgress: updateProgress,
    });

    cleanupTempFiles([audioFile.path, srtPath]);

    deleteJobTempDirectory(jobId, tempDir);
    console.log(`[Cleaner] Raw YouTube video and temp files for job ${jobId} permanently removed.`);

    const cacheBuster = Date.now();
    const finalResult = {
      ...job,
      stage: 'completed',
      finalFileName,
      videoUrl: `/api/video/${finalFileName}?t=${cacheBuster}`,
      downloadUrl: `/api/download/${finalFileName}?t=${cacheBuster}`,
      finalLocalPath: finalOutputPath,
      downloadedVideoPath: null,
      hasDownloadedVideo: false,
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

/** Helper function to process voiceover & final video merge for a single job */
async function processJobVoiceover(jobId, customScript = null) {
  let job = activeJobs.get(jobId);
  if (!job && fs.existsSync(jobsFilePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(jobsFilePath, 'utf-8'));
      if (existing[jobId]) {
        job = existing[jobId];
        activeJobs.set(jobId, job);
      }
    } catch {}
  }

  const silentPath = job?.silentLocalPath || path.join(outputDir, `silent_clip_${jobId}.mp4`);

  if (!job || !fs.existsSync(silentPath)) {
    const notFoundErr = new Error(`File video 9:16 untuk job ${jobId} tidak ditemukan di folder output.`);
    notFoundErr.statusCode = 404;
    throw notFoundErr;
  }

  let scriptToUse = (customScript && customScript.trim())
    ? customScript.trim()
    : (job.aiStudioPrompt || job.voiceoverScript || '');

  if (!scriptToUse && Array.isArray(job.scenes) && job.scenes.length > 0) {
    scriptToUse = job.scenes.map((s, idx) => `[00:${String(idx * 5).padStart(2, '0')}] ${s.voiceover || ''}`).join('\n');
  }

  if (!scriptToUse && job.productTitle) {
    scriptToUse = `Kenalin, ${job.productTitle}! Solusi paling praktis buat kamu. Cek produk di bawah sekarang sebelum kehabisan!`;
  }

  if (!scriptToUse) {
    const emptyErr = new Error('Naskah voiceover tidak boleh kosong.');
    emptyErr.statusCode = 400;
    throw emptyErr;
  }

  const voiceoverFileName = `voiceover_${jobId}_${Date.now()}.mp3`;
  const voiceoverAudioPath = path.join(uploadsDir, voiceoverFileName);
  const finalFileName = `final_clip_${jobId}.mp4`;
  const finalOutputPath = path.join(outputDir, finalFileName);
  const srtPath = path.join(uploadsDir, `subtitles_${jobId}.ass`);

  const updateProgress = (data) => {
    const payload = typeof data === 'string'
      ? { step: 'processing', message: data, progress: 50, jobId }
      : { ...data, jobId };
    jobProgress.set(jobId, payload);
    console.log(`[Job ${jobId}] [${payload.progress || 0}%] ${payload.message}`);
  };

  try {
    updateProgress({ step: 'tts_generating', message: '🎙️ Menghasilkan voice over RINDI (Fish Audio S2.1 Pro)...', progress: 20, status: 'running' });

    const ttsResult = await generateVoiceoverTTS({
      script: scriptToUse,
      outputPath: voiceoverAudioPath,
      onProgress: (msg) => updateProgress({ step: 'tts_generating', message: `🎙️ ${msg}`, progress: 35, status: 'running' }),
      jobId,
    });

    const silentDurationSec = (await getMediaDurationSec(silentPath)) || job.highlight?.duration || 45;
    const audioDurationSec = await getMediaDurationSec(voiceoverAudioPath);
    const narrationDurationSec = (audioDurationSec && audioDurationSec > 0)
      ? Math.min(silentDurationSec, audioDurationSec)
      : silentDurationSec;

    updateProgress({ step: 'subtitles', message: `Menyinkronkan subtitle narasi (${narrationDurationSec.toFixed(1)}s)...`, progress: 55, status: 'running' });
    generateSrtSubtitles(ttsResult.cleanScript || scriptToUse, narrationDurationSec, srtPath);

    updateProgress({ step: 'render_final', message: 'Rendering video final 9:16 dengan Voiceover & Subtitles...', progress: 75, status: 'running' });
    await mergeVoiceoverAndBurnSubtitles({
      silentVideoPath: silentPath,
      voiceoverAudioPath,
      srtPath,
      outputVideoPath: finalOutputPath,
      targetDurationSec: silentDurationSec,
      onProgress: updateProgress,
    });

    cleanupTempFiles([srtPath]);

    const cacheBuster = Date.now();
    const updatedJob = {
      ...job,
      stage: 'completed',
      finalFileName,
      videoUrl: `/api/video/${finalFileName}?t=${cacheBuster}`,
      downloadUrl: `/api/download/${finalFileName}?t=${cacheBuster}`,
      finalLocalPath: finalOutputPath,
      voiceoverAudioUrl: `/api/audio/${voiceoverFileName}?t=${cacheBuster}`,
      ttsVoice: ttsResult.voice || 'RINDI (Fish Audio S2.1 Pro)',
      ttsProvider: ttsResult.provider || 'fish_audio',
      cleanScript: ttsResult.cleanScript,
      hasFinalVideo: true,
      hasSilentVideo: true,
      updatedAt: new Date().toISOString(),
    };

    activeJobs.set(jobId, updatedJob);
    persistJob(jobId, updatedJob);

    updateProgress({ step: 'completed', message: 'Final 9:16 Video Ready!', progress: 100, status: 'completed', result: updatedJob });
    return updatedJob;
  } catch (error) {
    console.error(`[Job ${jobId}] Voiceover Process Error:`, error.message);
    cleanupTempFiles([voiceoverAudioPath, srtPath]);
    const isQuota = error.isQuotaError || isQuotaErrorMessage(error.message);
    error.isQuotaError = isQuota;
    updateProgress({ step: 'error', message: error.message, progress: 0, status: 'error', error: error.message, isQuotaError: isQuota, canRetry: true });
    throw error;
  }
}

// 6b. Regenerate Voiceover automatically via TTS & Re-render Final Video (Single Job)
app.post('/api/regenerate-voiceover', async (req, res) => {
  reloadEnvironment();
  const { jobId, customScript } = req.body;

  if (!jobId) return res.status(400).json({ error: 'Job ID is required.' });

  try {
    const updatedJob = await processJobVoiceover(jobId, customScript);
    res.json({ success: true, ...updatedJob });
  } catch (error) {
    const isQuota = error.isQuotaError || isQuotaErrorMessage(error.message);
    const status = error.statusCode || (isQuota ? 402 : 500);
    res.status(status).json({ success: false, error: error.message, isQuotaError: isQuota, jobId });
  }
});

// State tracker for server-side Batch TTS Queue
let currentBatchTTS = {
  isRunning: false,
  isStopping: false,
  totalJobs: 0,
  currentIndex: 0,
  currentJobId: null,
  currentProductTitle: '',
  successfulJobs: 0,
  failedJobs: 0,
  lastError: null,
  isQuotaExhausted: false,
  startedAt: null,
  completedAt: null,
};

// 6c. Start Server-Side Batch TTS Queue
app.post('/api/batch-tts/start', async (req, res) => {
  reloadEnvironment();

  if (currentBatchTTS.isRunning) {
    return res.json({ success: true, batch: currentBatchTTS, message: 'Batch TTS sudah berjalan di server.' });
  }

  // Reload disk jobs to make sure we don't miss any jobs
  loadJobsFromDisk();

  // Find all candidate jobs that have a 9:16 silent video ready on disk but do not have a completed final video yet
  const candidateJobs = [];
  for (const [jobId, job] of activeJobs.entries()) {
    const silentPath = job.silentLocalPath || path.join(outputDir, `silent_clip_${jobId}.mp4`);
    const finalPath = job.finalLocalPath || path.join(outputDir, `final_clip_${jobId}.mp4`);

    const hasSilent = fs.existsSync(silentPath);
    const hasFinal = fs.existsSync(finalPath);

    if (hasSilent && !hasFinal) {
      candidateJobs.push({ jobId, job });
    }
  }

  if (candidateJobs.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Tidak ada job yang siap untuk TTS (semua video sudah selesai atau belum ada klip 9:16 tersimpan).',
    });
  }

  // Sort candidate jobs: oldest first so we complete earlier jobs in sequence
  candidateJobs.sort((a, b) => {
    const dateA = a.job.createdAt ? new Date(a.job.createdAt).getTime() : 0;
    const dateB = b.job.createdAt ? new Date(b.job.createdAt).getTime() : 0;
    return dateA - dateB;
  });

  currentBatchTTS = {
    isRunning: true,
    isStopping: false,
    totalJobs: candidateJobs.length,
    currentIndex: 0,
    currentJobId: candidateJobs[0]?.jobId || null,
    currentProductTitle: candidateJobs[0]?.job?.productTitle || '',
    successfulJobs: 0,
    failedJobs: 0,
    lastError: null,
    isQuotaExhausted: false,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  res.json({ success: true, batch: currentBatchTTS });

  // Run the batch asynchronously in the background on the server!
  (async () => {
    console.log(`[Batch TTS] 🚀 Starting server-side sequential queue for ${candidateJobs.length} jobs...`);

    for (let i = 0; i < candidateJobs.length; i++) {
      if (currentBatchTTS.isStopping) {
        console.log('[Batch TTS] ⏹️ Queue stopped by user request.');
        break;
      }

      const { jobId, job } = candidateJobs[i];
      currentBatchTTS.currentIndex = i;
      currentBatchTTS.currentJobId = jobId;
      currentBatchTTS.currentProductTitle = job.productTitle || `Job ${jobId}`;

      console.log(`[Batch TTS] (${i + 1}/${candidateJobs.length}) Processing: "${currentBatchTTS.currentProductTitle}" [${jobId}]`);

      try {
        await processJobVoiceover(jobId);
        currentBatchTTS.successfulJobs++;
        console.log(`[Batch TTS] ✅ Success (${currentBatchTTS.successfulJobs}/${candidateJobs.length}) on Job [${jobId}]`);
      } catch (err) {
        console.error(`[Batch TTS] ❌ Failed Job [${jobId}]:`, err.message);
        currentBatchTTS.failedJobs++;
        currentBatchTTS.lastError = err.message;

        if (err.isQuotaError || isQuotaErrorMessage(err.message)) {
          currentBatchTTS.isQuotaExhausted = true;
          console.warn('[Batch TTS] ⚠️ Fish Audio quota exhausted. Pausing batch queue.');
          break;
        }
        // Non-quota error: DO NOT STOP! Keep processing the remaining jobs!
      }
    }

    currentBatchTTS.isRunning = false;
    currentBatchTTS.isStopping = false;
    currentBatchTTS.completedAt = new Date().toISOString();
    console.log(`[Batch TTS] 🏁 Finished queue: ${currentBatchTTS.successfulJobs} success, ${currentBatchTTS.failedJobs} failed.`);
  })().catch(fatalErr => {
    console.error('[Batch TTS] Fatal queue failure:', fatalErr);
    currentBatchTTS.isRunning = false;
  });
});

// 6d. Get Batch TTS Status
app.get('/api/batch-tts/status', (req, res) => {
  res.json({ batch: currentBatchTTS });
});

// 6e. Stop Batch TTS
app.post('/api/batch-tts/stop', (req, res) => {
  if (currentBatchTTS.isRunning) {
    currentBatchTTS.isStopping = true;
  }
  res.json({ success: true, batch: currentBatchTTS });
});

// 6c. Stream generated audio files
app.get('/api/audio/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename || '');
  if (!safeName.endsWith('.mp3') && !safeName.endsWith('.wav') && !safeName.endsWith('.m4a')) {
    return res.status(400).send('Invalid audio filename.');
  }

  const audioPath = path.resolve(uploadsDir, safeName);
  if (!audioPath.startsWith(path.resolve(uploadsDir)) || !fs.existsSync(audioPath)) {
    return res.status(404).send('Audio file not found.');
  }

  const stat = fs.statSync(audioPath);
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(audioPath).pipe(res);
});

// 7. Stream output video
app.get('/api/video/:filename', (req, res) => {
  const filePath = resolveOutputVideoPath(req.params.filename);
  if (!filePath) return res.status(400).send('Invalid video filename.');
  if (!fs.existsSync(filePath)) return res.status(404).send('Video not found.');
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= fileSize) {
      return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    }
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

// 8. Download endpoint for videos
app.get('/api/download/:filename', (req, res) => {
  const filePath = resolveOutputVideoPath(req.params.filename);
  if (!filePath) return res.status(400).json({ error: 'Invalid filename.' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found.' });
  res.download(filePath, req.params.filename);
});

// 8b. Download script & marketing text as .txt file via HTTP
app.get('/api/jobs/:jobId/script.txt', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  if (!job) return res.status(404).send('Job not found.');

  const filename = `naskah_${(job.productTitle || jobId).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}_${jobId}.txt`;
  
  const content = [
    `======================================================`,
    `AFFILIATE VIDEO ASSETS & SCRIPT`,
    `Job ID        : ${jobId}`,
    `Judul Produk  : ${job.productTitle || '-'}`,
    `Link Shopee   : ${job.shopeeLink || '-'}`,
    `Hook Visual   : ${job.productHook || '-'}`,
    `Dibuat Pada   : ${job.createdAt || new Date().toISOString()}`,
    `======================================================\n`,
    `--- 1. NASKAH VOICEOVER (AD ADVISOR) ---`,
    job.voiceoverScript || '(Belum ada naskah)',
    `\n------------------------------------------------------\n`,
    `--- 2. PROMPT GOOGLE AI STUDIO (TTS Composer) ---`,
    job.aiStudioPrompt || '(Belum ada prompt AI Studio)',
    `\n------------------------------------------------------\n`,
    `--- 3. CAPTION & HASHTAGS REELS / TIKTOK ---`,
    sanitizeCaptionText(job.caption || '') || '(Belum ada caption)',
    `\n------------------------------------------------------\n`,
    `--- 4. KOTAK SCENE BREAKDOWN (5 DETIK) ---`,
    ...(Array.isArray(job.scenes) ? job.scenes.map(s => `[Scene ${s.sceneNumber}] (${s.timeRange || s.startTime + ' - ' + s.endTime})\nVisual: ${s.visualDescription}\nNarasi: "${s.voiceover}"\nNotes : ${s.adAdvisorNotes || '-'}\n`) : ['-']),
    `======================================================`
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

// 9. Open output folder in native OS file explorer
app.post('/api/open-folder', (req, res) => {
  const { filename } = req.body || {};
  let targetFile = null;

  if (filename) {
    const candidate = resolveOutputVideoPath(filename);
    if (candidate && fs.existsSync(candidate)) {
      targetFile = candidate;
    }
  }

  let command = '';
  if (process.platform === 'win32') {
    if (targetFile) {
      command = `explorer.exe /select,"${targetFile.replace(/\//g, '\\')}"`;
    } else {
      command = `explorer.exe "${outputDir.replace(/\//g, '\\')}"`;
    }
  } else if (process.platform === 'darwin') {
    if (targetFile) {
      command = `open -R "${targetFile}"`;
    } else {
      command = `open "${outputDir}"`;
    }
  } else {
    command = `xdg-open "${outputDir}"`;
  }

  console.log(`[System] Opening output folder in file manager: ${command}`);
  exec(command, (err) => {
    if (err) {
      console.warn('[System] Could not open folder:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, folder: outputDir, target: targetFile });
  });
});

app.get('/api/open-folder', (req, res) => {
  let command = process.platform === 'win32'
    ? `explorer.exe "${outputDir.replace(/\//g, '\\')}"`
    : process.platform === 'darwin' ? `open "${outputDir}"` : `xdg-open "${outputDir}"`;
  exec(command, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, folder: outputDir });
  });
});

// 10. Restart Server & Execute ./update.sh (Designed for Termux, Codespace & Local Dev)
app.post('/api/restart', async (req, res) => {
  const { runUpdate = true } = req.body || {};
  const rootDir = path.resolve(__dirname, '..');
  const updateScriptPath = path.join(rootDir, 'update.sh');

  console.log(`[System] Received restart request (runUpdate=${runUpdate})...`);
  let updateLog = '';
  let updateExitCode = 0;

  if (runUpdate) {
    console.log('[System] Menjalankan ./update.sh sebelum me-restart server...');
    try {
      updateExitCode = await new Promise((resolve) => {
        const child = fs.existsSync(updateScriptPath)
          ? spawn('bash', [updateScriptPath], { cwd: rootDir })
          : spawn('git', ['pull', '--ff-only'], { cwd: rootDir });

        child.stdout.on('data', (chunk) => { updateLog += chunk.toString(); });
        child.stderr.on('data', (chunk) => { updateLog += chunk.toString(); });
        child.on('error', (err) => {
          updateLog += `\nError: ${err.message}`;
          console.warn('[System] Warning saat menjalankan update:', err.message);
          resolve(1);
        });
        child.on('close', (code) => {
          if (code !== 0) {
            console.warn(`[System] Warning: update process exited with code ${code}`);
          }
          console.log('[System] Log update.sh:\n' + updateLog);
          resolve(code || 0);
        });
      });
    } catch (e) {
      console.warn('[System] Gagal menjalankan update script:', e.message);
      updateLog += `\nError: ${e.message}`;
      updateExitCode = 1;
    }

    if (updateExitCode !== 0) {
      return res.status(500).json({
        success: false,
        message: 'Update dibatalkan atau gagal. Server tidak di-restart.',
        updateLog,
      });
    }
  }

  res.json({
    success: true,
    message: 'Perintah update.sh selesai dijalankan. Server sedang me-restart...',
    updateLog,
  });

  // Gracefully exit so dev-runner / node --watch / process manager restarts the process
  setTimeout(() => {
    console.log('[System] Restarting backend server now (process.exit)...');
    process.exit(0);
  }, 1200);
});

// ── Cookie Management Routes (for Codespace / Linux servers with no browser) ──

// GET /api/cookies-status – check if cookies.txt is present on the server
app.get('/api/cookies-status', (req, res) => {
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    const stat = fs.statSync(cookiesPath);
    res.json({ exists: true, sizeBytes: stat.size });
  } else {
    res.json({ exists: false });
  }
});

// POST /api/upload-cookies – receive cookies.txt content and save to server/cookies.txt
app.post('/api/upload-cookies', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  const content = req.body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Request body is empty. Please send cookies.txt content.' });
  }
  if (!content.includes('youtube.com') && !content.includes('# Netscape HTTP Cookie File')) {
    return res.status(400).json({ success: false, error: 'File tidak terdeteksi sebagai YouTube cookies.txt yang valid. Pastikan Anda mengekspor cookies dari youtube.com.' });
  }
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  fs.writeFileSync(cookiesPath, content, 'utf8');
  console.log(`[Cookies] cookies.txt saved to ${cookiesPath} (${content.length} bytes)`);
  res.json({ success: true, message: 'cookies.txt berhasil disimpan. Sekarang retry job Anda.' });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File voiceover maksimal 50 MB.'
      : err.message;
    return res.status(400).json({ success: false, error: message });
  }
  if (err) {
    return res.status(400).json({ success: false, error: err.message || 'Request tidak valid.' });
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  reloadEnvironment();
  const openRouterKey = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.trim() : '';
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const activeProvider = (openRouterKey && openRouterKey !== 'your_openrouter_api_key_here')
    ? `✨ OpenRouter (Primary)`
    : (geminiKey && geminiKey !== 'your_gemini_api_key_here' ? `✨ Google Gemini Direct (Primary)` : '❌ None (Set OPENROUTER_API_KEY or GEMINI_API_KEY in server/.env)');

  console.log(`\n======================================================`);
  console.log(`🎬 Local AI Affiliate Clipper Backend Server`);
  console.log(`🌐 Running at: http://localhost:${PORT}`);
  if (loadedEnvFiles.length) {
    console.log(`[Env] Loaded: ${loadedEnvFiles.map((envPath) => path.relative(path.resolve(__dirname, '..'), envPath).replace(/\\/g, '/')).join(', ')}`);
  }
  console.log(`⚡ Active AI Engine: ${activeProvider}`);
  if (openRouterKey && openRouterKey !== 'your_openrouter_api_key_here') {
    console.log(`🔑 OpenRouter Key: configured (${openRouterKey.length} chars)`);
  }
  if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
    console.log(`🔑 Google Gemini API: configured (Direct fallback ready)`);
  }
  console.log(`======================================================\n`);
});
