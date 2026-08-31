import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

function getEffectiveModel() {
  const envModel = (process.env.AIVENE_MODEL || process.env.AIVENE_GEMINI_MODEL || '').trim();
  if (!envModel || envModel === 'gemini-3.7-flash' || envModel === 'gemini-2.5-flash') {
    return 'qwen3.8-flash';
  }
  return envModel;
}

const AIVENE_MODEL = getEffectiveModel();
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
 * Helper to format Aivene / OpenAI API errors into clear Indonesian messages.
 */
function formatApiError(err, modelName = 'AI') {
  const status = err.status || err.statusCode;
  const message = err.message || '';

  if (status === 402 || message.toLowerCase().includes('insufficient') || message.toLowerCase().includes('balance') || message.toLowerCase().includes('quota') || message.toLowerCase().includes('credit')) {
    return `Saldo / Kuota Aivene API Anda tidak mencukupi (Insufficient Credits/Balance). Silakan periksa atau isi ulang saldo akun Aivene Anda di https://aivene.com.`;
  }
  if (status === 401 || message.toLowerCase().includes('invalid api key') || message.toLowerCase().includes('unauthorized')) {
    return `Aivene API Key tidak valid atau tidak memiliki izin akses. Silakan periksa kembali API Key Anda.`;
  }
  if (status === 429 || message.toLowerCase().includes('rate limit')) {
    return `Batas frekuensi permintaan (Rate Limit) Aivene tercapai. Silakan tunggu beberapa saat dan coba lagi.`;
  }
  if (status === 404 || message.toLowerCase().includes('model_not_found') || message.toLowerCase().includes('does not exist')) {
    return `Model '${modelName}' tidak tersedia di akun Aivene Anda.`;
  }
  return `Aivene API Error (${modelName}): ${message}`;
}

/**
 * Stage 1, Step A: Calls Aivene API with vision
 * to analyze the full video timeline and select a cut plan made of 5-second product shots.
 */
export async function selectHighlightWithGeminiFlash({
  apiKey,
  frames,
  videoMetadata,
  productTitle,
  productDescription,
  shopeeLink,
  allowFallbackClips = false,
  onProgress = () => {}
}) {
  onProgress({
    step: 'gemini_vision',
    message: `Analyzing full video frames with ${AIVENE_MODEL} to plan 5-second product shots...`,
    progress: 45
  });

  const effectiveApiKey = apiKey || process.env.AIVENE_API_KEY;
  if (!effectiveApiKey) {
    throw new Error('Aivene API Key tidak ditemukan. Pastikan AIVENE_API_KEY sudah disetel di file server/.env.');
  }

  const client = new OpenAI({
    apiKey: effectiveApiKey,
    baseURL: 'https://api.aivene.com/v1',
    timeout: 120000,
  });

  const totalDuration = videoMetadata?.duration || 60;
  const effectiveTitle = productTitle || videoMetadata?.title || 'Product Showcase Video';
  const effectiveDesc = productDescription || videoMetadata?.description || '';

  const systemPrompt = `You are a Strict Senior Video Curator, Quality Control Director & Vision OCR Inspector for Affiliate Product Ads.
Your mission: Inspect video timeline frames and approve ONLY high-quality product footage filmed by EXPERIENCED / PROFESSIONAL CREATORS.

FOUR MANDATORY QUALITY CRITERIA FOR EXPERIENCED CREATOR FOOTAGE:

1. PROPER PRODUCT FRAMING & CENTERING (TIDAK TERPOTONG & CENTER):
   - The product must be properly framed in the center, clearly visible, and NOT cut off by poor amateur camera angles or bad framing.
   - The camera shot must be steady, well-lit, and sharply focused on the product.
   - If the creator filmed the product poorly (e.g. product cut off at edge of camera, missing from frame, shaky, blurry, or amateur composition), mark "isWellFramed": false and DO NOT select that interval.

2. ACTIVE PRODUCT DEMONSTRATION (PERAGAAN NYATA):
   - The footage MUST show ACTIVE DEMONSTRATION of the product in use:
     * Hands unboxing, assembling, or preparing the product.
     * Hands operating buttons, switches, knobs, or mechanisms.
     * Practical real-life demonstration (e.g. cutting vegetables with chopper, cooking in pan, spraying, cleaning with mop, using gadget).
     * Clear showcase of the practical results and benefits.
   - Reject boring, static, motionless product shots where nothing is being demonstrated.

3. STRICT ZERO TOLERANCE ON FLOATING SUBTITLES & WATERMARKS (BEBAS SUBTITLE):
   - UNWANTED FLOATING OVERLAYS (REJECT/EXCLUDE):
     * Hardcoded subtitles, captions, or translation text (e.g. Indonesian subtitles like "SANGAT BAGUS", auto-captions, CapCut/TikTok floating text).
     * Watermarks, channel handles (e.g. "@creator123", TikTok logo, YouTube channel badge floating in corner).
     * Floating stickers, discount badges, or arrows overlaid by video editors.
     * RULE: If a frame contains ANY floating subtitle, caption, watermark, or channel overlay, mark "hasFloatingOverlay": true, "isCleanProductShot": false. NEVER select this interval!
   - PHYSICAL PRODUCT BRAND & LABELS (100% CLEAN & VALID - WELCOME!):
     * Brand logo or text physically printed ON THE PRODUCT ITSELF (e.g. "PHILIPS", "XIAOMI", "BOLDe", buttons like "On/Off", "Max").
     * Text printed on the physical product packaging/box or label.
     * RULE: This is NATURAL physical product footage. Mark "hasPhysicalBrandText": true and "isCleanProductShot": true. This is 100% CLEAN. Set "allowHflip": false so the brand text won't appear backwards.

4. FACELESS / HANDS-ONLY (NO TALKING HEADS):
   - Only faceless close-ups and hands demonstrating the product. Strictly no human faces.

REJECTION MANDATE:
- If the video is from an amateur creator (product cut off/out of frame, no clear demonstration, blurry, or polluted with floating subtitles/watermarks), REJECT the video ("isUsableSourceVideo": false) with a clear rejectionReason so the system can switch to a better candidate video.`;

  const userPrompt = `Product Title: "${effectiveTitle}"
${effectiveDesc ? `Product Description / Key Features: "${effectiveDesc}"` : ''}
Video Title: "${videoMetadata?.title || effectiveTitle}"
Total Video Duration: ${totalDuration} seconds (${formatSeconds(totalDuration)})
Product Link: ${shopeeLink || 'https://shope.ee/link'}

Sampled Visual Frames (${frames.length} frames across timeline):
${frames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

INSPECTION & QUALITY CONTROL STEPS:
1. Identify if the video is from an experienced creator with proper centering and active hands-on demonstration.
2. Identify any floating video subtitles / watermarks / channel names (Category 1: Reject) vs physical text on the product (Category 2: 100% Clean Product Shot).
3. In "frameAudit", list every frame:
   - "isWellFramed": true if the product is properly centered and not cut off by the creator's camera angle.
   - "hasActiveDemonstration": true if hands are actively demonstrating/operating/testing the product.
   - "hasFloatingOverlay": true ONLY if floating subtitles/watermarks/channel names exist.
   - "hasPhysicalBrandText": true if brand/text is printed on the physical product/box.
   - "isCleanProductShot": true if well-framed, free of floating subtitles/watermarks/faces.
4. If the product has a visible brand/logo on it, set "hasProductBrand": true, "detectedBrand": "<BrandName>", "allowHflip": false.
5. Select 6 to 8 clean 5-second intervals of active product demonstration with centered framing.

Return strict JSON in this format:
{
  "isProductMatch": true,
  "isUsableSourceVideo": true,
  "isExperiencedCreatorQuality": true,
  "rejectionReason": "",
  "hasProductBrand": false,
  "detectedBrand": "none",
  "allowHflip": true,
  "frameAudit": [
    {
      "frameIndex": 1,
      "timestamp": "00:00",
      "isWellFramed": true,
      "hasActiveDemonstration": true,
      "hasFloatingOverlay": false,
      "detectedFloatingOverlay": "none",
      "hasPhysicalBrandText": false,
      "detectedPhysicalBrand": "none",
      "hasFace": false,
      "isCleanProductShot": true
    }
  ],
  "productHook": "Racun Shopee Viral Wajib Punya!",
  "clips": [
    {
      "startTime": "00:05",
      "endTime": "00:10",
      "startSeconds": 5,
      "reason": "Clean hands-on demonstration with centered product framing, free of floating subtitles or faces.",
      "hasProductBrand": false,
      "allowHflip": true,
      "isCleanAffiliateShot": true,
      "sourceOwnerIdentityVisible": false,
      "sourceIdentityRisk": "none",
      "reframe": {
        "focusX": 0.5,
        "focusY": 0.55,
        "renderMode": "preserve_full_product",
        "cropStrategy": "keep_full_product_no_floating_text_no_face",
        "avoidTextZones": [],
        "avoidFaceZones": ["top_left"],
        "faceSafety": true,
        "allowHflip": true,
        "notes": "Centered hands-on product demonstration."
      }
    }
  ]
}`;

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
      message: `AI (${AIVENE_MODEL}) menganalisa ${frames.length} frame visual... (${elapsedSec} detik)`,
      progress: Math.min(58, 48 + Math.floor(elapsedSec / 4)),
    });
  }, 2000);

  const MAX_RETRIES = 3;
  const RETRY_DELAYS_MS = [12000, 20000, 30000];

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const waitSec = RETRY_DELAYS_MS[attempt - 1] / 1000;
        for (let t = waitSec; t > 0; t--) {
          onProgress({
            step: 'gemini_vision',
            message: `API AI overloaded. Retry ke-${attempt}/${MAX_RETRIES} dalam ${t} detik...`,
            progress: 48,
          });
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      const response = await client.chat.completions.create({
        model: AIVENE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: messageContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      clearInterval(heartbeat);

      const rawContent = response.choices?.[0]?.message?.content || '{}';
      console.log(`[AIService ${AIVENE_MODEL}] Raw response:`, rawContent);
      let parsed;
      try {
        parsed = JSON.parse(rawContent);
      } catch (e) {
        const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      }

      const hasProductBrand = parsed.hasProductBrand === true ||
        (Boolean(parsed.detectedBrand) && parsed.detectedBrand.toLowerCase() !== 'none' && parsed.detectedBrand.toLowerCase() !== 'null' && parsed.detectedBrand.toLowerCase() !== 'false') ||
        (Array.isArray(parsed.clips) && parsed.clips.some(c => c.hasProductBrand === true || c.hasPhysicalBrandText === true)) ||
        (Array.isArray(parsed.frameAudit) && parsed.frameAudit.some(f => f.hasPhysicalBrandText === true || (f.detectedPhysicalBrand && f.detectedPhysicalBrand.toLowerCase() !== 'none')));
      const detectedBrand = (parsed.detectedBrand || parsed.detectedBrandName || '').trim() || (hasProductBrand ? 'Brand Terdeteksi' : 'none');
      const allowHflip = hasProductBrand ? false : (parsed.allowHflip !== false);

      if (parsed.isProductMatch === false || parsed.isUsableSourceVideo === false) {
        const rejectionMsg = (parsed.rejectionReason || '').toLowerCase();
        // If AI mistakenly rejected because of physical brand/product text, do not fail
        const isFalseBrandRejection = rejectionMsg.includes('brand') || rejectionMsg.includes('merk') || rejectionMsg.includes('merek') || rejectionMsg.includes('tulisan produk') || rejectionMsg.includes('label produk');
        if (!allowFallbackClips && !isFalseBrandRejection) {
          throw new Error(parsed.rejectionReason || 'Video YouTube ditolak oleh AI: Mengandung teks subtitle terjemahan, watermark, atau wajah yang tidak dapat dihilangkan.');
        }
        console.warn(`[AIService] AI flagged video: "${parsed.rejectionReason}". Applying fallback clip plan...`);
        parsed.clips = [];
      }

      const clips = normalizeClipPlan(parsed.clips, totalDuration, {
        allowFallback: allowFallbackClips,
        frameAudit: parsed.frameAudit || [],
        hasProductBrand,
        allowHflip,
      });
      const duration = clips.reduce((total, clip) => total + (clip.endSeconds - clip.startSeconds), 0);
      const startTime = clips[0].startTime;
      const endTime = clips[clips.length - 1].endTime;

      onProgress({
        step: 'gemini_vision',
        message: `${AIVENE_MODEL} selected ${clips.length} clean 5-second product shots (${duration}s total).`,
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
      const isOverloaded = status === 503 || status === 529 || msg.includes('overload') || msg.includes('overloaded');

      if (isOverloaded && attempt < MAX_RETRIES) {
        console.warn(`[AIService] AI overloaded (attempt ${attempt + 1}). Will retry...`);
        continue;
      }

      clearInterval(heartbeat);
      console.error(`[AIService ${AIVENE_MODEL}] Error:`, err);
      throw new Error(formatApiError(err, AIVENE_MODEL));
    }
  }

  clearInterval(heartbeat);
  throw new Error(formatApiError(lastError, AIVENE_MODEL));
}

/**
 * Stage 1, Step B: Calls Aivene API
 * using explicit user provided Product Title and Product Description to generate:
 * - Kotak Scene (Scene Breakdown)
 * - Sample Context (USPs, Target Audience, Core Problem)
 * - Naskah Voiceover (Ad Advisor Standard in Indonesian)
 * - Google AI Studio Prompt Template
 * - Reels Caption & Hashtags
 */
export async function generateAdAdvisorScriptWithGemini({
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
  onProgress({
    step: 'gpt_scripting',
    message: `Analyzing trimmed video frames with ${AIVENE_MODEL} for Kotak Scene & Ad Advisor Naskah...`,
    progress: 75
  });

  const effectiveApiKey = apiKey || process.env.AIVENE_API_KEY;
  if (!effectiveApiKey) {
    throw new Error('Aivene API Key tidak ditemukan. Pastikan AIVENE_API_KEY sudah disetel di file server/.env.');
  }

  const client = new OpenAI({
    apiKey: effectiveApiKey,
    baseURL: 'https://api.aivene.com/v1',
    timeout: 120000,
  });

  const effectiveTitle = (productTitle || '').trim() || videoMetadata?.title || 'Produk Viral Shopee';
  const effectiveDesc = (productDescription || '').trim();
  const targetDuration = Math.max(30, Math.min(40, Math.round(Number(segmentDuration) || 35)));
  const targetWords = Math.round(targetDuration * 2.6);
  const minWords = Math.round(targetDuration * 2.3);
  const maxWords = Math.round(targetDuration * 2.8);

  const systemPrompt = `You are a Senior Creative Director and Ad Advisor specializing in Indonesian Short-Form Affiliate Video Marketing (TikTok Shop, Shopee Video, Instagram Reels).

You will receive the explicit Product Title, Product Description, and the sampled frames of a ${targetDuration}-second video clip. Use this precise product knowledge together with the visual frames to generate 5 high-converting marketing assets without making incorrect assumptions:

CRITICAL DURATION & WORD-COUNT TIMING RULES (MANDATORY):
- The final video duration is EXACTLY ${targetDuration} seconds.
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
   - Break the ${targetDuration}-second video into short editing beats of 4 to 5 seconds each.
   - Produce enough scenes to cover the full clip duration, usually ${Math.ceil(targetDuration / 5)} to ${Math.ceil(targetDuration / 4)} scenes.
   - No single scene may be longer than 5 seconds unless it is the final leftover scene.
   - For each scene provide:
     * 'sceneNumber': integer (1, 2, 3...)
     * 'timeRange': e.g. "00:00 - 00:05"
     * 'visualDescription': What is happening visually in Indonesian.
     * 'voiceover': The exact spoken narration line for this scene (around 12-14 words per 5-second scene).
     * 'adAdvisorNotes': Director notes for sound effects (SFX), visual text overlays, or emotional pacing.

3. 'voiceoverScript' (Naskah Voiceover Lengkap dengan Penanda Waktu):
   - A complete Indonesian spoken narration (${minWords} - ${maxWords} words total).
   - Each line MUST start with an exact timestamp corresponding to the video timeline (e.g. [00:00], [00:05], [00:10], [00:15], [00:20], [00:25], [00:30], [00:35]), followed by the spoken line, e.g.:
     [00:00] Masih repot marut keju atau kelapa pakai alat lama?
     [00:05] Kenalin, Parutan Serbaguna Stainless super praktis ini!
     ...
     [00:30] Cek produk di bawah sekarang sebelum kehabisan promo spesialnya!

STRICT RULES FOR VOICE OVER & CALL TO ACTION:
- NEVER use the word "Shopee" in the voiceover script or scene spoken lines.
- NEVER say "link di bio" or "klik link di bio".
- ALWAYS use direct calls like "Cek produk di bawah sekarang", "Klik produk di bawah", "Checkout produk di bawah mumpung promo", or "Cek selengkapnya di bawah".

4. 'aiStudioPrompt':
   - A copy-paste ready text block formatted EXACTLY for Google AI Studio TTS Playground (Composer view).
   - It MUST follow this exact structure (with these exact section headers on separate lines):

Scene
[One sentence describing the setting/environment, e.g. "Studio dapur modern yang bersih dengan presenter Indonesia bersuara ramah dan energik."]

Sample Context
[One or two sentences describing tone, pacing, style of the ad, and voice over duration. ALWAYS start with the voice over duration matching the timestamp of the last spoken line, e.g. "Durasi voice over 30 detik. Iklan affiliate viral. Dimulai dengan hook yang menarik perhatian, membangun ke demonstrasi produk, diakhiri CTA yang meyakinkan. Nada suara hangat, antusias, dan persuasif."]

Speaker 1
[voiceover script with timestamps and emotion tags inline. Use ONLY these emotion tags: [intrigue] [desire] [information] [excited] [inspiration] [confident]. Every line starts with timestamp and emotion tag, e.g.
[00:00] [intrigue] Masih repot marut keju atau kelapa pakai alat lama?
[00:05] [excited] Kenalin, Parutan Serbaguna Stainless super praktis ini!
...
[00:30] [excited] Cek produk di bawah sekarang sebelum kehabisan!]

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
      message: `AI (${AIVENE_MODEL}) menyusun Kotak Scene & Naskah Ad Advisor... (${elapsedSec} detik)`,
      progress: Math.min(88, 78 + Math.floor(elapsedSec / 4)),
    });
  }, 2000);

  const MAX_RETRIES = 3;
  const RETRY_DELAYS_MS = [12000, 20000, 30000];

  let parsed = {};
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const waitSec = RETRY_DELAYS_MS[attempt - 1] / 1000;
        for (let t = waitSec; t > 0; t--) {
          onProgress({
            step: 'gpt_scripting',
            message: `API AI overloaded. Retry naskah ke-${attempt}/${MAX_RETRIES} dalam ${t} detik...`,
            progress: 78,
          });
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      const response = await client.chat.completions.create({
        model: AIVENE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: messageContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      clearInterval(heartbeat);

      const rawContent = response.choices?.[0]?.message?.content || '{}';
      console.log(`[AIService ${AIVENE_MODEL} Scripting] Raw response:`, rawContent);
      try {
        parsed = JSON.parse(rawContent);
      } catch (e) {
        const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      }

      break; // success — exit retry loop
    } catch (err) {
      lastError = err;
      const status = err.status || err.statusCode;
      const msg = (err.message || '').toLowerCase();
      const isOverloaded = status === 503 || status === 529 || msg.includes('overload') || msg.includes('overloaded');

      if (isOverloaded && attempt < MAX_RETRIES) {
        console.warn(`[AIService Scripting] AI overloaded (attempt ${attempt + 1}). Will retry...`);
        continue;
      }

      clearInterval(heartbeat);
      console.error(`[AIService ${AIVENE_MODEL} Scripting] Error:`, err);
      throw new Error(formatApiError(err, AIVENE_MODEL));
    }
  }

  if (lastError && !parsed.sampleContext) {
    clearInterval(heartbeat);
    throw new Error(formatApiError(lastError, AIVENE_MODEL));
  }

  let voiceoverScript = (parsed.voiceoverScript || '').trim();
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
    message: `${AIVENE_MODEL} generated Kotak Scene, Sample Context, and Naskah successfully!`,
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
    scenes: normalizeShortScenes(parsed.scenes, effectiveTitle, segmentDuration),
    voiceoverScript,
    aiStudioPrompt,
    caption,
  };
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

      if (hasFloatingOverlay || isLegacySubtitle || hasFace || isPoorlyFramed) {
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

    const endSeconds = startSeconds + clipLength;

    // Discard any clip interval that covers dirty frames containing floating text/subtitles/watermarks
    const overlapsDirtyFrame = dirtyTimestamps.some(ts => ts >= startSeconds && ts <= endSeconds);
    if (overlapsDirtyFrame) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}-${endSeconds}s: overlaps frame with detected subtitle/watermark`);
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
    if (normalized.length === 8) break; // Target max 8 clips (40s)
  }

  console.log(`[normalizeClipPlan] Accepted ${normalized.length} valid clips from AI vision`);

  if (normalized.length >= 2) {
    return normalized;
  }

  if (!allowFallback) {
    throw new Error('AI menolak video ini: tidak ditemukan potongan video yang bersih dari watermark, subtitle terjemahan, nama channel mengambang, atau wajah/talking head.');
  }

  // Fallback: build 6 to 8 evenly spaced clips (30 to 40 seconds total)
  console.log(`[normalizeClipPlan] Building 30-40s fallback clip plan for ${totalDuration}s video`);
  const fallbackClips = [];
  const fallbackTargetClips = Math.min(8, Math.max(6, Math.floor(totalDuration / clipLength)));
  const maxStart = Math.max(0, Math.floor(totalDuration - clipLength));
  const fallbackStart = totalDuration > 30
    ? Math.min(maxStart, Math.max(5, Math.floor(totalDuration * 0.06)))
    : 0;
  const fallbackLastStart = totalDuration > 35
    ? Math.max(fallbackStart, Math.min(maxStart, Math.floor(totalDuration * 0.92) - clipLength))
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
    throw new Error('Video terlalu pendek untuk membuat potongan produk utama 5 detik.');
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
  const totalDuration = Math.max(5, Math.round(Number(segmentDuration) || 45));
  const sceneLength = 5;
  const sceneCount = Math.ceil(totalDuration / sceneLength);
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
