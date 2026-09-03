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
  "openrouter/auto",
  "google/gemini-2.0-pro-exp-02-05:free",
  "google/gemini-2.5-flash-free",
  "google/lyria-3-clip-preview",
  "qwen/qwen-vl-plus:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free"
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

function getAiClientConfig({ apiKeyOverride } = {}) {
  loadEnvFromDisk();
  
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

  throw new Error('OpenRouter API Key belum disetel di server/.env (OPENROUTER_API_KEY). Silakan tambahkan OPENROUTER_API_KEY di file server/.env.');
}

const DEFAULT_REFRAME = {
  focusX: 0.5,
  focusY: 0.62,
  cropStrategy: 'faceless_product_hands_avoid_creator_text',
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
  frames,
  videoMetadata,
  productTitle,
  productDescription,
  shopeeLink,
  allowFallbackClips = false,
  onProgress = () => {}
}) {
  let activeConfig = getAiClientConfig({ apiKeyOverride: apiKey });
  let { client, models: modelFallbackList, provider } = activeConfig;
  let activeModel = modelFallbackList[0];

  onProgress({
    step: 'gemini_vision',
    message: `Analyzing full video frames with ${provider} (${activeModel}) to plan 5-second product shots...`,
    progress: 45
  });

  const totalDuration = videoMetadata?.duration || 60;
  const effectiveTitle = productTitle || videoMetadata?.title || 'Product Showcase Video';
  const effectiveDesc = productDescription || videoMetadata?.description || '';

  const systemPrompt = `You are an expert Short-Form Affiliate Video QC Director.
Evaluate the ${frames.length} sampled frames of the source video for the product: "${effectiveTitle}".

CRITERIA:
1. REJECT if:
   - Pure unboxing / parcel opening / bubble wrap with no actual product in action.
   - Talking heads / person just talking with no hands-on product demonstration.
   - Irrelevant video / wrong product / poor amateur quality.
   Output strict JSON:
   {"status": "reject", "reason": "<alasan penolakan singkat dalam bahasa Indonesia>"}

2. ACCEPT if:
   - There are active, clean product demonstrations (hands using the product, showing features/results, faceless/product-focused).
   - Select 4 to 7 frame indices (numbers 1 to ${frames.length}) showing the best distinct product demonstration moments (spaced at least 5 seconds apart).
   - Output strict minimal JSON:
   {"status": "accept", "frames": [4, 8, 12, 16, 20, 24], "productHook": "<hook pendek menarik dalam bahasa Indonesia>", "hasProductBrand": false}`;

  const userPrompt = `Product Title: "${effectiveTitle}"
${effectiveDesc ? `Product Description: "${effectiveDesc}"` : ''}
Total Duration: ${totalDuration}s
Sampled Frames:
${frames.map((f, i) => `#${i + 1} (${f.timeFormatted})`).join(', ')}

Review visual frames. Output strict minimal JSON:
If reject: {"status": "reject", "reason": "..."}
If accept: {"status": "accept", "frames": [indices], "productHook": "...", "hasProductBrand": false}`;

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
      message: `${provider} (${activeModel}) menganalisa ${frames.length} frame visual... (${elapsedSec} detik)`,
      progress: Math.min(58, 48 + Math.floor(elapsedSec / 4)),
    });
  }, 2000);

  const MAX_RETRIES = modelFallbackList.length;

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    activeModel = modelFallbackList[attempt];
    try {
      if (attempt > 0) {
        for (let t = 5; t > 0; t--) {
          onProgress({
            step: 'gemini_vision',
            message: `API overloaded/error. Switching to fallback model (${activeModel}) dalam ${t} detik...`,
            progress: 48,
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
        temperature: 0.3,
        max_tokens: 500,
      });

      clearInterval(heartbeat);

      const rawContent = response.choices?.[0]?.message?.content || '{}';
      console.log(`[AIService ${provider} ${activeModel}] Raw response:`, rawContent);
      let parsed = repairJson(rawContent);

      if (parsed.status === 'reject' || parsed.isProductMatch === false || parsed.isUsableSourceVideo === false) {
        const rejectionMsg = parsed.reason || parsed.rejectionReason || 'Video ditolak oleh AI: Tidak ada peragaan produk yang sesuai.';
        if (!allowFallbackClips) {
          throw new Error(rejectionMsg);
        }
        console.warn(`[AIService] AI flagged video: "${rejectionMsg}". Applying fallback clip plan...`);
      }

      const selectedIndices = Array.isArray(parsed.frames) ? parsed.frames : [];
      let candidateClips = [];

      if (selectedIndices.length > 0) {
        for (const rawIdx of selectedIndices) {
          const idx = parseInt(rawIdx, 10);
          if (isNaN(idx) || idx < 1 || idx > frames.length) continue;
          const frameObj = frames[idx - 1];
          const ts = frameObj ? frameObj.timestamp : (idx * (totalDuration / frames.length));
          const startSec = Math.max(0, Math.min(totalDuration - 5, Math.round(ts)));
          candidateClips.push({
            startSeconds: startSec,
            endSeconds: startSec + 5,
            startTime: formatSeconds(startSec),
            endTime: formatSeconds(startSec + 5),
            reason: `Frame #${idx} peragaan produk di detik ${formatSeconds(startSec)}`,
            isCleanAffiliateShot: true,
            hasProductBrand: Boolean(parsed.hasProductBrand),
            reframe: DEFAULT_REFRAME
          });
        }
      } else if (Array.isArray(parsed.clips) && parsed.clips.length > 0) {
        candidateClips = parsed.clips;
      }

      const hasProductBrand = Boolean(parsed.hasProductBrand);
      const detectedBrand = (parsed.detectedBrand || '').trim() || (hasProductBrand ? 'Brand Terdeteksi' : 'none');
      const allowHflip = hasProductBrand ? false : (parsed.allowHflip !== false);

      const clips = normalizeClipPlan(candidateClips, totalDuration, {
        allowFallback: allowFallbackClips,
        hasProductBrand,
        allowHflip,
      });
      const duration = clips.reduce((total, clip) => total + (clip.endSeconds - clip.startSeconds), 0);
      const startTime = clips[0].startTime;
      const endTime = clips[clips.length - 1].endTime;

      onProgress({
        step: 'gemini_vision',
        message: `${provider} (${activeModel}) selected ${clips.length} clean 5-second product shots (${duration}s total).`,
        progress: 55
      });

      return {
        startTime,
        endTime,
        startSeconds: clips[0].startSeconds,
        endSeconds: clips[clips.length - 1].endSeconds,
        duration,
        productHook: parsed.productHook || 'Racun Shopee Viral Wajib Punya!',
        hasProductBrand,
        detectedBrand,
        allowHflip,
        reframe: clips[0].reframe,
        clips,
      };
    } catch (err) {
      lastError = err;
      const status = err.status || err.statusCode;
      const msg = (err.message || '').toLowerCase();
      const isOverloaded = status === 429 || status === 503 || status === 529 || msg.includes('overload') || msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('429');

      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[AIService] AI model ${activeModel} failed (attempt ${attempt + 1}, status: ${status}, error: ${msg}). Trying next fallback model...`);
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
  trimmedFrames,
  videoMetadata,
  productTitle,
  productDescription,
  shopeeLink,
  productHook,
  segmentDuration = 45,
  onProgress = () => {}
}) {
  let activeConfig = getAiClientConfig({ apiKeyOverride: apiKey });
  let { client, models: modelFallbackList, provider } = activeConfig;
  let activeModel = modelFallbackList[0];

  onProgress({
    step: 'gpt_scripting',
    message: `Analyzing trimmed video frames with ${provider} (${activeModel}) for Kotak Scene & Ad Advisor Naskah...`,
    progress: 75
  });

  const effectiveTitle = (productTitle || '').trim() || videoMetadata?.title || 'Produk Viral Shopee';
  const effectiveDesc = (productDescription || '').trim();
  const targetDuration = Math.max(20, Math.min(35, Math.round(Number(segmentDuration) || 30)));
  const sceneCount = Math.round(targetDuration / 5);
  const targetWords = Math.round(targetDuration * 2.6);
  const minWords = Math.round(targetDuration * 2.3);
  const maxWords = Math.round(targetDuration * 2.8);

  const systemPrompt = `You are a Senior Creative Director and Ad Advisor specializing in Indonesian Short-Form Affiliate Video Marketing (TikTok Shop, Shopee Video, Instagram Reels).

You will receive the explicit Product Title, Product Description, and the sampled frames of a ${targetDuration}-second video clip. Use this precise product knowledge together with the visual frames to generate 5 high-converting marketing assets without making incorrect assumptions:

CRITICAL DURATION & WORD-COUNT TIMING RULES (MANDATORY):
- The final video duration is EXACTLY ${targetDuration} seconds (${sceneCount} scenes of 5 seconds each).
- In standard, engaging Indonesian voiceover tempo (2.5 - 2.8 words/second), the TOTAL voiceover script MUST contain between ${minWords} and ${maxWords} words (Target ideal: exactly ~${targetWords} words).
- DO NOT make the script too short (fewer than ${minWords} words)! A short script will leave dead silence or force the backend to unnaturally slow down audio playback.
- DO NOT make the script too long (more than ${maxWords} words)! A script that is too long will be cut off before the video finishes.
- Distribute narration evenly across scenes: For every 5-second scene beat, write approximately 12 to 14 words of spoken narration so the voiceover flows continuously from second 00:00 to second ${targetDuration}.

1. 'sampleContext':
   - 'productName': Explicit product name.
   - 'videoDuration': "${targetDuration} detik"
   - 'targetAudience': Specific target audience profile in Indonesia.
   - 'coreProblem': The primary pain point this product solves based on description & visual.
   - 'keyFeatures': List of 3-4 key USPs (Unique Selling Propositions).
   - 'buyingTrigger': Psychological trigger (FOMO, convenience, discount, viral trend).

2. 'scenes' (Kotak Scene / Scene-by-Scene Breakdown):
   - Break the ${targetDuration}-second video into EXACTLY ${sceneCount} scenes of 5 seconds each (Scene 1: 00:00 - 00:05, Scene 2: 00:05 - 00:10, ..., Scene ${sceneCount}).
   - Produce exactly ${sceneCount} scenes, each exactly 5 seconds long.
   - For each scene provide:
     * 'sceneNumber': integer (1, 2, 3... up to ${sceneCount})
     * 'timeRange': e.g. "00:00 - 00:05", "00:05 - 00:10", etc.
     * 'visualDescription': What is happening visually in Indonesian.
     * 'voiceover': The exact spoken narration line for this scene (around 12-14 words per 5-second scene).
     * 'adAdvisorNotes': Director notes for sound effects (SFX), visual text overlays, or emotional pacing.

3. 'voiceoverScript' (Naskah Voiceover Lengkap dengan Penanda Waktu & Tag Emosi):
   - A complete Indonesian spoken narration (${minWords} - ${maxWords} words total).
   - Use dynamic emotional tone & pacing tags so the AI voiceover (Fish Audio S2.1 Pro) sounds lively, expressive, and NEVER monotone:
     * [excited] for energetic hooks, surprise moments, and closing Call To Action.
     * [emphasis] to place strong vocal stress on key product features and instant benefits.
     * [soft] for empathetic problem statements.
     * [pause] for natural human breathing pauses between sentences.
   - Each line MUST start with an exact timestamp corresponding to each 5-second scene (e.g. [00:00], [00:05], [00:10], up to [${formatSeconds(targetDuration - 5)}]), followed by the emotion tag and spoken line, e.g.:
     [00:00] [excited] Wah, racun yang satu ini wajib banget kamu punya! [pause]
     [00:05] [soft] Masih sering capek marut kelapa atau keju pakai alat lama?
     [00:10] [emphasis] Pakai parutan serbaguna ini, [pause] hasilnya rapi dan praktis banget!
     ...
     [${formatSeconds(targetDuration - 5)}] [excited] Yuk, langsung checkout produk di bawah sekarang sebelum promo habis!

STRICT RULES FOR VOICE OVER & CALL TO ACTION:
- NEVER mention unboxing, opening packaging, bubble wrap, or cardboard boxes in the narration. Focus 100% on the product's practical features, active demonstration, and problem-solving benefits like a top pro affiliate creator.
- Write in natural, engaging conversational Indonesian.
- NEVER use the word "Shopee" in the voiceover script or scene spoken lines.
- NEVER say "link di bio" or "klik link di bio".
- ALWAYS use direct calls like "Cek produk di bawah sekarang", "Klik produk di bawah", "Checkout produk di bawah mumpung promo", or "Cek selengkapnya di bawah".
- INDONESIAN PHONETIC RULES FOR TTS ACCURACY:
  * For 'voiceoverScript', write accented 'é' on words with the 'e' taling sound (/e/ or /ɛ/) to ensure accurate TTS pronunciation: kéren, capék, cékout, lélé, soré, bésok, céwék, modél, désain.
  * Keep standard 'e' for pepet (/ə/) sounds, prefixes, and common words: pegel, meja, beres, segar, besar, tenang, beli, ke-, se-, me-, te-, pe-.

4. 'aiStudioPrompt':
   - A copy-paste ready text block formatted EXACTLY for Google AI Studio TTS Playground (Composer view).
   - It MUST follow this exact structure (with these exact section headers on separate lines):

Scene
[One sentence describing the setting/environment, e.g. "Studio dapur modern yang bersih dengan presenter Indonesia bersuara ramah dan energik."]

Sample Context
[One or two sentences describing tone, pacing, style of the ad, and voice over duration. ALWAYS start with the voice over duration matching the timestamp of the last spoken line, e.g. "Durasi voice over 30 detik. Iklan affiliate viral. Dimulai dengan hook yang menarik perhatian, membangun ke demonstrasi produk, diakhiri CTA yang meyakinkan. Nada suara hangat, antusias, dan persuasif."]

Speaker 1
[voiceover script with timestamps and emotion tags inline. Use emotional tone tags: [excited], [emphasis], [soft], [pause]. Every line starts with timestamp and emotion tag, e.g.
[00:00] [excited] Wah, racun yang satu ini wajib banget kamu punya! [pause]
[00:05] [soft] Masih sering capek marut kelapa atau keju pakai alat lama?
[00:10] [emphasis] Pakai parutan serbaguna ini, [pause] hasilnya rapi dan praktis banget!
...
[${formatSeconds(targetDuration - 5)}] [excited] Cek produk di bawah sekarang sebelum kehabisan!]

   - IMPORTANT: The output of 'aiStudioPrompt' must be a plain string (not JSON) ready to paste directly into AI Studio. Do NOT add any JSON object inside it.

5. 'caption':
   - High-converting Instagram & Facebook Reels caption with emojis, Indonesian hashtags (#racunbelanja, #racuntiktok, #reelsviral, #affiliateindonesia, etc.), and the provided affiliate link.

Output MUST be strictly valid JSON matching the requested schema.`;

  const userPrompt = `=== INFORMASI PRODUK UTAMA ===
Judul / Nama Produk: "${effectiveTitle}"
${effectiveDesc ? `Deskripsi & Spesifikasi Produk: "${effectiveDesc}"` : 'Deskripsi: (Analisis dari visual frame video)'}
Shopee Affiliate Link: ${shopeeLink || 'https://shope.ee/link'}
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
5. JANGAN PERNAH gunakan kata "Shopee" dalam naskah voiceover maupun Kotak Scene.
6. JANGAN PERNAH gunakan kata "link di bio".
7. Selalu gunakan ajakan seperti "Cek produk di bawah sekarang", "Klik produk di bawah", atau "Checkout produk di bawah sebelum kehabisan".
8. ATURAN FONETIK TTS: Tuliskan huruf 'é' pada kata yang berbunyi taling (/e/ atau /ɛ/) seperti kéren, capék, cékout, bésok, soré, modél. Kata berbunyi pepet atau yang sudah fasih (/ə/) seperti pegel, meja, beres, segar, besar, ke- TETAP gunakan e biasa.

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
  "caption": "Teks caption lengkap dengan link pembelian dan hashtag..."
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

  const MAX_RETRIES = modelFallbackList.length;

  let parsed = {};
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    activeModel = modelFallbackList[attempt];
    try {
      if (attempt > 0) {
        for (let t = 5; t > 0; t--) {
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
      const isOverloaded = status === 429 || status === 503 || status === 529 || msg.includes('overload') || msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('429');

      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[AIService Scripting] AI model ${activeModel} failed (attempt ${attempt + 1}, status: ${status}, error: ${msg}). Trying next fallback model...`);
        continue;
      }

      clearInterval(heartbeat);
      console.error(`[AIService ${provider} ${activeModel} Scripting] Error:`, err);
      throw new Error(formatApiError(err, activeModel, provider));
    }
  }

  if (lastError && !parsed.sampleContext && !parsed.scenes) {
    clearInterval(heartbeat);
    throw new Error(formatApiError(lastError, activeModel, provider));
  }

  const scenes = normalizeShortScenes(parsed.scenes, effectiveTitle, segmentDuration);

  let voiceoverScript = (parsed.voiceoverScript || '').trim();
  if (!voiceoverScript && scenes.length > 0) {
    voiceoverScript = scenes.map(s => `[${s.timeRange ? s.timeRange.split(' - ')[0] : '00:00'}] ${s.voiceover}`).join('\n');
  }
  if (!voiceoverScript) {
    voiceoverScript = `[HOOK]\nStop scroll! ${effectiveTitle} yang satu ini bener-bener lagi viral dan wajib banget kamu punya!\n\n[DEMO & BENEFIT]\n${effectiveDesc ? effectiveDesc.slice(0, 100) : 'Kualitasnya kokoh, desainnya elegan, dan praktis banget buat dipakai sehari-hari tanpa ribet.'}\n\n[VALUE PROPOSITION]\nUdah banyak yang review bagus dan terbukti awet buat jangka panjang.\n\n[CALL TO ACTION]\nMumpung lagi ada promo dan diskon spesial, buruan cek produk di bawah sekarang sebelum kehabisan!`;
  }

  let caption = (parsed.caption || '').trim();
  if (!caption) {
    caption = `🔥 Racun Belanja Viral: ${effectiveTitle}!\n\n${effectiveDesc ? effectiveDesc + '\n\n' : ''}Buruan checkout sekarang mumpung lagi diskon spesial!\n\n🛒 Link Produk: ${shopeeLink || 'https://shope.ee/link-disini'}\n\n#racunbelanja #racuntiktok #reelsviral #affiliateindonesia #spillracun`;
  } else if (shopeeLink && !caption.includes(shopeeLink)) {
    caption += `\n\n🛒 Link Produk: ${shopeeLink}`;
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

  return {
    focusX,
    focusY,
    renderMode: reframe.renderMode === 'vertical_crop' ? 'vertical_crop' : 'preserve_full_product',
    cropStrategy: (reframe.cropStrategy || DEFAULT_REFRAME.cropStrategy).toString().slice(0, 80),
    avoidTextZones,
    avoidFaceZones,
    faceSafety: reframe.faceSafety !== false,
    allowHflip: reframe.allowHflip !== false,
    hasProductBrand: Boolean(reframe.hasProductBrand),
    notes: (reframe.notes || DEFAULT_REFRAME.notes).toString().slice(0, 180),
  };
}

function normalizeClipPlan(rawClips, totalDuration, { allowFallback = true, frameAudit = [], hasProductBrand = false, allowHflip = true } = {}) {
  const clipLength = 5;
  const sourceClips = Array.isArray(rawClips) ? rawClips : [];
  const normalized = [];
  let previousEnd = -1;

  console.log(`[normalizeClipPlan] totalDuration=${totalDuration}s, rawClips=${sourceClips.length}, frameAudit=${frameAudit.length}, hasProductBrand=${hasProductBrand}, allowHflip=${allowHflip}`);

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
    if (normalized.length === 7) break; // Target max 7 clips (35s)
  }

  console.log(`[normalizeClipPlan] Accepted ${normalized.length} valid clips from AI vision`);

  if (normalized.length >= 4) {
    return normalized;
  }

  if (!allowFallback) {
    throw new Error('AI menolak video ini: tidak ditemukan minimal 4 potongan video bersih (20 detik) dari watermark, subtitle terjemahan, nama channel mengambang, wajah, atau proses unboxing.');
  }

  // Fallback: build 4 to 7 evenly spaced clips (20 to 35 seconds total, exactly 5s per clip)
  console.log(`[normalizeClipPlan] Building 20-35s fallback clip plan for ${totalDuration}s video`);
  const fallbackClips = [];
  const fallbackTargetClips = Math.min(7, Math.max(4, Math.floor(totalDuration / clipLength)));
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
      startTime: formatSeconds(startSeconds),
      endTime: formatSeconds(startSeconds + clipLength),
      reason: 'Fallback 5-second product shot.',
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
    throw new Error('Video terlalu pendek untuk membuat potongan produk utama 5 detik (minimal 20 detik).');
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

function buildFallbackScenes(productName, segmentDuration) {
  const totalDuration = Math.max(20, Math.min(35, Math.round(Number(segmentDuration) || 30)));
  const sceneLength = 5;
  const sceneCount = Math.round(totalDuration / sceneLength);
  const sceneTemplates = [
    {
      visualDescription: `Close-up produk ${productName} sebagai hook awal.`,
      voiceover: `${productName} ini bikin penasaran dari awal.`,
      adAdvisorNotes: 'Mulai dengan cut cepat dan teks hook singkat.'
    },
    {
      visualDescription: 'Produk ditunjukkan dari jarak dekat.',
      voiceover: 'Desainnya ringkas dan kelihatan premium.',
      adAdvisorNotes: 'Sorot detail produk, hindari wajah creator.'
    },
    {
      visualDescription: 'Tangan mulai mendemonstrasikan cara pakai produk.',
      voiceover: 'Cara pakainya gampang banget.',
      adAdvisorNotes: 'Pakai zoom ringan ke bagian produk yang bergerak.'
    },
    {
      visualDescription: 'Fitur utama produk terlihat saat digunakan.',
      voiceover: 'Fungsinya langsung terasa praktis.',
      adAdvisorNotes: 'Tambahkan SFX ringan pada momen demo.'
    },
    {
      visualDescription: 'Hasil penggunaan produk diperlihatkan jelas.',
      voiceover: 'Hasilnya rapi dan cocok buat harian.',
      adAdvisorNotes: 'Tahan visual hasil sebentar agar mudah dipahami.'
    },
    {
      visualDescription: 'Produk kembali ditampilkan sebagai hero shot.',
      voiceover: 'Ini tipe produk yang kepake terus.',
      adAdvisorNotes: 'Gunakan cut pendek agar ritme tetap cepat.'
    },
    {
      visualDescription: 'Detail material atau bagian penting produk disorot.',
      voiceover: 'Detailnya juga terasa lebih niat.',
      adAdvisorNotes: 'Fokus pada tekstur, bentuk, atau mekanisme.'
    },
    {
      visualDescription: 'Produk ditunjukkan dalam konteks pemakaian sehari-hari.',
      voiceover: 'Buat kebutuhan rumah, ini membantu banget.',
      adAdvisorNotes: 'Jaga framing tetap produk dan tangan.'
    },
    {
      visualDescription: 'Produk ditampilkan dengan angle penutup.',
      voiceover: 'Cek produknya di bawah sebelum kehabisan.',
      adAdvisorNotes: 'Akhiri dengan CTA singkat dan jelas.'
    },
  ];

  return Array.from({ length: sceneCount }, (_, index) => {
    const start = index * sceneLength;
    const end = Math.min(totalDuration, start + sceneLength);
    const template = sceneTemplates[Math.min(index, sceneTemplates.length - 1)];

    return {
      sceneNumber: index + 1,
      timeRange: `${formatSeconds(start)} - ${formatSeconds(end)}`,
      ...template,
    };
  });
}

function normalizeShortScenes(scenes, productName, segmentDuration) {
  const fallbackScenes = buildFallbackScenes(productName, segmentDuration);
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
