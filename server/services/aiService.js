import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  "minimax/minimax-m3:free",
  "openrouter/auto"
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
  'gemini-2.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
];

function getDirectGeminiApiKey(apiKeyOverride) {
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

  // If Gemini is explicitly requested or configured, prioritize Gemini Direct
  const reqProvider = (aiProvider || '').trim().toLowerCase();
  const envEngine = (process.env.ACTIVE_AI_ENGINE || '').trim().toLowerCase();
  if (apiKeyOverride?.startsWith('AIzaSy') || reqProvider === 'gemini' || envEngine === 'gemini') {
    const geminiConf = getDirectGeminiClientConfig({ apiKeyOverride });
    if (geminiConf) {
      console.log(`[AIService] Initialize Direct Google Gemini Client (${geminiConf.models[0]})...`);
      return geminiConf;
    }
  }

  const openRouterKeys = getOpenRouterKeys(apiKeyOverride);
  if (openRouterKeys.length > 0) {
    const safeIndex = currentOpenRouterKeyIndex % openRouterKeys.length;
    currentOpenRouterKeyIndex++; 

    console.log(`[AIService] Initialize OpenRouter Client: Key=${openRouterKeys[safeIndex].substring(0, 10)}...`);

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

  // Fallback to direct Gemini API if OpenRouter keys are not available
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
  renderMode: 'square_stage',
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
 * Stage 1, Step A: Calls AI Vision API (Alibaba Qwen / Google Gemini)
 * to analyze the full video timeline and select a cut plan made of 5-second product shots.
 */
export async function selectHighlightWithAI({
  apiKey,
  aiProvider,
  frames,
  videoMetadata,
  productTitle,
  productDescription,
  shopeeLink,
  sceneDuration = 3.3,
  allowFallbackClips = false,
  onProgress = () => {}
}) {
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

CRITICAL RULE 1: EXACT PHYSICAL PRODUCT MATCH VERIFICATION
- Identify what physical product is being demonstrated in these visual frames.
- Compare it directly with the target Shopee product: "${effectiveTitle}".
- The product in the video MUST be the EXACT same product type, function, and model as "${effectiveTitle}".
- REJECT IMMEDIATELY if the video shows a DIFFERENT product (for example: target is an electric mini chopper, but video shows a vegetable slicer, knife set, oil bottle, or unrelated item).
- REJECT IMMEDIATELY if the video is a compilation / haul video showing multiple random gadgets instead of specifically demonstrating this product.
- If rejected for wrong product, output:
  {"status": "reject", "detectedProduct": "<nama produk yang tampak di video>", "isExactProductMatch": false, "reason": "Produk di video (<nama produk>) tidak cocok dengan produk Shopee (${effectiveTitle})"}

CRITICAL RULE 2: ABSOLUTE ZERO HUMAN FACES & ZERO HUMAN BODIES (STRICT FACELESS MANDATE):
- The final video output MUST BE 100% FACELESS AND HUMAN-FREE!
- DILARANG MENAMPILKAN WAJAH ATAU MANUSIA DALAM VIDEO OUTPUT!
- The ONLY permitted human element is HANDS/FINGERS ONLY actively demonstrating, holding, pressing, or operating the product against a tabletop/neutral background (faceless close-up hands-only demonstration).
- ZERO TOLERANCE FOR FACES: NEVER select any frame where a human face (front, side profile, looking down, background face, creator reaction), head, neck, torso, or whole person body is visible!
- If a frame contains a face, head, or person's body, DO NOT SELECT THAT FRAME NUMBER.
- If the entire video is person-centric, talking head, vlog, or does NOT contain at least 5 distinct, completely faceless product demonstration moments (spaced at least 3 seconds apart), REJECT THE VIDEO IMMEDIATELY:
  {"status": "reject", "isExactProductMatch": false, "reason": "Video menampilkan wajah atau manusia. Video affiliate wajib 100% bebas dari wajah dan manusia (hanya peragaan tangan atau produk saja)."}

CRITICAL RULE 3: OTHER REJECTION CRITERIA:
1. AI-GENERATED / SYNTHETIC / CGI / ANIMATION:
   - REJECT if the video is AI-generated (e.g. Sora, Runway, Kling, Hailuo, synthetic video, 3D animated, CGI, cartoon, or computer-generated slop).
   - Footage MUST be REAL, AUTHENTIC PHYSICAL DEMONSTRATION with real human hands.
2. TALKING HEADS & NON-PRODUCT FOOTAGE:
   - REJECT if it is a person talking to camera / vlog / talking head with no direct hands-on product demonstration.
   - REJECT if it is pure parcel unboxing / bubble wrap with no actual product in action.
3. DIRTY / WATERMARKED / CHANNEL LOGOS:
   - REJECT if the video is dominated by channel watermarks, channel logos, creator handles (@username), or floating subtitles that cannot be avoided.

CRITICAL RULE 4: PRIORITIZE SATISFYING ACTION DEMONSTRATIONS (VISUAL PROOF):
- Shopee video audiences buy 'solutions', not just static products. Audiences love satisfying visual transformations!
- PRIORITIZE frames showing active, satisfying demonstration: rich foam/busa melimpah, instant stain removal/cleaning, smooth cutting/chopping, water spraying, mechanism operating, or before/after transformation.
- AVOID static/idle shots where nothing is actively happening.

CRITERIA FOR ACCEPTANCE:
- Video shows REAL, AUTHENTIC, SATISFYING PHYSICAL HANDS-ON DEMONSTRATION of the EXACT product: "${effectiveTitle}".
- 100% FACELESS & HUMAN-FREE: Only hands demonstrating the product or pure product shots are visible.
- STRICT ZERO WATERMARK/IDENTITY: NEVER select frames with channel watermarks, logos, or subtitles!
- Select 6 to 8 frame indices (numbers 1 to ${frames.length}) showing the best distinct, satisfying, watermark-free, FACELESS product action moments (spaced ~3 to 4 seconds apart).
- productHook: Write a powerful 3-second PROBLEM-BASED HOOK in Indonesian following this exact formula: "Kalau [kebiasaan/cara lama pakai alat biasa], fix [masalah fatal/kurang maksimal]!" (e.g. "Kalau nyuci motor masih pakai kain biasa, fix kurang maksimal!")
- Output strict minimal JSON:
{"status": "accept", "detectedProduct": "<nama produk di video>", "isExactProductMatch": true, "hasFaceOrHumanInSelectedFrames": false, "frames": [4, 8, 12, 16, 20, 24], "productHook": "<hook masalah 3 detik>", "hasProductBrand": false}`;

  const userPrompt = `Target Shopee Product: "${effectiveTitle}"
${effectiveDesc ? `Product Description: "${effectiveDesc}"` : ''}
Total Duration: ${totalDuration}s
Sampled Frames:
${frames.map((f, i) => `#${i + 1} (${f.timeFormatted})`).join(', ')}

Review visual frames carefully:
1. Visual Product Match: Does the physical item in the video match "${effectiveTitle}" exactly?
   - If DIFFERENT product or compilation: output {"status": "reject", "detectedProduct": "<nama produk>", "isExactProductMatch": false, "reason": "Produk di video tidak cocok dengan link Shopee"}
2. Strict Faceless & Human-Free QC: Does the video show human faces or people?
   - Selected frames MUST NEVER contain any human face, head, or human body! Only hands or product shots allowed.
   - If at least 4 clean faceless product shots cannot be found: output {"status": "reject", "isExactProductMatch": false, "reason": "Video menampilkan wajah atau manusia"}
3. Video Quality & Authenticity: Is it AI-generated, talking head without demo, or covered in watermarks?
   - If YES: output {"status": "reject", "isExactProductMatch": false, "reason": "<alasan penolakan>"}
4. If it is a clean, REAL, 100% FACELESS hands-on demo of the EXACT product "${effectiveTitle}":
   - Output {"status": "accept", "detectedProduct": "<nama produk>", "isExactProductMatch": true, "hasFaceOrHumanInSelectedFrames": false, "frames": [indices], "productHook": "...", "hasProductBrand": false}`;

  const messageContent = [
    { type: 'text', text: userPrompt },
    ...frames.map((f) => ({
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

      const rawContent = response.choices?.[0]?.message?.content || '{}';
      console.log(`[AIService ${provider} ${activeModel}] Raw response:`, rawContent);
      let parsed = repairJson(rawContent);

      const rawStatus = String(parsed.status || '').toLowerCase().trim();
      const isRejectStatus = rawStatus === 'reject' || rawStatus === 'rejected' || rawStatus === 'ditolak';
      const isMatchFalse = parsed.isProductMatch === false || parsed.isExactProductMatch === false || parsed.isUsableSourceVideo === false;
      const hasFace = parsed.hasFaceOrHumanInSelectedFrames === true;

      if (isRejectStatus || isMatchFalse || hasFace) {
        const rejectionMsg = parsed.reason || parsed.rejectionReason || (hasFace ? 'Video menampilkan wajah atau manusia.' : 'Video ditolak oleh AI: Produk di video tidak cocok dengan link Shopee atau tidak fokus pada peragaan produk fisik asli.');
        console.warn(`[AIService ${provider} ${activeModel}] ⛔ VIDEO RESMI DITOLAK OLEH AI: ${rejectionMsg}`);
        const rejectError = new Error(`Video ditolak oleh AI (${activeModel}): ${rejectionMsg}`);
        rejectError.isAiRejection = true;
        rejectError.rejectionReason = rejectionMsg;
        throw rejectError;
      }

      const selectedIndices = Array.isArray(parsed.frames) ? parsed.frames : [];
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
              renderMode: 'square_stage',
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

      // Fallback langsung ke Google Gemini Direct API jika OpenRouter bermasalah atau habis saldo
      if (!hasFallenBackToGemini) {
        const geminiFallback = getDirectGeminiClientConfig({ apiKeyOverride: apiKey });
        if (geminiFallback && (isFatalAuthOrBilling || attempt >= totalRetries - 1)) {
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
   - Use dynamic emotional tone & pacing tags so the AI voiceover (Fish Audio S2.1 Pro) sounds lively, expressive, and NEVER monotone:
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
  "caption": "Teks caption lengkap dengan hook, manfaat, ajakan cek bio, dan hashtag viral..."
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

      const rawContent = response.choices?.[0]?.message?.content || '{}';
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

  const validRenderModes = ['square_stage', 'fit_canvas', 'vertical_crop'];
  const renderMode = validRenderModes.includes(reframe.renderMode) ? reframe.renderMode : 'square_stage';

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
