import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { getMediaDurationSec } from './videoRenderer.js';
import { saveToEnglishDictionary } from './dictionaryService.js';
import { trackBandwidth } from './bandwidthTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.txt'),
  path.join(__dirname, '..', '..', '.env'),
  path.join(__dirname, '..', '..', '.env.txt'),
  path.join(process.cwd(), 'server', '.env'),
  path.join(process.cwd(), 'server', '.env.txt'),
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '.env.txt'),
];

function cleanEnvKey(key) {
  if (!key) return '';
  let cleaned = String(key).trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function loadEnvFromDisk() {
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      try {
        const raw = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
        const parsed = dotenv.parse(raw);
        for (const [key, value] of Object.entries(parsed)) {
          const cleaned = cleanEnvKey(value);
          if (cleaned && !cleaned.startsWith('your_') && !cleaned.endsWith('_here')) {
            process.env[key] = cleaned;
            process.env[key.toUpperCase()] = cleaned;
          }
        }
        // Manual line-by-line fallback parser (handles Android/Google Drive line endings & BOM)
        const lines = raw.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const k = trimmed.slice(0, eqIdx).replace(/^\uFEFF/, '').trim();
            const v = cleanEnvKey(trimmed.slice(eqIdx + 1));
            if (v && !v.startsWith('your_') && !v.endsWith('_here')) {
              process.env[k] = v;
              process.env[k.toUpperCase()] = v;
            }
          }
        }
      } catch (err) {
        console.warn(`[Peringatan] Gagal membaca file ${envPath}: ${err.message}. (Jika ini di Termux, mungkin masalah izin/permission. Coba jalankan: chmod 644 ${envPath})`);
      }
    }
  }
}

const defaultOpenRouterModels = [
  "openrouter/free",
  "openrouter/auto",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",
  "minimax/minimax-m3:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
];

function getEffectiveOpenRouterModels() {
  loadEnvFromDisk();
  const customModel = (process.env.OPENROUTER_MODEL || '').trim();
  const models = [];
  if (customModel && !customModel.startsWith('your_') && !customModel.endsWith('_here')) {
    models.push(customModel);
  }
  for (const m of defaultOpenRouterModels) {
    if (!models.includes(m)) models.push(m);
  }
  return models;
}

function getOpenRouterKeys(apiKeyOverride) {
  loadEnvFromDisk();
  const keys = [];
  if (apiKeyOverride) {
    const cleaned = cleanEnvKey(apiKeyOverride);
    if (cleaned && !cleaned.startsWith('your_') && !cleaned.endsWith('_here')) {
      keys.push(cleaned);
    }
  }
  
  const envKeys = Object.keys(process.env).filter(k => k.startsWith('OPENROUTER_API_KEY')).sort();
  
  for (const k of envKeys) {
    const cleaned = cleanEnvKey(process.env[k]);
    if (cleaned && !cleaned.startsWith('your_') && !cleaned.endsWith('_here')) {
      if (!keys.includes(cleaned)) keys.push(cleaned);
    }
  }
  return keys;
}

let currentOpenRouterKeyIndex = 0;

const defaultGeminiDirectModels = [
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
];

export function getDirectGeminiApiKey(apiKeyOverride) {
  loadEnvFromDisk();
  if (apiKeyOverride) {
    const cleaned = cleanEnvKey(apiKeyOverride);
    if (cleaned.startsWith('AIzaSy')) return cleaned;
  }
  return cleanEnvKey(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
}

export function getDirectGeminiClientConfig({ apiKeyOverride } = {}) {
  const apiKey = getDirectGeminiApiKey(apiKeyOverride);
  if (!apiKey || apiKey.startsWith('your_') || apiKey.endsWith('_here')) return null;

  return {
    client: new OpenAI({
      apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      timeout: 120000,
    }),
    models: defaultGeminiDirectModels,
    provider: 'Google Gemini Direct',
  };
}

function getAiClientConfig({ apiKeyOverride, aiProvider } = {}) {
  loadEnvFromDisk();

  const reqProvider = (aiProvider || '').trim().toLowerCase();
  const envEngine = (process.env.ACTIVE_AI_ENGINE || '').trim().toLowerCase();
  const openRouterKeys = getOpenRouterKeys(apiKeyOverride);

  // If Gemini Direct is requested (via provider option, .env ACTIVE_AI_ENGINE=gemini, or AIzaSy API key)
  const forceGeminiDirect = (
    apiKeyOverride?.startsWith('AIzaSy') ||
    reqProvider === 'gemini_direct' ||
    reqProvider === 'gemini' ||
    envEngine === 'gemini' ||
    envEngine === 'gemini_direct' ||
    (openRouterKeys.length === 0)
  );
  if (forceGeminiDirect) {
    const geminiConf = getDirectGeminiClientConfig({ apiKeyOverride });
    if (geminiConf) {
      console.log(`[AIService] Initialize Direct Google Gemini Client (${geminiConf.models[0]})...`);
      return geminiConf;
    }
  }

  // Priority 1: OpenRouter (high quality free vision models: MiniMax M3, openrouter/free, openrouter/auto, Nemotron 30B)
  if (openRouterKeys.length > 0) {
    const safeIndex = currentOpenRouterKeyIndex % openRouterKeys.length;
    currentOpenRouterKeyIndex++; 

    console.log(`[AIService] Initialize OpenRouter Client: Key=${openRouterKeys[safeIndex].substring(0, 10)}... (Models: ${getEffectiveOpenRouterModels().join(', ')})`);

    return {
      client: new OpenAI({
        apiKey: openRouterKeys[safeIndex],
        baseURL: 'https://openrouter.ai/api/v1',
        timeout: 120000,
        defaultHeaders: {
          "HTTP-Referer": "https://github.com/affiliate-clipper",
          "X-Title": "AI Affiliate Clipper",
        }
      }),
      models: getEffectiveOpenRouterModels(),
      provider: 'OpenRouter',
      keyIndex: safeIndex,
      totalKeys: openRouterKeys.length
    };
  }

  // Priority 2: Direct Google Gemini API fallback
  const directGemini = getDirectGeminiClientConfig({ apiKeyOverride });
  if (directGemini) {
    console.log(`[AIService] Initialize Direct Google Gemini Client (${directGemini.models[0]})...`);
    return directGemini;
  }

  throw new Error('API Key belum disetel di server/.env. Silakan tambahkan OPENROUTER_API_KEY atau GEMINI_API_KEY di file server/.env.');
}

const DEFAULT_REFRAME = {
  focusX: 0.5,
  focusY: 0.5,
  cropStrategy: 'faceless_product_hands_avoid_creator_text',
  renderMode: 'stage_80',
  avoidTextZones: [],
  avoidFaceZones: ['top', 'upper_middle'],
  faceSafety: true,
  notes: '',
};

/**
 * Helper to format AI API errors into clear Indonesian messages.
 */
function formatApiError(err, modelName = 'AI', provider = 'AI') {
  const status = err.status || err.statusCode;
  const message = err.message || '';

  if (status === 402 || message.toLowerCase().includes('insufficient') || message.toLowerCase().includes('balance') || message.toLowerCase().includes('quota') || message.toLowerCase().includes('credit')) {
    return `Saldo / Kuota ${provider} API Anda tidak mencukupi. Silakan periksa akun ${provider} Anda.`;
  }
  if (status === 402 || message.toLowerCase().includes('more credits') || message.toLowerCase().includes('can only afford')) {
    return `Saldo / Credit OpenRouter Anda tidak mencukupi untuk memproses video ini. Silakan lakukan top-up (Deposit) di https://openrouter.ai/settings/credits.`;
  }
  if (status === 401 || message.toLowerCase().includes('invalid api key') || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('api_key_invalid')) {
    return `${provider} API Key tidak valid atau tidak memiliki izin akses. Silakan periksa kembali API Key Anda di file server/.env.`;
  }
  if (status === 429 || message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('resource_exhausted')) {
    return `Batas frekuensi permintaan (Rate Limit) ${provider} tercapai. Silakan tunggu beberapa saat dan coba lagi.`;
  }
  if (status === 404 || message.toLowerCase().includes('model_not_found') || message.toLowerCase().includes('does not exist')) {
    return `Semua model fallback gagal. Model terakhir yang dicoba ('${modelName}') tidak tersedia di akun ${provider} Anda.`;
  }
  return `${provider} API Error (${modelName}): ${message}`;
}

/**
 * Stage 1 Jalur 1: Analyzes a public YouTube video directly via Google Gemini API using native video streaming (fileUri).
 * Zero download on local server, zero FFmpeg frame extraction, zero base64 payload.
 */
export async function analyzeYouTubeVideoWithGemini({
  youtubeUrl,
  apiKey,
  productTitle,
  productDescription,
  shopeeLink,
  sceneDuration = 3.3,
  allowFallbackClips = false,
  totalDuration = 600,
  onProgress = () => {},
}) {
  const geminiKey = getDirectGeminiApiKey(apiKey);
  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY belum disetel di server/.env untuk Google Gemini.');
  }

  if (!youtubeUrl) {
    throw new Error('URL YouTube tidak valid.');
  }

  const clipSec = Math.max(2.5, Math.min(5.0, Number(sceneDuration) || 3.3));
  const effectiveTitle = (productTitle || '').trim() || 'Produk Affiliate';
  const effectiveDesc = (productDescription || '').trim();

  onProgress({
    step: 'gemini_vision',
    message: 'Google Gemini 3.6 Flash menganalisa stream video langsung dari YouTube (0 MB kuota lokal)...',
    progress: 46,
  });

  const genAI = new GoogleGenerativeAI(geminiKey);
  const videoPrompt = `You are an elite Quality Control (QC) Director for Affiliate Product Video Ads.
Evaluate this YouTube video carefully against the following 5 MANDATORY ACCEPTANCE CRITERIA:

CRITERION 1: EXACT PHYSICAL PRODUCT MATCH
- Does the physical item demonstrated in the video match "${effectiveTitle}"?
${effectiveDesc ? `  (Product Description: "${effectiveDesc}")` : ''}
- REJECT IMMEDIATELY if it is a DIFFERENT product or a compilation/haul video showing multiple random items.

CRITERION 2: WATERMARKS, SOCIAL MEDIA LOGOS, & CHANNEL IDENTITIES (9:16 CROP TOLERANCE RULE)
- 9:16 CROP GEOMETRY:
  * Both 'clipper' (9:16 vertical) and 'YTCLIPER' (16:9 with background color pillars) crop the central 9:16 vertical frame (the middle ~45-50% width of the horizontal video).
  * The outer left margins (0-20% from left edge) and outer right margins (80-100% from right edge) are COMPLETELY CROPPED OUT or covered by background pillars!
- PERIPHERAL CORNER WATERMARK / LOGO TOLERANCE (100% ACCEPTABLE):
  * Jika ada watermark, logo media sosial (TikTok/Douyin/YouTube), atau nama channel di pojok KIRI atau KANAN video (di luar frame 9:16 tengah): TETAP DITERIMA! JANGAN DITOLAK! Karena bagian kiri dan kanan ini akan terpotong bersih atau tertutup background.
- STRICT ZERO-TOLERANCE INSIDE THE 9:16 OUTPUT FRAME:
  * DILARANG KERAS jika watermark digital, logo TikTok/YouTube, atau identitas channel MASUK KE DALAM FRAME 9:16 TENGAH (area yang menutupi peragaan produk)!
  * Setiap watermark atau logo yang masuk ke dalam frame 9:16 wajib DITOLAK karena tidak bisa terpotong.
- PHYSICAL PRODUCT BRANDING IS 100% ACCEPTABLE:
  * Merek, logo, atau tulisan yang tercetak/terukir secara fisik pada bodi produk (misal: "Philips", "Joybos", "Xiaomi") BUKAN watermark dan 100% DITERIMA!

CRITERION 3: ZERO SUBTITLES & ZERO BURNED-IN TEXT INSIDE 9:16 OUTPUT
- The backend generates and burns its own clean, animated subtitles.
- REJECT if speech dialogue captions, translated subtitles, lyric bars, or running dialogue text are visible INSIDE the 9:16 output frame (bottom or center), as this causes ugly overlapping double-subtitles.
- Physical text/button labels directly on the physical product ("Power", "ON/OFF", "500ml") are 100% ACCEPTABLE.

CRITERION 4: STRICT 100% WHOLE-VIDEO FACELESS MANDATE (ZERO TOLERANCE FOR FACES ANYWHERE)
- The entire source video MUST be 100% faceless and human-free!
- ZERO TOLERANCE FOR FACES: Does ANY part of the video show a human face, head, hair, neck, torso, or person talking (vlogger, host, presenter, bystander)?
  * If YES -> REJECT THE ENTIRE VIDEO IMMEDIATELY!
  * Dilarang keras memilih potongan tangan dari video yang ada vlogger atau orangnya!
- The ONLY permitted footage is pure tabletop/countertop product demonstration where HANDS/FINGERS ONLY actively operate the product.

CRITERION 5: CLEAN TIMESTAMP SELECTION
- Select 5 to 8 non-overlapping timestamps (each about ${clipSec}s long) showing the best, satisfying hands-on product actions.
- Each timestamp in "timestamps" MUST be in seconds from the start of the video where the 9:16 center area is 100% faceless, free of subtitles, and free of watermarks/logos.
- If the video does NOT contain at least 5 clean faceless product clips inside the 9:16 frame: MUST BE REJECTED.

Output valid JSON ONLY with this exact format:
If ACCEPTED:
{
  "status": "accept",
  "detectedProduct": "<nama produk>",
  "isExactProductMatch": true,
  "isFacelessIn916Frame": true,
  "hasHumanOrFaceAnywhereInVideo": false,
  "hasFaceIn916Frame": false,
  "hasWatermarkIn916Frame": false,
  "hasSocialOrChannelLogoIn916Frame": false,
  "hasSubtitlesIn916Frame": false,
  "hasOnlyPhysicalProductText": true,
  "isAiGeneratedOrSynthetic": false,
  "timestamps": [15, 25, 40, 60, 85, 110],
  "productHook": "Kalau [kebiasaan lama], fix [masalah fatal / kurang maksimal]!",
  "hasProductBrand": false,
  "detectedBrand": "none"
}

If REJECTED:
{
  "status": "reject",
  "detectedProduct": "<nama produk di video>",
  "isExactProductMatch": false,
  "isFacelessIn916Frame": false,
  "hasFaceIn916Frame": true,
  "hasWatermarkIn916Frame": false,
  "hasSocialOrChannelLogoIn916Frame": false,
  "hasSubtitlesIn916Frame": false,
  "hasOnlyPhysicalProductText": false,
  "isAiGeneratedOrSynthetic": false,
  "reason": "<alasan penolakan spesifik dalam bahasa Indonesia, misal: 'Watermark masuk ke dalam frame 9:16', 'Menampilkan wajah orang/vlogger', 'Mengandung subtitle ucapan', atau 'Produk tidak cocok'>"
}`;

  const candidateModels = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.5-flash'];
  let parsed = null;
  let activeGeminiModel = candidateModels[0];
  let lastGeminiErr = null;

  for (const modelName of candidateModels) {
    try {
      console.log(`[Gemini YouTube Stream] Calling model: ${modelName} for ${youtubeUrl}...`);
      activeGeminiModel = modelName;
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      trackBandwidth('aiRequests', 2500, `Gemini YouTube Stream (${modelName})`);
      const result = await model.generateContent([
        {
          fileData: {
            fileUri: youtubeUrl,
            mimeType: 'video/mp4',
          },
        },
        { text: videoPrompt },
      ]);

      const rawText = result.response.text();
      console.log(`[Gemini YouTube Stream ${modelName}] Response:`, rawText);
      parsed = repairJson(rawText);
      if (parsed && (parsed.status || parsed.timestamps || parsed.reason)) {
        break;
      }
    } catch (gemErr) {
      console.warn(`[Gemini YouTube Stream] Model ${modelName} error:`, gemErr.message);
      lastGeminiErr = gemErr;
    }
  }

  if (!parsed) {
    throw lastGeminiErr || new Error('Gemini YouTube Stream gagal menganalisa video.');
  }

  const rawStatus = String(parsed.status || '').toLowerCase().trim();
  const isRejectStatus = rawStatus === 'reject' || rawStatus === 'rejected' || rawStatus === 'ditolak';
  const isMatchFalse = parsed.isProductMatch === false || parsed.isExactProductMatch === false;
  const hasFace = parsed.hasFaceIn916Frame === true ||
    parsed.hasFaceOrHumanInSelectedFrames === true ||
    parsed.hasHumanOrFaceAnywhereInVideo === true ||
    parsed.isFacelessIn916Frame === false ||
    parsed.isFacelessAndHumanFree === false;
  const hasWatermarkInFrame = parsed.hasWatermarkIn916Frame === true || parsed.hasCenterObstructingWatermark === true;
  const hasSocialOrChannelInFrame = parsed.hasSocialOrChannelLogoIn916Frame === true || parsed.hasSocialMediaOrChannelIdentityIn916Frame === true;
  const hasSubtitles = parsed.hasSubtitlesIn916Frame === true || parsed.hasSubtitlesOrBurnedText === true || parsed.hasBurnedText === true;
  const isSynthetic = parsed.isAiGeneratedOrSynthetic === true;
  const reasonText = String(parsed.reason || parsed.rejectionReason || '').trim();
  const reasonLower = reasonText.toLowerCase();

  const mentionsFaceInReason = reasonLower.includes('wajah') || reasonLower.includes('face') || reasonLower.includes('manusia') || reasonLower.includes('orang');
  const mentionsWatermarkInFrame = isRejectStatus && (reasonLower.includes('watermark') || reasonLower.includes('capcut')) && !reasonLower.includes('terpotong') && !reasonLower.includes('luar frame') && !reasonLower.includes('di luar 9:16');
  const mentionsLogoInFrame = isRejectStatus && (reasonLower.includes('logo') || reasonLower.includes('tiktok') || reasonLower.includes('channel') || reasonLower.includes('identitas') || reasonLower.includes('sosmed')) && !reasonLower.includes('terpotong') && !reasonLower.includes('luar frame') && !reasonLower.includes('di luar 9:16');
  const mentionsSubtitlesInReason = reasonLower.includes('subtitle') || reasonLower.includes('caption') || reasonLower.includes('teks berjalan') || reasonLower.includes('terjemahan');

  const shouldReject = isRejectStatus || isMatchFalse || hasFace || hasWatermarkInFrame || hasSocialOrChannelInFrame || hasSubtitles || isSynthetic ||
    mentionsFaceInReason || mentionsWatermarkInFrame || mentionsLogoInFrame || mentionsSubtitlesInReason;

  if (shouldReject) {
    let rejectionMsg = reasonText;
    if (!rejectionMsg) {
      if (hasFace || mentionsFaceInReason) {
        rejectionMsg = 'Video ditolak oleh AI: Menampilkan wajah atau manusia (wajib 100% faceless tabletop dari awal sampai akhir).';
      } else if (hasWatermarkInFrame || mentionsWatermarkInFrame) {
        rejectionMsg = 'Video ditolak oleh AI: Mengandung watermark digital yang masuk ke dalam frame 9:16 output.';
      } else if (hasSocialOrChannelInFrame || mentionsLogoInFrame) {
        rejectionMsg = 'Video ditolak oleh AI: Mengandung logo media sosial atau identitas channel yang masuk ke frame 9:16.';
      } else if (hasSubtitles || mentionsSubtitlesInReason) {
        rejectionMsg = 'Video ditolak oleh AI: Mengandung subtitle atau teks caption ucapan bawaan di frame 9:16.';
      } else if (isSynthetic) {
        rejectionMsg = 'Video ditolak oleh AI: Terdeteksi video AI / animasi / CGI, bukan demonstrasi fisik nyata.';
      } else if (isMatchFalse) {
        rejectionMsg = `Video ditolak oleh AI: Produk di video (${parsed.detectedProduct || 'tidak cocok'}) tidak cocok dengan link Shopee.`;
      } else {
        rejectionMsg = 'Video ditolak oleh AI: Tidak memenuhi syarat affiliate faceless / bersih.';
      }
    }
    console.warn(`[Gemini YouTube Stream] ⛔ VIDEO RESMI DITOLAK OLEH AI: ${rejectionMsg}`);
    const rejectError = new Error(`Video ditolak oleh Gemini: ${rejectionMsg}`);
    rejectError.isAiRejection = true;
    rejectError.rejectionReason = rejectionMsg;
    throw rejectError;
  }

  let rawTimestamps = [];
  if (Array.isArray(parsed.timestamps)) {
    rawTimestamps = parsed.timestamps;
  } else if (Array.isArray(parsed.clips)) {
    rawTimestamps = parsed.clips.map((c) => c.startSeconds ?? c.startTime);
  }

  let candidateClips = [];
  if (rawTimestamps.length > 0) {
    for (const rawTs of rawTimestamps) {
      const sec = typeof rawTs === 'number' ? rawTs : parseTimeToSeconds(rawTs);
      if (isNaN(sec) || sec < 0 || sec > totalDuration) continue;
      const startSec = Math.max(0, Math.min(totalDuration - clipSec, Math.round(sec * 10) / 10));
      const endSec = Math.round((startSec + clipSec) * 10) / 10;
      candidateClips.push({
        startSeconds: startSec,
        endSeconds: endSec,
        duration: clipSec,
        startTime: formatSeconds(startSec),
        endTime: formatSeconds(endSec),
        reason: `Cuplikan produk di detik ${formatSeconds(startSec)}`,
        isCleanAffiliateShot: true,
        hasProductBrand: Boolean(parsed.hasProductBrand),
        reframe: {
          ...DEFAULT_REFRAME,
          renderMode: 'stage_80',
        },
      });
    }
  }

  const hasProductBrand = Boolean(parsed.hasProductBrand);
  const detectedBrand = (parsed.detectedBrand || '').trim() || (hasProductBrand ? 'Brand Terdeteksi' : 'none');
  const allowHflip = hasProductBrand ? false : (parsed.allowHflip !== false);

  const clips = normalizeClipPlan(candidateClips, totalDuration, {
    allowFallback: allowFallbackClips,
    hasProductBrand,
    allowHflip,
    sceneDuration: clipSec,
  });
  const duration = clips.reduce((total, clip) => total + (clip.endSeconds - clip.startSeconds), 0);

  onProgress({
    step: 'gemini_vision',
    message: `${activeGeminiModel} selected ${clips.length} clean ${clipSec}s product shots (${duration.toFixed(1)}s total).`,
    progress: 55,
  });

  return {
    startTime: clips[0].startTime,
    endTime: clips[clips.length - 1].endTime,
    startSeconds: clips[0].startSeconds,
    endSeconds: clips[clips.length - 1].endSeconds,
    duration,
    productHook: parsed.productHook || 'Kalau masih pakai cara lama, fix kurang maksimal!',
    hasProductBrand,
    detectedBrand,
    allowHflip,
    reframe: clips[0].reframe,
    clips,
  };
}

/**
 * Fallback Video Analysis using Google Gemini File API (Gemini 1.5 Flash).
 * Uploads video directly to Google's File API, allowing native video comprehension
 * without relying on frame extraction.
 */
export async function analyzeVideoWithGeminiFileApi({
  videoPath,
  apiKey,
  productTitle,
  productDescription,
  shopeeLink,
  sceneDuration = 3.3,
  allowFallbackClips = false,
  onProgress = () => {},
}) {
  const geminiKey = getDirectGeminiApiKey(apiKey);
  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY belum disetel di server/.env untuk fallback Gemini File API.');
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`File video tidak ditemukan di: ${videoPath}`);
  }

  const clipSec = Math.max(2.5, Math.min(5.0, Number(sceneDuration) || 3.3));
  const effectiveTitle = (productTitle || '').trim() || 'Produk Affiliate';
  const effectiveDesc = (productDescription || '').trim();

  let totalDuration = 60;
  try {
    const d = await getMediaDurationSec(videoPath);
    if (d && d > 5) totalDuration = d;
  } catch {}

  onProgress({
    step: 'gemini_vision',
    message: 'Mengunggah video ke Google Gemini File API (Gemini 1.5 Flash)...',
    progress: 46,
  });

  const fileManager = new GoogleAIFileManager(geminiKey);
  const genAI = new GoogleGenerativeAI(geminiKey);

  let uploadResponse = null;
  try {
    uploadResponse = await fileManager.uploadFile(videoPath, {
      mimeType: 'video/mp4',
      displayName: `clip_${path.basename(videoPath, path.extname(videoPath))}_${Date.now()}`,
    });

    onProgress({
      step: 'gemini_vision',
      message: 'Menunggu proses video di Google Gemini File API...',
      progress: 48,
    });

    // Wait until file is ACTIVE
    let fileState = await fileManager.getFile(uploadResponse.file.name);
    let pollCount = 0;
    while (fileState.state === 'PROCESSING' && pollCount < 30) {
      await new Promise((r) => setTimeout(r, 2000));
      pollCount++;
      fileState = await fileManager.getFile(uploadResponse.file.name);
    }

    if (fileState.state !== 'ACTIVE') {
      throw new Error(`Gemini File API processing error: status ${fileState.state}`);
    }

    onProgress({
      step: 'gemini_vision',
      message: 'Gemini 1.5 Flash menganalisa video, verifikasi faceless, dan menentukan cuplikan...',
      progress: 50,
    });

    const videoPrompt = `You are an elite Quality Control (QC) Director for Affiliate Product Video Ads.
Evaluate this full video carefully against the following 5 MANDATORY ACCEPTANCE CRITERIA:

CRITERION 1: EXACT PHYSICAL PRODUCT MATCH
- Does the physical item demonstrated in the video match "${effectiveTitle}"?
${effectiveDesc ? `  (Product Description: "${effectiveDesc}")` : ''}
- REJECT IMMEDIATELY if it is a DIFFERENT product or a compilation/haul video showing multiple random items.

CRITERION 2: WATERMARKS, SOCIAL MEDIA LOGOS, & CHANNEL IDENTITIES (9:16 CROP TOLERANCE RULE)
- 9:16 CROP GEOMETRY:
  * Both 'clipper' (9:16 vertical) and 'YTCLIPER' (16:9 with background color pillars) crop the central 9:16 vertical frame (the middle ~45-50% width of the horizontal video).
  * The outer left margins (0-20% from left edge) and outer right margins (80-100% from right edge) are COMPLETELY CROPPED OUT or covered by background pillars!
- PERIPHERAL CORNER WATERMARK / LOGO TOLERANCE (100% ACCEPTABLE):
  * Jika ada watermark, logo media sosial (TikTok/Douyin/YouTube), atau nama channel di pojok KIRI atau KANAN video (di luar frame 9:16 tengah): TETAP DITERIMA! JANGAN DITOLAK! Karena bagian kiri dan kanan ini akan terpotong bersih atau tertutup background.
- STRICT ZERO-TOLERANCE INSIDE THE 9:16 OUTPUT FRAME:
  * DILARANG KERAS jika watermark digital, logo TikTok/YouTube, atau identitas channel MASUK KE DALAM FRAME 9:16 TENGAH (area yang menutupi peragaan produk)!
  * Setiap watermark atau logo yang masuk ke dalam frame 9:16 wajib DITOLAK karena tidak bisa terpotong.
- PHYSICAL PRODUCT BRANDING IS 100% ACCEPTABLE:
  * Merek, logo, atau tulisan yang tercetak/terukir secara fisik pada bodi produk (misal: "Philips", "Joybos", "Xiaomi") BUKAN watermark dan 100% DITERIMA!

CRITERION 3: ZERO SUBTITLES & ZERO BURNED-IN TEXT INSIDE 9:16 OUTPUT
- The backend generates and burns its own clean, animated subtitles.
- REJECT if speech dialogue captions, translated subtitles, lyric bars, or running dialogue text are visible INSIDE the 9:16 output frame (bottom or center), as this causes ugly overlapping double-subtitles.
- Physical text/button labels directly on the physical product ("Power", "ON/OFF", "500ml") are 100% ACCEPTABLE.

CRITERION 4: STRICT 100% FACELESS & HUMAN-FREE IN 9:16 OUTPUT (HANDS ONLY)
- The final 9:16 video cut MUST BE 100% FACELESS and HUMAN-FREE!
- ZERO TOLERANCE FOR FACES: Dilarang keras menampilkan wajah manusia di dalam frame 9:16 (tampak depan, samping, menunduk, buram, pantulan kaca, atau orang di background).
- ZERO TOLERANCE FOR BODIES: Dilarang menampilkan kepala, rambut, leher, dada, torso, atau badan manusia di frame 9:16. Dilarang vlogger berbicara atau orang berdiri.
- The ONLY permitted human element is HANDS/FINGERS ONLY actively demonstrating, operating, holding, or pressing the product against a tabletop/neutral surface.

CRITERION 5: CLEAN TIMESTAMP SELECTION
- Select 4 to 8 non-overlapping timestamps (each about ${clipSec}s long) showing the best, satisfying hands-on product actions.
- Each timestamp in "timestamps" MUST be in seconds from the start of the video where the 9:16 center area is 100% faceless, free of subtitles, and free of watermarks/logos.
- If the video does NOT contain at least 4 clean faceless product clips inside the 9:16 frame: MUST BE REJECTED.

Output valid JSON ONLY with this exact format:
If ACCEPTED:
{
  "status": "accept",
  "detectedProduct": "<nama produk>",
  "isExactProductMatch": true,
  "isFacelessIn916Frame": true,
  "hasFaceIn916Frame": false,
  "hasWatermarkIn916Frame": false,
  "hasSocialOrChannelLogoIn916Frame": false,
  "hasSubtitlesIn916Frame": false,
  "hasOnlyPhysicalProductText": true,
  "isAiGeneratedOrSynthetic": false,
  "timestamps": [3, 7, 12, 16, 21, 26],
  "productHook": "Kalau [kebiasaan lama], fix [masalah fatal / kurang maksimal]!",
  "hasProductBrand": false,
  "detectedBrand": "none"
}

If REJECTED:
{
  "status": "reject",
  "detectedProduct": "<nama produk di video>",
  "isExactProductMatch": false,
  "isFacelessIn916Frame": false,
  "hasFaceIn916Frame": true,
  "hasWatermarkIn916Frame": false,
  "hasSocialOrChannelLogoIn916Frame": false,
  "hasSubtitlesIn916Frame": false,
  "hasOnlyPhysicalProductText": false,
  "isAiGeneratedOrSynthetic": false,
  "reason": "<alasan penolakan spesifik dalam bahasa Indonesia, misal: 'Watermark masuk ke dalam frame 9:16', 'Menampilkan wajah di frame 9:16', 'Mengandung subtitle ucapan', atau 'Produk tidak cocok'>"
}`;

    const candidateModels = ['gemini-1.5-flash', 'gemini-flash-latest'];
    let parsed = null;
    let activeGeminiModel = candidateModels[0];
    let lastGeminiErr = null;

    for (const modelName of candidateModels) {
      try {
        console.log(`[Gemini File API] Calling model: ${modelName}...`);
        activeGeminiModel = modelName;
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        });

        const result = await model.generateContent([
          {
            fileData: {
              mimeType: uploadResponse.file.mimeType,
              fileUri: uploadResponse.file.uri,
            },
          },
          { text: videoPrompt },
        ]);

        const rawText = result.response.text();
        console.log(`[Gemini File API ${modelName}] Response:`, rawText);
        parsed = repairJson(rawText);
        if (parsed && (parsed.status || parsed.timestamps || parsed.reason)) {
          break;
        }
      } catch (gemErr) {
        console.warn(`[Gemini File API] Model ${modelName} error:`, gemErr.message);
        lastGeminiErr = gemErr;
      }
    }

    if (!parsed) {
      throw lastGeminiErr || new Error('Gemini File API gagal menganalisa video.');
    }

    const rawStatus = String(parsed.status || '').toLowerCase().trim();
    const isRejectStatus = rawStatus === 'reject' || rawStatus === 'rejected' || rawStatus === 'ditolak';
    const isMatchFalse = parsed.isProductMatch === false || parsed.isExactProductMatch === false;
    const hasFace = parsed.hasFaceIn916Frame === true || parsed.hasFaceOrHumanInSelectedFrames === true || parsed.isFacelessIn916Frame === false || parsed.isFacelessAndHumanFree === false;
    const hasWatermarkInFrame = parsed.hasWatermarkIn916Frame === true || parsed.hasCenterObstructingWatermark === true;
    const hasSocialOrChannelInFrame = parsed.hasSocialOrChannelLogoIn916Frame === true || parsed.hasSocialMediaOrChannelIdentityIn916Frame === true;
    const hasSubtitles = parsed.hasSubtitlesIn916Frame === true || parsed.hasSubtitlesOrBurnedText === true || parsed.hasBurnedText === true;
    const isSynthetic = parsed.isAiGeneratedOrSynthetic === true;
    const reasonText = String(parsed.reason || parsed.rejectionReason || '').trim();
    const reasonLower = reasonText.toLowerCase();

    // Check if the reason explicitly cites violations inside the 9:16 frame
    const mentionsFaceInReason = reasonLower.includes('wajah') || reasonLower.includes('face') || reasonLower.includes('manusia') || reasonLower.includes('orang');
    const mentionsWatermarkInFrame = isRejectStatus && (reasonLower.includes('watermark') || reasonLower.includes('capcut')) && !reasonLower.includes('terpotong') && !reasonLower.includes('luar frame') && !reasonLower.includes('di luar 9:16');
    const mentionsLogoInFrame = isRejectStatus && (reasonLower.includes('logo') || reasonLower.includes('tiktok') || reasonLower.includes('channel') || reasonLower.includes('identitas') || reasonLower.includes('sosmed')) && !reasonLower.includes('terpotong') && !reasonLower.includes('luar frame') && !reasonLower.includes('di luar 9:16');
    const mentionsSubtitlesInReason = reasonLower.includes('subtitle') || reasonLower.includes('caption') || reasonLower.includes('teks berjalan') || reasonLower.includes('terjemahan');

    const shouldReject = isRejectStatus || isMatchFalse || hasFace || hasWatermarkInFrame || hasSocialOrChannelInFrame || hasSubtitles || isSynthetic ||
      mentionsFaceInReason || mentionsWatermarkInFrame || mentionsLogoInFrame || mentionsSubtitlesInReason;

    if (shouldReject) {
      let rejectionMsg = reasonText;
      if (!rejectionMsg) {
        if (hasFace || mentionsFaceInReason) {
          rejectionMsg = 'Video ditolak oleh AI: Menampilkan wajah atau manusia di dalam frame 9:16 (wajib 100% faceless, hanya peragaan tangan pada produk).';
        } else if (hasWatermarkInFrame || mentionsWatermarkInFrame) {
          rejectionMsg = 'Video ditolak oleh AI: Mengandung watermark digital yang masuk ke dalam frame 9:16 output.';
        } else if (hasSocialOrChannelInFrame || mentionsLogoInFrame) {
          rejectionMsg = 'Video ditolak oleh AI: Mengandung logo media sosial atau identitas channel yang masuk ke frame 9:16.';
        } else if (hasSubtitles || mentionsSubtitlesInReason) {
          rejectionMsg = 'Video ditolak oleh AI: Mengandung subtitle atau teks caption ucapan bawaan di frame 9:16.';
        } else if (isSynthetic) {
          rejectionMsg = 'Video ditolak oleh AI: Terdeteksi video AI / animasi / CGI, bukan demonstrasi fisik nyata.';
        } else if (isMatchFalse) {
          rejectionMsg = `Video ditolak oleh AI: Produk di video (${parsed.detectedProduct || 'tidak cocok'}) tidak cocok dengan link Shopee.`;
        } else {
          rejectionMsg = 'Video ditolak oleh AI: Tidak memenuhi syarat affiliate faceless / bersih.';
        }
      }
      console.warn(`[Gemini File API] ⛔ VIDEO RESMI DITOLAK OLEH AI: ${rejectionMsg}`);
      const rejectError = new Error(`Video ditolak oleh Gemini 1.5 Flash: ${rejectionMsg}`);
      rejectError.isAiRejection = true;
      rejectError.rejectionReason = rejectionMsg;
      throw rejectError;
    }

    let rawTimestamps = [];
    if (Array.isArray(parsed.timestamps)) {
      rawTimestamps = parsed.timestamps;
    } else if (Array.isArray(parsed.clips)) {
      rawTimestamps = parsed.clips.map((c) => c.startSeconds ?? c.startTime);
    } else if (Array.isArray(parsed.frames)) {
      rawTimestamps = parsed.frames;
    }

    let candidateClips = [];
    if (rawTimestamps.length > 0) {
      for (const rawTs of rawTimestamps) {
        const sec = typeof rawTs === 'number' ? rawTs : parseTimeToSeconds(rawTs);
        if (isNaN(sec) || sec < 0 || sec > totalDuration) continue;
        const startSec = Math.max(0, Math.min(totalDuration - clipSec, Math.round(sec * 10) / 10));
        const endSec = Math.round((startSec + clipSec) * 10) / 10;
        candidateClips.push({
          startSeconds: startSec,
          endSeconds: endSec,
          duration: clipSec,
          startTime: formatSeconds(startSec),
          endTime: formatSeconds(endSec),
          reason: `Cuplikan produk di detik ${formatSeconds(startSec)}`,
          isCleanAffiliateShot: true,
          hasProductBrand: Boolean(parsed.hasProductBrand),
          reframe: {
            ...DEFAULT_REFRAME,
            renderMode: 'stage_80',
          },
        });
      }
    }

    const hasProductBrand = Boolean(parsed.hasProductBrand);
    const detectedBrand = (parsed.detectedBrand || '').trim() || (hasProductBrand ? 'Brand Terdeteksi' : 'none');
    const allowHflip = hasProductBrand ? false : (parsed.allowHflip !== false);

    const clips = normalizeClipPlan(candidateClips, totalDuration, {
      allowFallback: allowFallbackClips,
      hasProductBrand,
      allowHflip,
      sceneDuration: clipSec,
    });
    const duration = clips.reduce((total, clip) => total + (clip.endSeconds - clip.startSeconds), 0);

    onProgress({
      step: 'gemini_vision',
      message: `Gemini 1.5 Flash selected ${clips.length} clean ${clipSec}s product shots (${duration.toFixed(1)}s total).`,
      progress: 55,
    });

    return {
      startTime: clips[0].startTime,
      endTime: clips[clips.length - 1].endTime,
      startSeconds: clips[0].startSeconds,
      endSeconds: clips[clips.length - 1].endSeconds,
      duration,
      productHook: parsed.productHook || 'Kalau masih pakai cara lama, fix kurang maksimal!',
      hasProductBrand,
      detectedBrand,
      allowHflip,
      reframe: clips[0].reframe,
      clips,
    };
  } finally {
    if (uploadResponse?.file?.name) {
      try {
        await fileManager.deleteFile(uploadResponse.file.name);
        console.log(`[Gemini File API] Cleaned up uploaded file: ${uploadResponse.file.name}`);
      } catch (delErr) {
        console.warn('[Gemini File API] Cleanup file warning:', delErr.message);
      }
    }
  }
}

/**
 * Stage 1, Step A: Calls AI Vision API (OpenRouter with ffmpeg frames)
 * with automatic fallback to Gemini File API (Gemini 1.5 Flash).
 */
export async function selectHighlightWithAI({
  apiKey,
  aiProvider,
  frames,
  videoPath = null,
  youtubeUrl = null,
  videoMetadata,
  productTitle,
  productDescription,
  shopeeLink,
  sceneDuration = 3.3,
  allowFallbackClips = false,
  onProgress = () => {}
}) {
  const reqProvider = (aiProvider || '').trim().toLowerCase();
  const envEngine = (process.env.ACTIVE_AI_ENGINE || '').trim().toLowerCase();
  const forceGemini = (reqProvider === 'gemini_direct' || reqProvider === 'gemini' || envEngine === 'gemini');
  const geminiKey = getDirectGeminiApiKey(apiKey);

  if (forceGemini && geminiKey && youtubeUrl && (youtubeUrl.includes('youtube.com') || youtubeUrl.includes('youtu.be'))) {
    console.log('[AIService Vision] Gemini Direct provider requested. Analyzing with native YouTube Stream URL (0 MB local quota)...');
    return await analyzeYouTubeVideoWithGemini({
      youtubeUrl,
      apiKey,
      productTitle,
      productDescription,
      shopeeLink,
      sceneDuration,
      allowFallbackClips,
      totalDuration: videoMetadata?.duration || 600,
      onProgress,
    });
  }

  if (forceGemini && videoPath && fs.existsSync(videoPath)) {
    console.log('[AIService Vision] Gemini Direct provider requested. Analyzing with Gemini File API...');
    return await analyzeVideoWithGeminiFileApi({
      videoPath,
      apiKey,
      productTitle,
      productDescription,
      shopeeLink,
      sceneDuration,
      allowFallbackClips,
      onProgress,
    });
  }

  let activeConfig = getAiClientConfig({ apiKeyOverride: apiKey, aiProvider });
  let { client, models: modelFallbackList, provider } = activeConfig;
  let activeModel = modelFallbackList[0];

  const clipSec = Math.max(2.5, Math.min(5.0, Number(sceneDuration) || 3.3));

  onProgress({
    step: 'gemini_vision',
    message: `Analyzing full video frames with ${provider} (${activeModel}) to plan fast ${clipSec}s product shots...`,
    progress: 45
  });

  const totalDuration = videoMetadata?.duration || 60;
  const effectiveTitle = productTitle || videoMetadata?.title || 'Product Showcase Video';
  const effectiveDesc = productDescription || videoMetadata?.description || '';

  const systemPrompt = `You are an expert Short-Form Affiliate Video QC Director specializing in Shopee Video FYP Algorithms.
Evaluate the ${frames.length} sampled frames of the source video for the target Shopee product: "${effectiveTitle}".

CRITICAL MANDATORY ZERO-TOLERANCE RULES:

RULE 1: ABSOLUTE ZERO HARDCODED SPEECH SUBTITLES & ZERO BURNED-IN CAPTION BARS:
- DILARANG KERAS MENERIMA VIDEO YANG MEMILIKI SUBTITLE / TEKS CAPTION UCAPAN BAWAAN!
- Inspect every frame (bottom, middle, top, edges) for burned-in speech subtitles, translated lyric bars, or running dialogue captions.
- Reason: The affiliate clipper generates and burns its own clean, animated Indonesian subtitles. Any source video with existing burned-in speech subtitles causes terrible overlapping double-subtitles and is unwatchable!
- ZERO TOLERANCE FOR POST-PRODUCTION TEXT OVERLAYS: Dilarang ada stiker teks, teks keterangan digital editan, atau teks promo tempelan.
- CRITICAL EXCEPTION (PHYSICAL PRODUCT TEXT IS 100% PERMITTED):
  * Real physical text, brand marks, buttons, or labels printed/embossed directly ON THE PHYSICAL PRODUCT BODY OR ITS PACKAGING (e.g. brand logo "Philips", "Joybos", "Midea", "Xiaomi", button markings "ON/OFF", "Power", "Speed 1 2", volume "500ml", "100°C", "Stainless Steel 304", or physical ingredient/specification labels) is 100% NATURAL AND FULLY ACCEPTABLE!
  * NEVER reject a video because of text or brand logos printed physically on the product itself!

RULE 2: EXACT PHYSICAL PRODUCT MATCH VERIFICATION:
- Compare the physical product demonstrated in the frames directly with the target Shopee product: "${effectiveTitle}".
- It MUST be the EXACT same physical product type, model, and function as "${effectiveTitle}".
- REJECT IMMEDIATELY if the video shows a DIFFERENT product (e.g. target is electric mini chopper, but video shows manual grater, knives, oil dispenser, or random gadgets).
- REJECT IMMEDIATELY if it is a compilation / haul video showing multiple random gadgets instead of demonstrating this single product.
- If rejected for wrong product:
  {"status": "reject", "detectedProduct": "<nama produk yang tampak>", "isExactProductMatch": false, "reason": "Produk di video (<nama produk>) tidak cocok dengan produk Shopee (${effectiveTitle})"}

RULE 3: STRICT WHOLE-VIDEO FACELESS MANDATE (ZERO TOLERANCE FOR FACES ANYWHERE IN THE VIDEO):
- MANDATORY WHOLE-VIDEO INSPECTION: Inspect ALL ${frames.length} sampled frames from first to last.
- CRITICAL: Does ANY frame (even just ONE frame) show a human face, head, hair, neck, torso, or person talking (e.g. host, vlogger, presenter, influencer, or bystander)?
  * IF YES -> REJECT THE ENTIRE VIDEO IMMEDIATELY (status: "reject")!
  * DILARANG KERAS MEMILIH FRAME TANGAN DARI VIDEO YANG ADA VLOGGER/ORANGNYA!
  * Do NOT cherry-pick hands-only frames from a video that has a human presenter/vlogger in other scenes! If a person/face appears anywhere in the footage, the entire video is DISQUALIFIED!
- PERMITTED FOOTAGE TYPE: ONLY 100% pure faceless tabletop footage is permitted where the camera is focused strictly on the product and countertop from start to finish, with HANDS/FINGERS ONLY actively operating the product.
- If ANY frame contains a human face or person:
  {"status": "reject", "hasHumanOrFaceAnywhereInFrames": true, "isFacelessIn916Frame": false, "reason": "Video ditolak: Menampilkan wajah atau orang/vlogger (wajib 100% video faceless tabletop dari awal sampai akhir)."}

RULE 4: REAL AUTHENTIC PHYSICAL FOOTAGE (NO AI/CGI SLOP, NO TALKING HEADS):
- REJECT if AI-generated / synthetic / CGI / 3D animated / cartoon video.
- REJECT if pure talking-head / vlog without direct hands-on product demonstration.
- REJECT if pure parcel unboxing / bubble wrap without active product demonstration.

RULE 5: WATERMARKS, SOCIAL MEDIA LOGOS & CHANNEL IDENTITIES (9:16 CROP TOLERANCE RULE):
- 9:16 CROP GEOMETRY:
  * Both 'clipper' (9:16 vertical) and 'YTCLIPER' (16:9 with background color pillars) crop the central 9:16 vertical frame (the middle ~45-50% width of the horizontal video).
  * Outer margins (far left 0-20% and far right 80-100%) are completely cropped out or covered by background pillars!
- PERIPHERAL CORNER WATERMARK / LOGO TOLERANCE (100% ACCEPTABLE):
  * Jika ada watermark, logo media sosial (TikTok/Douyin/YouTube), atau nama channel di pojok KIRI atau KANAN video (di luar frame 9:16 tengah): TETAP DITERIMA! JANGAN DITOLAK! Karena bagian kiri dan kanan ini akan terpotong bersih atau tertutup background.
- STRICT ZERO-TOLERANCE INSIDE THE 9:16 OUTPUT FRAME:
  * DILARANG KERAS jika watermark digital, logo TikTok/YouTube, atau identitas channel MASUK KE DALAM FRAME 9:16 TENGAH (area yang menutupi peragaan produk)!
  * Setiap watermark atau logo yang masuk ke dalam frame 9:16 wajib DITOLAK karena tidak bisa terpotong.
- PHYSICAL PRODUCT BRANDING IS FULLY ACCEPTABLE:
  * Merek, logo, atau tulisan yang tercetak/terukir secara fisik pada bodi produk (misal: "Philips", "Joybos", "Xiaomi") BUKAN watermark dan 100% DITERIMA!

CRITERIA FOR ACCEPTANCE (ALL MUST BE TRUE):
1. Exactly matches target Shopee product: "${effectiveTitle}".
2. 100% Entirely Faceless: Absolutely ZERO human faces, heads, necks, or bodies anywhere across all ${frames.length} frames (hands/fingers operating on tabletop only).
3. 100% Clean from hardburned speech subtitles/captions inside 9:16 frame (physical text/labels on the product are 100% allowed).
4. 100% Clean from watermarks, social media logos, and channel identities inside the 9:16 central frame (outer left/right watermarks that get cropped/covered are acceptable).
5. Real authentic physical demonstration.

Output strictly valid JSON with this exact schema:
If ACCEPTED:
{
  "status": "accept",
  "detectedProduct": "<nama produk di video>",
  "isExactProductMatch": true,
  "isFacelessIn916Frame": true,
  "hasFaceIn916Frame": false,
  "hasWatermarkIn916Frame": false,
  "hasSocialOrChannelLogoIn916Frame": false,
  "hasSubtitlesIn916Frame": false,
  "hasOnlyPhysicalProductText": true,
  "isAiGeneratedOrSynthetic": false,
  "frames": [4, 8, 12, 16, 20, 24],
  "productHook": "Kalau [kebiasaan lama], fix [masalah fatal / kurang maksimal]!",
  "hasProductBrand": false,
  "detectedBrand": "none"
}

If REJECTED:
{
  "status": "reject",
  "detectedProduct": "<nama produk di video>",
  "isExactProductMatch": false,
  "isFacelessIn916Frame": false,
  "hasFaceIn916Frame": false,
  "hasWatermarkIn916Frame": false,
  "hasSocialOrChannelLogoIn916Frame": false,
  "hasSubtitlesIn916Frame": false,
  "hasOnlyPhysicalProductText": false,
  "isAiGeneratedOrSynthetic": false,
  "reason": "<alasan penolakan yang jelas dalam bahasa Indonesia, misal: 'Watermark masuk ke frame 9:16', 'Menampilkan wajah vlogger', 'Mengandung subtitle ucapan'>"
}`;

  // Bound frames to at most 10 keyframes for OpenRouter / Vision APIs to prevent token exhaustion and rate limits
  let evalFrames = frames || [];
  if (evalFrames.length > 10) {
    const step = (evalFrames.length - 1) / 9;
    const sampled = [];
    for (let i = 0; i < 10; i++) {
      const idx = Math.round(i * step);
      if (evalFrames[idx] && !sampled.includes(evalFrames[idx])) {
        sampled.push(evalFrames[idx]);
      }
    }
    evalFrames = sampled;
  }

  const userPrompt = `Target Shopee Product: "${effectiveTitle}"
${effectiveDesc ? `Product Description: "${effectiveDesc}"` : ''}
Total Duration: ${totalDuration}s
Sampled Frames:
${evalFrames.map((f, i) => `#${i + 1} (${f.timeFormatted})`).join(', ')}

Review visual frames carefully against the 5 Mandatory Acceptance Criteria:
1. Exact Product Match: Does the physical item in the video match "${effectiveTitle}" exactly?
   - If DIFFERENT product or compilation: output {"status": "reject", "detectedProduct": "<nama produk>", "isExactProductMatch": false, "reason": "Produk di video tidak cocok dengan link Shopee"}
2. Faceless QC: Inspect ALL ${evalFrames.length} frames. Does ANY frame show a human face, head, hair, or person talking?
   - If ANY face or person is visible in ANY frame: output {"status": "reject", "hasHumanOrFaceAnywhereInFrames": true, "isFacelessIn916Frame": false, "hasFaceIn916Frame": true, "reason": "Video ditolak: Menampilkan wajah/orang (wajib 100% faceless tabletop)"}
   - Dilarang memilih frame tangan dari video yang ada vlogger/orangnya!
3. Subtitle & Text QC: Do the selected frames contain hardcoded speech captions, dialogue subtitles, or digital text overlays in the 9:16 frame?
   - NOTE: Physical text, brand names, or button markings printed/molded ON THE PHYSICAL PRODUCT are 100% ACCEPTABLE and NOT subtitles!
   - If speech captions, dialogue subtitles, or text overlays are visible: output {"status": "reject", "hasSubtitlesIn916Frame": true, "reason": "Video ditolak: Mengandung subtitle / teks caption ucapan bawaan."}
4. Watermark & Logo QC (9:16 Crop Tolerance):
   - Watermark/logo di pojok KIRI atau KANAN video (di luar area tengah 9:16) TETAP DITERIMA karena akan terpotong/tertutup pilar.
   - Hanya tolak jika watermark digital, logo TikTok/YouTube, atau identitas channel MASUK KE AREA 9:16 TENGAH: output {"status": "reject", "hasWatermarkIn916Frame": true, "reason": "Video ditolak: Watermark masuk ke dalam frame 9:16."}
5. If there are at least 5 clean frames demonstrating the product (100% entirely faceless across all frames, zero watermark inside 9:16, zero subtitles, matching product):
   - Select 5 to 8 frame indices in "frames" array.
   - Output {"status": "accept", "detectedProduct": "<nama produk>", "isExactProductMatch": true, "isFacelessIn916Frame": true, "hasHumanOrFaceAnywhereInFrames": false, "hasSubtitlesIn916Frame": false, "hasFaceIn916Frame": false, "hasWatermarkIn916Frame": false, "hasSocialOrChannelLogoIn916Frame": false, "frames": [indices], "productHook": "Kalau ..., fix ...!", "hasProductBrand": false}`;

  const messageContent = [
    { type: 'text', text: userPrompt },
    ...evalFrames.map((f) => ({
      type: 'image_url',
      image_url: {
        url: f.base64,
        detail: 'low',
      },
    })),
  ];

  const startTimeMs = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startTimeMs) / 1000);
    onProgress({
      step: 'gemini_vision',
      message: `${provider} (${activeModel}) menganalisis frame video & verifikasi produk... (${elapsedSec} detik)`,
      progress: Math.min(54, 45 + Math.floor(elapsedSec / 3)),
    });
  }, 2000);

  let totalRetries = modelFallbackList.length;
  let lastError = null;
  let hasFallenBackToGemini = (provider === 'Google Gemini Direct');

  for (let attempt = 0; attempt < totalRetries; attempt++) {
    activeModel = modelFallbackList[attempt];
    try {
      if (attempt > 0) {
        for (let t = 4; t > 0; t--) {
          onProgress({
            step: 'gemini_vision',
            message: `AI model sebelumnya bermasalah. Mencoba model fallback (${activeModel}) dalam ${t} detik...`,
            progress: 48,
          });
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      console.log(`[AIService Vision] Calling ${provider} with model: ${activeModel}...`);
      const payloadBytes = frames.reduce((acc, f) => acc + (f.base64 ? f.base64.length : 15000), 0) + Buffer.byteLength(systemPrompt + userPrompt, 'utf-8');
      trackBandwidth('aiRequests', payloadBytes, `AI Vision (${provider} - ${activeModel}): ${frames.length} frame`);
      const response = await client.chat.completions.create({
        model: activeModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: messageContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1200,
      });

      clearInterval(heartbeat);

      const msg = response.choices?.[0]?.message;
      const rawContent = (msg?.content && msg.content.trim()) ? msg.content : (msg?.reasoning || '{}');
      console.log(`[AIService ${provider} ${activeModel}] Raw response:`, rawContent);
      let parsed = repairJson(rawContent);

      const rawStatus = String(parsed.status || '').toLowerCase().trim();
      const isRejectStatus = rawStatus === 'reject' || rawStatus === 'rejected' || rawStatus === 'ditolak';
      const isMatchFalse = parsed.isProductMatch === false || parsed.isExactProductMatch === false || parsed.isUsableSourceVideo === false;
      const hasFace = parsed.hasFaceIn916Frame === true ||
        parsed.hasFaceOrHumanInSelectedFrames === true ||
        parsed.hasHumanOrFaceAnywhereInFrames === true ||
        parsed.hasHumanOrFaceInVideo === true ||
        parsed.isFacelessIn916Frame === false ||
        parsed.isFacelessAndHumanFree === false ||
        parsed.isEntirelyFaceless === false;
      const hasSubtitles = parsed.hasSubtitlesIn916Frame === true || parsed.hasSubtitlesOrBurnedText === true || parsed.hasBurnedText === true;
      const hasWatermarkInFrame = parsed.hasWatermarkIn916Frame === true || parsed.hasCenterObstructingWatermark === true;
      const hasSocialOrChannelInFrame = parsed.hasSocialOrChannelLogoIn916Frame === true || parsed.hasSocialMediaOrChannelIdentityIn916Frame === true;
      const isSynthetic = parsed.isAiGeneratedOrSynthetic === true;

      const reasonText = String(parsed.reason || parsed.rejectionReason || '').trim();
      const reasonLower = reasonText.toLowerCase();

      const mentionsFaceInReason = reasonLower.includes('wajah') || reasonLower.includes('face') || reasonLower.includes('manusia') || reasonLower.includes('orang');
      const mentionsSubtitlesInReason = reasonLower.includes('subtitle') || reasonLower.includes('caption') || reasonLower.includes('teks berjalan') || reasonLower.includes('terjemahan');
      const mentionsWatermarkInFrame = isRejectStatus && (reasonLower.includes('watermark') || reasonLower.includes('capcut')) && !reasonLower.includes('terpotong') && !reasonLower.includes('luar frame') && !reasonLower.includes('di luar 9:16');
      const mentionsLogoInFrame = isRejectStatus && (reasonLower.includes('logo') || reasonLower.includes('tiktok') || reasonLower.includes('channel') || reasonLower.includes('identitas') || reasonLower.includes('sosmed')) && !reasonLower.includes('terpotong') && !reasonLower.includes('luar frame') && !reasonLower.includes('di luar 9:16');

      const selectedIndices = Array.isArray(parsed.frames) ? parsed.frames : [];
      const hasValidFrames = selectedIndices.length >= 4;

      const shouldReject = isRejectStatus || isMatchFalse || hasFace || hasWatermarkInFrame || hasSocialOrChannelInFrame || hasSubtitles || isSynthetic ||
        mentionsFaceInReason || mentionsWatermarkInFrame || mentionsLogoInFrame || mentionsSubtitlesInReason || !hasValidFrames;

      if (shouldReject) {
        let rejectionMsg = reasonText;
        if (!rejectionMsg) {
          if (hasFace || mentionsFaceInReason) {
            rejectionMsg = 'Video ditolak: Menampilkan wajah atau manusia (wajib 100% faceless, hanya peragaan tangan atau produk saja).';
          } else if (hasWatermark || mentionsWatermarkInReason) {
            rejectionMsg = 'Video ditolak: Mengandung watermark digital atau watermark aplikasi editor.';
          } else if (hasSocialOrChannel || mentionsLogoInReason) {
            rejectionMsg = 'Video ditolak: Mengandung logo media sosial atau identitas channel/kreator.';
          } else if (hasSubtitles || mentionsSubtitlesInReason) {
            rejectionMsg = 'Video ditolak: Mengandung subtitle / teks caption ucapan bawaan pada video asli.';
          } else if (isSynthetic) {
            rejectionMsg = 'Video ditolak: Terdeteksi video AI / animasi / CGI, bukan demonstrasi fisik nyata.';
          } else if (isMatchFalse) {
            rejectionMsg = `Video ditolak oleh AI: Produk di video (${parsed.detectedProduct || 'tidak cocok'}) tidak cocok dengan link Shopee.`;
          } else if (!hasValidFrames) {
            rejectionMsg = 'Video ditolak oleh AI: Tidak ditemukan cukup frame cuplikan produk yang bersih dan memenuhi syarat affiliate.';
          } else {
            rejectionMsg = 'Video ditolak oleh AI: Tidak memenuhi syarat affiliate faceless & bersih.';
          }
        }
        console.warn(`[AIService ${provider} ${activeModel}] ⛔ VIDEO RESMI DITOLAK OLEH AI: ${rejectionMsg}`);
        const rejectError = new Error(`Video ditolak oleh AI (${activeModel}): ${rejectionMsg}`);
        rejectError.isAiRejection = true;
        rejectError.rejectionReason = rejectionMsg;
        throw rejectError;
      }

      let candidateClips = [];

      if (selectedIndices.length > 0) {
        for (const rawIdx of selectedIndices) {
          const idx = parseInt(rawIdx, 10);
          if (isNaN(idx) || idx < 1 || idx > frames.length) continue;
          const frameObj = frames[idx - 1];
          const ts = frameObj ? frameObj.timestamp : (idx * (totalDuration / frames.length));
          const startSec = Math.max(0, Math.min(totalDuration - clipSec, Math.round(ts * 10) / 10));
          const endSec = Math.round((startSec + clipSec) * 10) / 10;
          candidateClips.push({
            startSeconds: startSec,
            endSeconds: endSec,
            duration: clipSec,
            startTime: formatSeconds(startSec),
            endTime: formatSeconds(endSec),
            reason: `Frame #${idx} peragaan memuaskan di detik ${formatSeconds(startSec)}`,
            isCleanAffiliateShot: true,
            hasProductBrand: Boolean(parsed.hasProductBrand),
            reframe: {
              ...DEFAULT_REFRAME,
              renderMode: 'stage_80',
            }
          });
        }
      }

      const hasProductBrand = Boolean(parsed.hasProductBrand);
      const detectedBrand = (parsed.detectedBrand || '').trim() || (hasProductBrand ? 'Brand Terdeteksi' : 'none');
      const allowHflip = hasProductBrand ? false : (parsed.allowHflip !== false);

      const clips = normalizeClipPlan(candidateClips, totalDuration, {
        allowFallback: allowFallbackClips,
        hasProductBrand,
        allowHflip,
        sceneDuration: clipSec,
      });
      const duration = clips.reduce((total, clip) => total + (clip.endSeconds - clip.startSeconds), 0);
      
      onProgress({
        step: 'gemini_vision',
        message: `${provider} (${activeModel}) selected ${clips.length} clean ${clipSec}s product shots (${duration.toFixed(1)}s total).`,
        progress: 55
      });

      return {
        startTime: clips[0].startTime,
        endTime: clips[clips.length - 1].endTime,
        startSeconds: clips[0].startSeconds,
        endSeconds: clips[clips.length - 1].endSeconds,
        duration,
        productHook: parsed.productHook || 'Kalau masih pakai cara lama, fix kurang maksimal!',
        hasProductBrand,
        detectedBrand,
        allowHflip,
        reframe: clips[0].reframe,
        clips,
      };
    } catch (err) {
      if (err.isAiRejection || String(err?.message || '').toLowerCase().includes('ditolak oleh ai') || String(err?.message || '').toLowerCase().includes('ai menolak video')) {
        clearInterval(heartbeat);
        err.isAiRejection = true;
        if (!err.rejectionReason) {
          err.rejectionReason = err.message || 'Video ditolak oleh AI';
        }
        console.warn(`[AIService ${provider}] Menghentikan model fallback karena video ditolak isi/kontennya: ${err.message}`);
        throw err;
      }
      lastError = err;
      const status = err.status || err.statusCode;
      const msg = (err.message || '').toLowerCase();
      const isFatalAuthOrBilling = status === 401 || status === 402 || msg.includes('balance') || msg.includes('credits');

      // Fallback ke Google Gemini File API (Gemini 1.5 Flash) jika OpenRouter bermasalah atau habis saldo
      if (!hasFallenBackToGemini) {
        const geminiKey = getDirectGeminiApiKey(apiKey);
        if (geminiKey && (isFatalAuthOrBilling || attempt >= totalRetries - 1)) {
          if (videoPath && fs.existsSync(videoPath)) {
            clearInterval(heartbeat);
            console.warn(`[AIService Vision] OpenRouter error (${err.message}). Beralih ke Google Gemini File API fallback (Gemini 1.5 Flash)...`);
            onProgress({
              step: 'gemini_vision',
              message: 'OpenRouter gagal. Mengaktifkan fallback Google Gemini File API (Gemini 1.5 Flash)...',
              progress: 47,
            });
            return await analyzeVideoWithGeminiFileApi({
              videoPath,
              apiKey,
              productTitle,
              productDescription,
              shopeeLink,
              sceneDuration,
              allowFallbackClips,
              onProgress,
            });
          }

          const geminiFallback = getDirectGeminiClientConfig({ apiKeyOverride: apiKey });
          if (geminiFallback) {
            console.warn(`[AIService Vision] OpenRouter error (${err.message}). Beralih langsung ke Google Gemini Direct API fallback (${geminiFallback.models[0]})...`);
            onProgress({
              step: 'gemini_vision',
              message: `OpenRouter gagal. Mengaktifkan direct fallback Google Gemini API (${geminiFallback.models[0]})...`,
              progress: 47,
            });
            hasFallenBackToGemini = true;
            client = geminiFallback.client;
            modelFallbackList = geminiFallback.models;
            provider = geminiFallback.provider;
            totalRetries = modelFallbackList.length;
            attempt = -1; // Reset agar loop berikutnya mulai dari model Gemini pertama
            continue;
          }
        }
      }

      if (attempt < totalRetries - 1) {
        console.warn(`[AIService Vision] AI model ${activeModel} failed (attempt ${attempt + 1}, status: ${status}, error: ${msg}). Trying next fallback model...`);
        continue;
      }

      clearInterval(heartbeat);
      console.error(`[AIService ${provider} ${activeModel}] Error:`, err);
      throw new Error(formatApiError(err, activeModel, provider));
    }
  }

  clearInterval(heartbeat);
  throw new Error(formatApiError(lastError, activeModel, provider));
}

/**
 * Stage 1, Step B: Calls Alibaba Qwen API (or Google Gemini)
 * using explicit user provided Product Title and Product Description to generate:
 * - Kotak Scene (Scene Breakdown)
 * - Sample Context (USPs, Target Audience, Core Problem)
 * - Google AI Studio Prompt Template
 * - Reels Caption & Hashtags
 */
export async function generateAdAdvisorScriptWithAI({
  apiKey,
  aiProvider,
  trimmedFrames,
  videoMetadata,
  productTitle,
  productDescription,
  shopeeLink,
  productHook,
  segmentDuration = 24,
  sceneDuration = 3.3,
  onProgress = () => {}
}) {
  let activeConfig = getAiClientConfig({ apiKeyOverride: apiKey, aiProvider });
  let { client, models: modelFallbackList, provider } = activeConfig;
  let activeModel = modelFallbackList[0];

  onProgress({
    step: 'gpt_scripting',
    message: `Analyzing trimmed video frames with ${provider} (${activeModel}) for Shopee FYP Kotak Scene & Naskah...`,
    progress: 75
  });

  const effectiveTitle = (productTitle || '').trim() || videoMetadata?.title || 'Produk Viral Shopee';
  const effectiveDesc = (productDescription || '').trim();
  const targetDuration = Math.max(18, Math.min(32, Math.round(Number(segmentDuration) || 24)));
  const effectiveSceneSec = Math.max(2.5, Math.min(4.5, Number(sceneDuration) || 3.3));
  const sceneCount = Math.max(5, Math.min(8, Math.round(targetDuration / effectiveSceneSec)));
  // Natural Indonesian commercial speaking rate: ~1.7 - 1.9 words per second (~105 - 115 WPM)
  // For a 24s video: min ~36 words, ideal ~42 words, max ~48 words (~5-6 words per scene).
  // AVOID overly long scripts that force the voiceover to speak unnaturally fast!
  const targetWords = Math.round(targetDuration * 1.8);
  const minWords = Math.round(targetDuration * 1.5);
  const maxWords = Math.round(targetDuration * 2.0);

  const systemPrompt = `You are a Senior Creative Director and Ad Advisor specializing in Indonesian Short-Form Affiliate Video Marketing (Shopee Video, TikTok Shop, Instagram Reels).

You will receive the explicit Product Title, Product Description, and the sampled frames of a ${targetDuration}-second video clip (${sceneCount} fast scenes of ~${effectiveSceneSec.toFixed(1)}s each).

Use the proven SHOPEE FYP 4-BEAT FORMULA engineered to break past the initial 200-views testing pool through high watch-time completion rate and maximum Keranjang Kuning conversions:

CRITICAL 4-BEAT SHOPEE FYP FORMULA:
1. [00:00] BEAT 1: THE 3-SECOND PROBLEM HOOK (00:00 - 00:03)
   - MUST immediately state a specific everyday problem / frustration caused by the old way or conventional tool!
   - MANDATORY FORMULA: "Kalau [kebiasaan/cara lama pakai alat biasa], fix [masalah fatal / kurang maksimal / bikin capek]!"
   - DILARANG KERAS menggunakan sapaan basi seperti: "Stop scroll!", "Halo guys!", "Siapa disini yang...", "Racun Shopee wajib punya!", atau pembukaan yang bertele-tele!
   - Contoh tepat: "Kalau nyuci motor masih pakai kain biasa, fix kurang maksimal!" atau "Masih sering capek ngulek bumbu pakai cobek lama, tangan pegal dan lama beres?"

2. BEAT 2: HERO SOLUTION & VALUE INTRODUCTION (00:03 - 00:07)
   - Introduce the product as the hero solution that immediately eliminates the pain point.
   - Audiences buy "solutions", not just static items.
   - Contoh: "Untung sekarang ada ${effectiveTitle} ini, sekali usap langsung beres tanpa ribet!"

3. BEAT 3: SATISFYING VISUAL DEMONSTRATION & CORE BENEFITS (00:07 - 00:17)
   - Describe the satisfying visual proof seen in the video frames: rich foam (busa melimpah), cleaning hard-to-reach crevices (menjangkau sela-sela), smooth effortless cutting, hands protected from scratches/cuts (tangan aman gak lecet).
   - Satisfying demonstrations keep viewers glued to the screen (high completion watch-time).

4. BEAT 4: PRICE PSYCHOLOGY & SHOPEE KERANJANG POJOK KIRI BAWAH CTA (00:17 - ${formatSeconds(targetDuration)})
   - Voiceover MUST state the price appeal: "Harganya murah meriah..." or "Harganya murah meriah banget, gak bikin kantong jebol!"
   - Direct viewers with urgent FOMO to the Shopee Keranjang Kuning at the bottom-left corner:
     "Buruan cek keranjang pojok kiri bawah sebelum kehabisan!" or "Langsung checkout di keranjang pojok kiri bawah mumpung lagi promo!"
   - The Shopee algorithm prioritizes clicks on the yellow shopping bag icon at the bottom-left. Calling out "keranjang pojok kiri bawah" is essential for conversion!

CRITICAL DURATION & WORD-COUNT TIMING RULES:
- The final video duration is EXACTLY ${targetDuration} seconds (${sceneCount} fast scenes of ~${effectiveSceneSec.toFixed(1)}s each).
- Total voiceover script MUST contain between ${minWords} and ${maxWords} words (Target ideal: exactly ~${targetWords} words, only ~5-6 punchy words per ~${effectiveSceneSec.toFixed(1)}s scene).
- DILARANG MEMBUAT NASKAH TERLALU PANJANG! Naskah yang terlalu panjang akan memaksa narator berbicara terlalu cepat seperti terburu-buru dan tidak enak didengar.
- Jaga agar setiap kalimat singkat, padat, lugas, santai, dan to-the-point (~5-6 kata per adegan).

1. 'sampleContext':
   - 'productName': Explicit product name.
   - 'videoDuration': "${targetDuration} detik"
   - 'targetAudience': Specific target audience profile in Indonesia.
   - 'coreProblem': The primary pain point from the old way/conventional tool.
   - 'keyFeatures': List of 3-4 key USPs (Unique Selling Propositions).
   - 'buyingTrigger': Psychological trigger (Problem-Solution relief, FOMO, harga murah meriah).

2. 'scenes' (Kotak Scene / Fast Scene Breakdown):
   - Break into EXACTLY ${sceneCount} fast scenes (~${effectiveSceneSec.toFixed(1)}s each).
   - For each scene provide:
     * 'sceneNumber': integer (1, 2, 3... up to ${sceneCount})
     * 'timeRange': exact range e.g. "00:00 - 00:03", "00:03 - 00:07", etc.
     * 'visualDescription': Satisfying visual action happening in Indonesian.
     * 'voiceover': Spoken narration line for this scene (hanya ~5-6 kata pendek, padat, dan jelas).
     * 'adAdvisorNotes': Director notes for sound effects (SFX), visual text overlays (yellow/white text), or emotional pacing.

3. 'voiceoverScript' (Naskah Voiceover Lengkap dengan Penanda Waktu & Tag Emosi):
   - Complete Indonesian spoken narration (${minWords} - ${maxWords} words total).
   - Use dynamic emotional tone & pacing tags so the AI voiceover (Edge-TTS Gadis) sounds lively, expressive, and NEVER monotone:
     * [excited] for energetic Problem Hooks, surprise moments, and closing CTA.
     * [emphasis] to place strong vocal stress on key product features and instant benefits.
     * [soft] for empathetic problem statements.
     * [pause] for natural human breathing pauses between sentences.
   - Each line MUST start with an exact timestamp corresponding to each scene (e.g. [00:00], [00:03], [00:07], up to the closing CTA), followed by the emotion tag and spoken line.
   - Closing line MUST have the price appeal ("murah meriah") and direct CTA to "keranjang pojok kiri bawah".

STRICT RULES FOR VOICE OVER:
- NEVER mention unboxing, packaging, bubble wrap, or cardboard. Focus 100% on product action and problem-solving.
- Write in natural, engaging conversational Indonesian.
- DILARANG KERAS menggunakan kata "kece" dan "kangen".
- HINDARI KATA SLANG "ng" (nggak, ngasih, ngeliat, dll) - gunakan kata baku.
- DILARANG menyebut nama medsos lain (TikTok, Instagram, YouTube, Facebook, dll).
- DILARANG mengatakan "link di bio" - WAJIB gunakan "keranjang pojok kiri bawah" atau "produk di bawah".
- Ejaan baku tanpa aksen é/è.

4. 'aiStudioPrompt':
   - Plain text block formatted for Google AI Studio TTS Playground (Scene, Sample Context, Speaker 1 with timestamps and emotion tags).

5. 'caption':
   - Caption with emojis, Problem-Solution hook, benefits, CTA ("Cek keranjang pojok kiri bawah!"), and hashtags (#racunshopee, #spillracun, #racunbelanja, #shopeevideo, #fyp).
   - NO URLs/links, NO Chinese characters.

6. 'lexicon_to_replace' (Deteksi Istilah / Kata Bahasa Inggris Otomatis):
   - Deteksi SEMUA kata, merk, atau istilah bahasa Inggris yang ada di naskah voiceover maupun judul/deskripsi produk (misal: 'steak', 'juicy', 'online', 'chopper', 'mini chopper', 'food chopper', 'stainless steel', 'air fryer', 'food grade', 'rechargeable', 'wireless', 'magic', 'brush', 'sponge', 'cleaner', 'fry pan', dll).
   - Petakan ke ejaan pelafalan fonetik bahasa Indonesia yang kaku agar dibaca natural oleh TTS Bahasa Indonesia (misal: {"chopper": "coper", "stainless steel": "stenlis stil", "air fryer": "er frayer", "steak": "stik", "juicy": "jusi"}).
   - Format wajib: Objek key-value {"kata_inggris": "ejaan_fonetik_indonesia"}. Jika tidak ada kata bahasa Inggris, isi dengan {}.

Output MUST be strictly valid JSON matching the requested schema.`;

  const userPrompt = `=== INFORMASI PRODUK UTAMA ===
Judul / Nama Produk: "${effectiveTitle}"
${effectiveDesc ? `Deskripsi & Spesifikasi Produk: "${effectiveDesc}"` : 'Deskripsi: (Analisis dari visual frame video)'}
Visual Hook: "${productHook || 'Racun Viral Wajib Punya!'}"
Durasi Video Potongan: ${targetDuration} detik (Wajib naskah dengan panjang ${minWords} - ${maxWords} kata, target ideal: ~${targetWords} kata)

Visual Frames of the concatenated 5-second AI-selected product clips (${trimmedFrames.length} frames):
${trimmedFrames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

Gunakan informasi judul dan deskripsi produk di atas agar naskah sangat relevan dan akurat.
Buat Kotak Scene, Sample Context, Naskah Voiceover Ad Advisor, dan AI Studio prompt.

PENTING - ATURAN DURASI, TIMESTAMP & TEMPO NASKAH:
1. Pada bagian 'Sample Context' (baik di JSON maupun di prompt AI Studio), WAJIB sertakan durasi voice over sesuai timestamp detik terakhir di Speaker 1, misal: "Durasi voice over 30 detik. Iklan affiliate viral...".
2. Naskah voiceover HARUS pas ${minWords} s/d ${maxWords} kata (sekitar 12-14 kata tiap scene 5 detik) agar pas dengan durasi video tanpa perlu diperlambat!
3. Setiap baris naskah voiceover dan prompt AI Studio WAJIB diawali penanda waktu video, misal: [00:00], [00:05], [00:10], [00:15], [00:20], [00:25], [00:30], [00:35], dst.
4. JANGAN gunakan nama karakter suara khusus (cukup gunakan header "Speaker 1").
5. DILARANG KERAS menggunakan kata "kece"! Gunakan kata seperti keren, elegan, praktis, atau bagus.
6. DILARANG KERAS menggunakan kata "kangen" dan HINDARI kata gaul berawalan "ng" (seperti: nggak, ngasih, ngeliat, ngerasain, ngapain, dll). Gunakan bahasa Indonesia baku (tidak, memberi, melihat, dll).
7. KATA "keju" DAN "beres" WAJIB DITULIS PERSIS: "keju" dan "beres" (keju=keju, beres=beres) tanpa tanda kecil atau aksen di atas huruf e.
8. DILARANG KERAS menyebutkan nama platform media sosial atau marketplace apa pun (seperti Shopee, TikTok, Instagram, YouTube, Facebook, Reels, medsos, dll) di naskah voiceover maupun Kotak Scene!
9. JANGAN PERNAH gunakan kata "link di bio" di dalam naskah voiceover. Selalu gunakan ajakan seperti "Cek produk di bawah sekarang", "Klik produk di bawah", atau "Checkout produk di bawah sebelum kehabisan".
10. PADA BAGIAN 'CAPTION': DILARANG KERAS menuliskan link Shopee, URL, tautan web apa pun, karakter China/Mandarin (seperti 朋友们), dan ajakan cek komentar pertama! Cukup sertakan hook, deskripsi manfaat, CTA di bio (misal: 'Cek produk di bio ya!'), dan hashtag viral.
11. Gunakan ejaan bahasa Indonesia baku yang wajar (misal: keren, elegan, praktis, keju, beres) tanpa menambahkan tanda aksen é atau è.
12. WAJIB 100% Bahasa Indonesia: DILARANG KERAS menyertakan tulisan/karakter China (Mandarin/Hanzi) di seluruh output (naskah, visual, scene, caption, prompt).

Return strict JSON in this format:
{
  "sampleContext": {
    "productName": "${effectiveTitle}",
    "videoDuration": "${targetDuration} detik",
    "targetAudience": "Target audiens",
    "coreProblem": "Masalah utama",
    "keyFeatures": ["Fitur 1", "Fitur 2", "Fitur 3"],
    "buyingTrigger": "Alasan psikologis beli"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "timeRange": "00:00 - 00:05",
      "visualDescription": "Deskripsi visual",
      "voiceover": "Teks narasi scene 1",
      "adAdvisorNotes": "Tips sutradara (SFX / Text Overlay)"
    }
  ],
  "voiceoverScript": "[00:00] Masih repot marut keju pakai alat lama?\\n[00:05] Kenalin parutan serbaguna ini...\\n[00:30] Cek produk di bawah sekarang!",
  "aiStudioPrompt": "Scene\\nStudio dapur modern...\\n\\nSample Context\\nDurasi voice over 30 detik. Iklan affiliate viral...\\n\\nSpeaker 1\\n[00:00] [intrigue] Masih repot...\\n[00:05] [excited] Kenalin...\\n[00:30] [excited] Cek produk di bawah sekarang!",
  "caption": "Teks caption lengkap dengan hook, manfaat, ajakan cek bio, dan hashtag viral...",
  "lexicon_to_replace": {
    "istilah_inggris": "pelafalan_fonetik_indonesia"
  }
}`;

  const messageContent = [
    { type: 'text', text: userPrompt },
    ...trimmedFrames.map((f) => ({
      type: 'image_url',
      image_url: {
        url: f.base64,
        detail: 'low',
      },
    })),
  ];

  const startTimeMs = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startTimeMs) / 1000);
    onProgress({
      step: 'gpt_scripting',
      message: `${provider} (${activeModel}) menyusun Kotak Scene & Naskah Ad Advisor... (${elapsedSec} detik)`,
      progress: Math.min(88, 78 + Math.floor(elapsedSec / 4)),
    });
  }, 2000);

  let totalRetries = modelFallbackList.length;
  let parsed = {};
  let lastError;
  let hasFallenBackToGemini = (provider === 'Google Gemini Direct');

  for (let attempt = 0; attempt < totalRetries; attempt++) {
    activeModel = modelFallbackList[attempt];
    try {
      if (attempt > 0) {
        for (let t = 4; t > 0; t--) {
          onProgress({
            step: 'gpt_scripting',
            message: `API overloaded/error. Switching fallback model (${activeModel}) naskah dalam ${t} detik...`,
            progress: 78,
          });
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      const response = await client.chat.completions.create({
        model: activeModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: messageContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4000,
      });

      clearInterval(heartbeat);

      const scriptMsg = response.choices?.[0]?.message;
      const rawContent = (scriptMsg?.content && scriptMsg.content.trim()) ? scriptMsg.content : (scriptMsg?.reasoning || '{}');
      console.log(`[AIService ${provider} ${activeModel} Scripting] Raw response length: ${rawContent.length}`);
      parsed = repairJson(rawContent);

      if (!parsed || (!parsed.sampleContext && !parsed.scenes && !parsed.voiceoverScript)) {
        throw new Error(`AI model ${activeModel} mengembalikan response kosong atau tidak lengkap.`);
      }

      break; // success — exit retry loop
    } catch (err) {
      lastError = err;
      const status = err.status || err.statusCode;
      const msg = (err.message || '').toLowerCase();
      const isFatalAuthOrBilling = status === 401 || status === 402 || msg.includes('balance') || msg.includes('credits');

      // Fallback langsung ke Google Gemini Direct API jika OpenRouter bermasalah atau habis saldo
      if (!hasFallenBackToGemini) {
        const geminiFallback = getDirectGeminiClientConfig({ apiKeyOverride: apiKey });
        if (geminiFallback && (isFatalAuthOrBilling || attempt >= totalRetries - 1)) {
          console.warn(`[AIService Scripting] OpenRouter error (${err.message}). Beralih langsung ke Google Gemini Direct API fallback (${geminiFallback.models[0]})...`);
          onProgress({
            step: 'gpt_scripting',
            message: `OpenRouter gagal. Mengaktifkan direct fallback Google Gemini API (${geminiFallback.models[0]})...`,
            progress: 78,
          });
          hasFallenBackToGemini = true;
          client = geminiFallback.client;
          modelFallbackList = geminiFallback.models;
          provider = geminiFallback.provider;
          totalRetries = modelFallbackList.length;
          attempt = -1; // Reset agar loop berikutnya mulai dari model Gemini pertama
          continue;
        }
      }

      if (attempt < totalRetries - 1) {
        console.warn(`[AIService Scripting] AI model ${activeModel} failed (attempt ${attempt + 1}, status: ${status}, error: ${msg}). Trying next fallback model...`);
        continue;
      }

      clearInterval(heartbeat);
      console.error(`[AIService ${provider} ${activeModel}] Error:`, err);
      throw new Error(formatApiError(err, activeModel, provider));
    }
  }

  if (lastError && !parsed.sampleContext && !parsed.scenes) {
    clearInterval(heartbeat);
    throw new Error(formatApiError(lastError, activeModel, provider));
  }

  const scenes = normalizeShortScenes(parsed.scenes, effectiveTitle, segmentDuration, sceneDuration);

  let voiceoverScript = (parsed.voiceoverScript || '').trim();
  if (!voiceoverScript && scenes.length > 0) {
    voiceoverScript = scenes.map(s => `[${s.timeRange ? s.timeRange.split(' - ')[0] : '00:00'}] ${s.voiceover}`).join('\n');
  }
  if (!voiceoverScript) {
    voiceoverScript = `[00:00] [excited] Nyuci motor pakai kain biasa? Fix kurang maksimal!
[00:03] [emphasis] Untung ada ${effectiveTitle} yang praktis ini.
[00:07] [soft] Busa melimpah, kotoran tebal langsung rontok seketika.
[00:11] [emphasis] Menjangkau sela-sela sempit bersih tuntas tanpa baret.
[00:15] [soft] Bahannya super lembut, awet dipakai berkali-kali.
[00:18] [excited] Harganya murah meriah banget, ramah di kantong!
[00:21] [excited] Cek keranjang pojok kiri bawah sekarang juga!`;
  }

  let caption = (parsed.caption || '').trim();
  // Strictly strip URLs, Shopee links, Chinese characters (朋友们), and unwanted comment CTAs
  caption = caption
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

  if (!caption) {
    caption = `🔥 Racun Belanja Viral: ${effectiveTitle}!\n\n${effectiveDesc ? effectiveDesc + '\n\n' : ''}Buruan checkout sekarang mumpung lagi diskon spesial!\n\n🛒 Cek produk di bio sekarang ya!\n\n#racunbelanja #racuntiktok #reelsviral #affiliateindonesia #spillracun`;
  }

  let aiStudioPrompt = (parsed.aiStudioPrompt || '').trim();
  const fallbackLastSec = Math.max(0, targetDuration - 5);
  if (!aiStudioPrompt) {
    aiStudioPrompt = `Scene\nStudio rekaman energik dengan presenter Indonesia yang antusias dan percaya diri.\n\nSample Context\nDurasi voice over ${fallbackLastSec} detik. Iklan affiliate viral. Dimulai dengan hook yang mengejutkan, membangun ke demonstrasi manfaat produk, diakhiri CTA yang meyakinkan. Nada suara hangat, antusias, dan persuasif.\n\nSpeaker 1 - Orus\n[intrigue] Stop scroll dulu! [desire] ${effectiveTitle} yang satu ini beneran wajib kamu punya! [information] ${effectiveDesc ? effectiveDesc.slice(0, 120) + '.' : 'Produk ini hadir dengan kualitas premium dan desain yang praktis untuk kebutuhan sehari-hari.'} [excited] Udah ribuan orang pake dan reviewnya bagus semua! [inspiration] Kualitasnya terbukti awet dan terpercaya untuk jangka panjang. [confident] Buruan cek produk di bawah sekarang sebelum kehabisan!`;
  } else {
    // Normalize aiStudioPrompt duration in Sample Context based on the last speaker 1 timestamp
    const timestampMatches = [...aiStudioPrompt.matchAll(/\[(\d{1,2}):(\d{2})\]/g)];
    let lastSec = fallbackLastSec;
    if (timestampMatches.length > 0) {
      const lastMatch = timestampMatches[timestampMatches.length - 1];
      const mins = parseInt(lastMatch[1], 10);
      const secs = parseInt(lastMatch[2], 10);
      lastSec = mins * 60 + secs;
    }
    if (/durasi\s+(?:video|voice\s+over)?\s*\d+\s*detik/i.test(aiStudioPrompt)) {
      aiStudioPrompt = aiStudioPrompt.replace(/durasi\s+(?:video|voice\s+over)?\s*\d+\s*detik/i, `Durasi voice over ${lastSec} detik`);
    }
    aiStudioPrompt = aiStudioPrompt.replace(/durasi\s+video/gi, 'durasi voice over');
  }

  onProgress({
    step: 'gpt_scripting',
    message: `${provider} (${activeModel}) generated Kotak Scene, Sample Context, and Naskah successfully!`,
    progress: 88
  });

  voiceoverScript = sanitizeScriptVocabulary(voiceoverScript);
  aiStudioPrompt = sanitizeScriptVocabulary(aiStudioPrompt);
  caption = sanitizeScriptVocabulary(caption);
  for (const s of scenes) {
    if (s.voiceover) s.voiceover = sanitizeScriptVocabulary(s.voiceover);
    if (s.visualDescription) s.visualDescription = sanitizeScriptVocabulary(s.visualDescription);
    if (s.adAdvisorNotes) s.adAdvisorNotes = sanitizeScriptVocabulary(s.adAdvisorNotes);
  }

  // Deteksi dan simpan otomatis kata bahasa Inggris ke kamus fonetik backend (Pendekatan LLM Pre-processing)
  const detectedLexicon = (parsed && parsed.lexicon_to_replace && typeof parsed.lexicon_to_replace === 'object')
    ? parsed.lexicon_to_replace
    : {};

  if (Object.keys(detectedLexicon).length > 0) {
    console.log(`[AIService] 📖 Mendeteksi kata bahasa Inggris dari skrip AI:`, detectedLexicon);
    saveToEnglishDictionary(detectedLexicon);
  }

  return {
    sampleContext: parsed.sampleContext || {
      productName: effectiveTitle,
      videoDuration: `${targetDuration} detik`,
      targetAudience: "Pencari produk viral & praktis",
      coreProblem: "Mencari produk berkualitas dengan harga terjangkau",
      keyFeatures: ["Praktis & Multifungsi", "Bahan Berkualitas", "Harga Terjangkau"],
      buyingTrigger: "FOMO & Diskon Terbatas"
    },
    scenes,
    voiceoverScript,
    aiStudioPrompt,
    caption,
    lexicon_to_replace: detectedLexicon,
  };
}

/**
 * Filter kata-kata script: hindari kata 'kangen' dan 'ng' slang, serta pastikan keju=keju dan beres=beres
 */
export function sanitizeScriptVocabulary(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // 0. Hapus karakter China/Mandarin/Hanzi (misal dari minimax):
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/gu, '')

    // 1. Tulis persis keju=keju dan beres=beres tanpa tanda aksen kecil di atas huruf e:
    .replace(/\b(?:kéju|kèju|kêju)\b/gi, 'keju')
    .replace(/\b(?:bérés|bèrès|bêrês)\b/gi, 'beres')
    .replace(/\b(?:dibéréskan|dibèrèskan)\b/gi, 'dibereskan')
    .replace(/\b(?:membéréskan|membèrèskan)\b/gi, 'membereskan')
    .replace(/\b(?:méja|mèja|mêja)\b/gi, 'meja')

    // 2. Hindari kata kangen:
    .replace(/\bkangen\b/gi, 'ingin')

    // 3. Hindari kata slang awalan "ng":
    .replace(/\b(?:enggak|engga|nggak|ngga)\b/gi, 'tidak')
    .replace(/\bngasih\b/gi, 'kasih')
    .replace(/\bngeliat\b/gi, 'melihat')
    .replace(/\bngerasain\b/gi, 'merasakan')
    .replace(/\bngapain\b/gi, 'kenapa')
    .replace(/\bngerepotin\b/gi, 'merepotkan')
    .replace(/\bngaruh\b/gi, 'berpengaruh')
    .replace(/\bngelakuin\b/gi, 'melakukan')
    .replace(/\bngambil\b/gi, 'mengambil')
    .replace(/\bngatur\b/gi, 'mengatur')
    .replace(/\bngabisin\b/gi, 'menghabiskan')
    .replace(/\bngeluarin\b/gi, 'mengeluarkan')
    .replace(/\bngeringin\b/gi, 'mengeringkan')
    .replace(/\bngisi\b/gi, 'mengisi')
    .replace(/\bngiris\b/gi, 'mengiris')
    .replace(/\bngulek\b/gi, 'mengulek')
    .replace(/\bngaduk\b/gi, 'mengaduk')
    .replace(/\bngupas\b/gi, 'mengupas')
    .replace(/\bngoles\b/gi, 'mengoles')
    .replace(/\bngocok\b/gi, 'mengocok');
}

// Robust JSON parser with auto-repair for truncated output
function repairJson(raw) {
  if (!raw || typeof raw !== 'string') return {};
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (initialErr) {
    try {
      let str = cleaned;
      if (str.endsWith('\\')) str = str.slice(0, -1);

      // Check unclosed quote
      let inString = false;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '"' && (i === 0 || str[i - 1] !== '\\')) {
          inString = !inString;
        }
      }
      if (inString) str += '"';

      // Balance braces and brackets
      const stack = [];
      let inStr = false;
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '"' && (i === 0 || str[i - 1] !== '\\')) {
          inStr = !inStr;
        } else if (!inStr) {
          if (c === '{' || c === '[') stack.push(c);
          else if (c === '}' && stack[stack.length - 1] === '{') stack.pop();
          else if (c === ']' && stack[stack.length - 1] === '[') stack.pop();
        }
      }

      while (stack.length > 0) {
        const top = stack.pop();
        if (top === '{') str += '}';
        else if (top === '[') str += ']';
      }

      return JSON.parse(str);
    } catch {
      throw initialErr;
    }
  }
}

// Helpers
function formatSeconds(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function parseTimeToSeconds(timeStr) {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr) return 0;
  const parts = timeStr.toString().split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parseFloat(timeStr) || 0;
}

function normalizeReframe(reframe = {}) {
  const focusX = clampNumber(reframe.focusX, 0, 1, DEFAULT_REFRAME.focusX);
  const focusY = clampNumber(reframe.focusY, 0, 1, DEFAULT_REFRAME.focusY);
  const avoidTextZones = Array.isArray(reframe.avoidTextZones)
    ? reframe.avoidTextZones.filter(Boolean).map((zone) => zone.toString().slice(0, 40))
    : [];
  const avoidFaceZones = Array.isArray(reframe.avoidFaceZones)
    ? reframe.avoidFaceZones.filter(Boolean).map((zone) => zone.toString().slice(0, 40))
    : DEFAULT_REFRAME.avoidFaceZones;

  const validRenderModes = ['stage_80', 'square_stage', 'fit_canvas', 'vertical_crop'];
  const renderMode = validRenderModes.includes(reframe.renderMode) ? reframe.renderMode : 'stage_80';

  return {
    focusX,
    focusY,
    renderMode,
    cropStrategy: (reframe.cropStrategy || DEFAULT_REFRAME.cropStrategy).toString().slice(0, 80),
    avoidTextZones,
    avoidFaceZones,
    faceSafety: reframe.faceSafety !== false,
    allowHflip: reframe.allowHflip !== false,
    hasProductBrand: Boolean(reframe.hasProductBrand),
    notes: (reframe.notes || DEFAULT_REFRAME.notes).toString().slice(0, 180),
  };
}

function normalizeClipPlan(rawClips, totalDuration, { allowFallback = true, frameAudit = [], hasProductBrand = false, allowHflip = true, sceneDuration = 3.3 } = {}) {
  const clipLength = Math.max(2.5, Math.min(5.0, Number(sceneDuration) || 3.3));
  const sourceClips = Array.isArray(rawClips) ? rawClips : [];
  const normalized = [];
  let previousEnd = -1;

  console.log(`[normalizeClipPlan] totalDuration=${totalDuration}s, rawClips=${sourceClips.length}, clipLength=${clipLength}s, frameAudit=${frameAudit.length}, hasProductBrand=${hasProductBrand}, allowHflip=${allowHflip}`);

  // Build a set of timestamps containing detected floating text, subtitles, watermarks, faces, or amateur framing
  const dirtyTimestamps = [];
  if (Array.isArray(frameAudit)) {
    for (const audit of frameAudit) {
      const floatingText = (audit.detectedFloatingOverlay || audit.detectedFloatingOverlayText || audit.floatingText || '').toLowerCase().trim();
      const hasFloatingOverlay = audit.hasFloatingOverlay === true ||
        audit.hasFloatingOverlayText === true ||
        (floatingText && floatingText !== 'none' && floatingText !== 'null' && floatingText !== 'false');

      const isPhysicalBrand = audit.hasPhysicalBrandText === true ||
        audit.hasPhysicalProductBrandOrText === true ||
        (audit.detectedPhysicalBrand && audit.detectedPhysicalBrand.toLowerCase() !== 'none');

      // Only reject legacy text if it is NOT physical brand
      const legacyText = (audit.detectedText || '').toLowerCase().trim();
      const isLegacySubtitle = !isPhysicalBrand && (audit.hasTextOrSubtitles === true || (legacyText && legacyText !== 'none' && legacyText !== 'null' && legacyText !== 'false'));
      const hasFace = audit.hasFace === true;
      const isPoorlyFramed = audit.isWellFramed === false;
      const isUnboxing = audit.isUnboxing === true ||
        (audit.detectedAction && /unbox|kardus|paket|buka paket|kemasan|packaging|bubble wrap/i.test(audit.detectedAction));

      if (hasFloatingOverlay || isLegacySubtitle || hasFace || isPoorlyFramed || isUnboxing) {
        const sec = Math.round(parseTimeToSeconds(audit.timestamp ?? audit.frameIndex));
        dirtyTimestamps.push(sec);
      }
    }
  }

  for (const rawClip of sourceClips) {
    let startSeconds = Math.max(0, Math.round(parseTimeToSeconds(rawClip?.startSeconds ?? rawClip?.startTime)));
    if (startSeconds < previousEnd) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}s: overlaps previous end ${previousEnd}s`);
      continue;
    }
    if (startSeconds + clipLength > totalDuration) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}s: exceeds totalDuration ${totalDuration}s`);
      continue;
    }
    if (rawClip?.isCleanAffiliateShot === false && rawClip?.hasFloatingOverlay === true) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}s: hasFloatingOverlay=true`);
      continue;
    }
    if (hasSourceIdentityRisk(rawClip)) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}s: sourceIdentityRisk=${rawClip?.sourceIdentityRisk}`);
      continue;
    }

    // Strictly discard any clip that is flagged as unboxing or packaging
    const isUnboxingClip = rawClip?.isUnboxing === true ||
      /unbox|kardus|paket|kemasan|packaging|bubble wrap|buka paket/i.test(String(rawClip?.reason || ''));
    if (isUnboxingClip) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}s: unboxing activity rejected (pro-affiliate mode)`);
      continue;
    }

    const endSeconds = startSeconds + clipLength;

    // Discard any clip interval that covers dirty frames containing floating text/subtitles/watermarks/unboxing
    const overlapsDirtyFrame = dirtyTimestamps.some(ts => ts >= startSeconds && ts <= endSeconds);
    if (overlapsDirtyFrame) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}-${endSeconds}s: overlaps frame with detected subtitle/watermark/unboxing`);
      continue;
    }

    const clipHasBrand = hasProductBrand || rawClip?.hasProductBrand === true || rawClip?.hasPhysicalBrandText === true || rawClip?.reframe?.hasProductBrand === true;
    const clipAllowHflip = clipHasBrand ? false : (allowHflip !== false && rawClip?.allowHflip !== false && rawClip?.reframe?.allowHflip !== false);

    normalized.push({
      startSeconds,
      endSeconds,
      duration: clipLength,
      startTime: formatSeconds(startSeconds),
      endTime: formatSeconds(endSeconds),
      reason: (rawClip?.reason || 'Clean full-product affiliate shot.').toString().slice(0, 180),
      hasProductBrand: clipHasBrand,
      allowHflip: clipAllowHflip,
      reframe: normalizeReframe({
        ...rawClip?.reframe,
        hasProductBrand: clipHasBrand,
        allowHflip: clipAllowHflip,
      }),
    });
    previousEnd = endSeconds;
    if (normalized.length === 8) break; // Target max 8 clips (~24-26s)
  }

  console.log(`[normalizeClipPlan] Accepted ${normalized.length} valid clips from AI vision`);

  if (normalized.length >= 5) {
    return normalized;
  }

  if (!allowFallback) {
    const cleanErr = new Error('AI menolak video ini: tidak ditemukan minimal 5 potongan video bersih dari watermark, subtitle terjemahan, nama channel mengambang, wajah, atau proses unboxing.');
    cleanErr.isAiRejection = true;
    cleanErr.rejectionReason = 'Tidak ditemukan minimal 5 potongan video bersih dari watermark, subtitle terjemahan, nama channel, wajah, atau proses unboxing.';
    throw cleanErr;
  }

  // Fallback: build 6 to 8 evenly spaced clips (around 20 to 26 seconds total, exactly clipLength per clip)
  console.log(`[normalizeClipPlan] Building ~20-26s fallback clip plan for ${totalDuration}s video with clipLength=${clipLength}s`);
  const fallbackClips = [];
  const targetTotalSec = 24;
  const fallbackTargetClips = Math.min(8, Math.max(5, Math.floor(Math.min(totalDuration, targetTotalSec) / clipLength)));
  const maxStart = Math.max(0, Math.floor(totalDuration - clipLength));
  // Avoid first 15-18% of video in fallback to bypass intro unboxing segments on YouTube
  const fallbackStart = totalDuration > 30
    ? Math.min(maxStart, Math.max(0, Math.floor(totalDuration * 0.18)))
    : (totalDuration > 20 ? Math.min(maxStart, Math.max(0, Math.floor(totalDuration * 0.10))) : 0);
  const fallbackLastStart = totalDuration > 30
    ? Math.max(fallbackStart, Math.min(maxStart, Math.floor(totalDuration * 0.95) - clipLength))
    : maxStart;

  const span = fallbackLastStart - fallbackStart;
  const numSteps = Math.max(1, fallbackTargetClips - 1);
  const stepSize = fallbackTargetClips > 1 ? span / numSteps : clipLength;

  let lastStart = -1;
  for (let i = 0; i < fallbackTargetClips; i++) {
    const rawStart = Math.round(fallbackStart + (i * stepSize));
    const startSeconds = Math.min(maxStart, Math.max(lastStart + clipLength, rawStart));
    if (startSeconds + clipLength > totalDuration) break;
    
    fallbackClips.push({
      startSeconds,
      endSeconds: startSeconds + clipLength,
      duration: clipLength,
      startTime: formatSeconds(startSeconds),
      endTime: formatSeconds(startSeconds + clipLength),
      reason: `Fallback ${clipLength}s product shot.`,
      hasProductBrand,
      allowHflip,
      reframe: normalizeReframe({
        hasProductBrand,
        allowHflip,
      }),
    });
    lastStart = startSeconds;
  }

  if (!fallbackClips.length) {
    throw new Error(`Video terlalu pendek untuk membuat potongan produk utama (minimal ${Math.round(clipLength * 4)} detik).`);
  }
  return fallbackClips;
}

function hasSourceIdentityRisk(rawClip = {}) {
  if (rawClip.sourceOwnerIdentityVisible === true) return true;

  const risk = (rawClip.sourceIdentityRisk || '').toString().toLowerCase().trim();
  if (!risk || risk === 'none' || risk === 'low' || risk === 'false' || risk === 'no') return false;

  return true;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function buildFallbackScenes(productName, segmentDuration, sceneDuration = 3.3) {
  const totalDuration = Math.max(18, Math.min(35, Math.round(Number(segmentDuration) || 24)));
  const sceneLength = Math.max(2.5, Math.min(5.0, Number(sceneDuration) || 3.3));
  const sceneCount = Math.max(5, Math.min(8, Math.round(totalDuration / sceneLength)));
  const sceneTemplates = [
    {
      visualDescription: `Hook perbandingan visual: demonstrasi cara lama atau alat biasa yang kurang maksimal.`,
      voiceover: `Kalau masih pakai cara lama atau kain biasa, fix kurang maksimal!`,
      adAdvisorNotes: 'Teks hook merah/kuning tebal, SFX alert, potongan cepat 3 detik pertama.'
    },
    {
      visualDescription: `Solusi hero: ${productName} ditampilkan saat mulai digunakan dengan mudah.`,
      voiceover: `Untung sekarang ada ${productName} ini, sekali usap langsung beres.`,
      adAdvisorNotes: 'Transisi snappy, tunjukkan tangan memegang produk dengan percaya diri.'
    },
    {
      visualDescription: `Aksi satisfying demo: busa melimpah atau kotoran rontok seketika.`,
      voiceover: `Busanya melimpah banget dan langsung mengangkat semua kotoran membandel.`,
      adAdvisorNotes: 'Visual satisfying close-up, SFX desis busa / gosokan bersih.'
    },
    {
      visualDescription: `Menjangkau sela-sela sempit yang sulit dijangkau alat biasa.`,
      voiceover: `Bisa menjangkau sela-sela sempit tanpa bikin tangan lecet atau baret.`,
      adAdvisorNotes: 'Close-up sela-sela bersih kinclong, pergerakan tangan luwes.'
    },
    {
      visualDescription: `Detail material produk: tebal, lembut, dan awet dicuci berkali-kali.`,
      voiceover: `Materialnya tebal dan halus, gak gampang rontok walau dipakai tiap hari.`,
      adAdvisorNotes: 'Tunjukkan tekstur produk, teks benefit kuning di layar.'
    },
    {
      visualDescription: `Psikologi harga: produk ditampilkan siap pakai dengan tulisan promo hemat.`,
      voiceover: `Harganya murah meriah banget, bener-bener gak bikin kantong jebol!`,
      adAdvisorNotes: 'Teks harga promo mencolok, SFX kaching / coin.'
    },
    {
      visualDescription: `Hero shot penutup dengan animasi panah ke keranjang kuning pojok kiri bawah.`,
      voiceover: `Buruan cek keranjang pojok kiri bawah sekarang sebelum kehabisan!`,
      adAdvisorNotes: 'Grafis panah berkedip ke pojok kiri bawah, CTA mendesak.'
    },
    {
      visualDescription: `Stiker diskon dan keranjang kuning berkedip.`,
      voiceover: `Langsung checkout di keranjang pojok kiri bawah mumpung masih promo!`,
      adAdvisorNotes: 'Teks urgensi terakhir, SFX click.'
    },
  ];

  return Array.from({ length: sceneCount }, (_, index) => {
    const start = Math.round(index * sceneLength * 10) / 10;
    const end = Math.min(totalDuration, Math.round((start + sceneLength) * 10) / 10);
    const template = sceneTemplates[Math.min(index, sceneTemplates.length - 1)];

    return {
      sceneNumber: index + 1,
      timeRange: `${formatSeconds(start)} - ${formatSeconds(end)}`,
      ...template,
    };
  });
}

function normalizeShortScenes(scenes, productName, segmentDuration, sceneDuration = 3.3) {
  const fallbackScenes = buildFallbackScenes(productName, segmentDuration, sceneDuration);
  const sourceScenes = Array.isArray(scenes) ? scenes : [];

  return fallbackScenes.map((fallback, index) => {
    const source = sourceScenes[index] || {};
    return {
      ...fallback,
      visualDescription: source.visualDescription || fallback.visualDescription,
      voiceover: source.voiceover || fallback.voiceover,
      adAdvisorNotes: source.adAdvisorNotes || fallback.adAdvisorNotes,
    };
  });
}

/**
 * Stage 2 Helper: Detects English words, brands, and terms in a voiceover script / product title
 * using AI, determines their Indonesian phonetic pronunciation, and automatically saves
 * them into the persistent English dictionary.
 */
export async function detectPhoneticLexiconWithAI({
  script,
  productTitle = '',
  apiKey = '',
  aiProvider = '',
  onProgress = () => {}
}) {
  if (!script && !productTitle) {
    return {};
  }

  let activeConfig;
  try {
    activeConfig = getAiClientConfig({ apiKeyOverride: apiKey, aiProvider });
  } catch (confErr) {
    console.warn('[AIService Lexicon] Could not init AI client:', confErr.message);
    return {};
  }

  let { client, models: modelFallbackList, provider } = activeConfig;
  let activeModel = modelFallbackList[0];

  const systemPrompt = `Kamu adalah pakar fonetik bahasa Indonesia dan linguistik Text-to-Speech (TTS).
Tugasmu adalah menganalisis teks naskah voiceover dan judul produk, lalu mendeteksi SEMUA kata, merk, produk, atau istilah bahasa Inggris / asing.
Untuk setiap istilah yang kamu temukan, buatlah ejaan pelafalan fonetik bahasa Indonesia yang sesuai agar mesin TTS Bahasa Indonesia (seperti Edge-TTS Gadis) dapat melafalkannya dengan fasih, natural, dan tepat tanpa terdengar kaku atau aneh.

CONTOH PEMETAAN FONETIK BAHASA INDONESIA:
- 'chopper' -> 'coper'
- 'food chopper' -> 'fud coper'
- 'stainless steel' -> 'stenlis stil'
- 'air fryer' / 'airfryer' -> 'er frayer'
- 'steak' -> 'stik'
- 'juicy' -> 'jusi'
- 'online' -> 'onlen'
- 'checkout' -> 'cekot'
- 'touch screen' -> 'tac skrin'
- 'wireless' -> 'wayirles'
- 'sponge' -> 'spons'
- 'freezer' -> 'frizer'
- 'portable' -> 'portebel'
- 'aesthetic' -> 'estetik'
- 'smart lock' -> 'smart lok'
- 'vacuum cleaner' -> 'vakum klinir'
- 'charger' -> 'carjer'
- 'earphone' / 'earphones' -> 'irfon'
- 'frypan' / 'fry pan' -> 'fray pen'

ATURAN OUTPUT:
- Output WAJIB strictly JSON murni:
{
  "lexicon_to_replace": {
    "istilah_inggris": "pelafalan_fonetik_indonesia"
  }
}
- Key istilah harus dalam huruf kecil (lowercase).
- Jika tidak ada kata bahasa Inggris yang ditemukan, kembalikan objek kosong:
{
  "lexicon_to_replace": {}
}`;

  const userPrompt = `Analisis teks berikut dan ekstrak semua istilah/kata bahasa Inggris beserta pelafalan fonetik Indonesianya:
Judul Produk: "${productTitle}"
Naskah:
"""
${script}
"""

Kembalikan format JSON persis:
{
  "lexicon_to_replace": {
    "istilah": "fonetik"
  }
}`;

  let parsed = {};
  let totalRetries = modelFallbackList.length;
  let hasFallenBackToGemini = (provider === 'Google Gemini Direct');

  for (let attempt = 0; attempt < totalRetries; attempt++) {
    activeModel = modelFallbackList[attempt];
    try {
      onProgress({
        step: 'ai_lexicon_detection',
        message: `Mendeteksi istilah Inggris & fonetik dengan AI (${provider} - ${activeModel})...`,
        progress: 25,
      });

      const response = await client.chat.completions.create({
        model: activeModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1500,
      });

      const scriptMsg = response.choices?.[0]?.message;
      const rawContent = (scriptMsg?.content && scriptMsg.content.trim()) ? scriptMsg.content : (scriptMsg?.reasoning || '{}');
      parsed = repairJson(rawContent);
      break;
    } catch (err) {
      const status = err.status || err.statusCode;
      const msg = (err.message || '').toLowerCase();
      const isFatalAuthOrBilling = status === 401 || status === 402 || msg.includes('balance') || msg.includes('credits');

      if (!hasFallenBackToGemini) {
        const geminiFallback = getDirectGeminiClientConfig({ apiKeyOverride: apiKey });
        if (geminiFallback && (isFatalAuthOrBilling || attempt >= totalRetries - 1)) {
          console.warn(`[AIService Lexicon] OpenRouter fallback ke Google Gemini Direct API...`);
          hasFallenBackToGemini = true;
          client = geminiFallback.client;
          modelFallbackList = geminiFallback.models;
          provider = geminiFallback.provider;
          totalRetries = modelFallbackList.length;
          attempt = -1;
          continue;
        }
      }

      if (attempt < totalRetries - 1) {
        console.warn(`[AIService Lexicon] Model ${activeModel} gagal. Mencoba model berikutnya...`);
        continue;
      }
      console.warn(`[AIService Lexicon] Semua model AI gagal, melanjutkan tanpa kamus baru:`, err.message);
      return {};
    }
  }

  const detected = (parsed && parsed.lexicon_to_replace && typeof parsed.lexicon_to_replace === 'object')
    ? parsed.lexicon_to_replace
    : {};

  const cleanDetected = {};
  for (const [k, v] of Object.entries(detected)) {
    if (k && v && typeof k === 'string' && typeof v === 'string') {
      const cleanKey = k.trim().toLowerCase();
      const cleanVal = v.trim().toLowerCase();
      if (cleanKey && cleanVal && cleanKey !== cleanVal) {
        cleanDetected[cleanKey] = cleanVal;
      }
    }
  }

  if (Object.keys(cleanDetected).length > 0) {
    console.log(`[AIService Lexicon] 📖 Menambahkan istilah fonetik ke kamus:`, cleanDetected);
    saveToEnglishDictionary(cleanDetected);
  }

  return cleanDetected;
}

