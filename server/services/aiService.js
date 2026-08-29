import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const AIVENE_MODEL = process.env.AIVENE_MODEL || process.env.AIVENE_GEMINI_MODEL || 'gpt-4o-mini';
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
  allowFallbackClips = true,
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

  const systemPrompt = `You are a Strict, World-Class Short-Form Video Editor & Viral Affiliate Content Producer.
Your task is to analyze the source-video timeline frames and select ONLY pristine, 100% clean 5-second product demo clips suitable for high-converting Indonesian Shopee affiliate ads.

CRITICAL QUALITY & REJECTION RULES:
1. PRODUCT RELEVANCE: Ensure the video visually features the specific product or its exact category. If completely unrelated, reject with isProductMatch=false, isUsableSourceVideo=false.
2. ZERO-TOLERANCE ON SUBTITLES & TEXT OVERLAYS:
   - REJECT any clip/frame containing burned-in subtitles, captions, lyrics, narrative text, discount banners, price tags, or promo graphics.
3. ZERO-TOLERANCE ON WATERMARKS & BRAND LOGOS:
   - REJECT any clip/frame containing creator watermarks, TikTok/IG handles (@username), channel logos, or intrusive brand overlays.
4. FACELESS / PRODUCT-CENTRIC:
   - Prioritize hands-only demonstration, unboxing, product features, and practical usage.
   - Avoid frames where a creator's face or talking head dominates the screen.
5. REJECTION THRESHOLD:
   - If the entire video is covered in subtitles, watermarks, or talking heads with NO clean product demonstration moments, set "isUsableSourceVideo": false, "rejectionReason": "Video penuh teks / subtitle / watermark brand.", and return an empty clips array.
6. RETURN 2 TO 8 CLEAN 5-SECOND CLIPS:
   - Each selected clip MUST be exactly 5 seconds long (e.g. 00:05 to 00:10, 00:20 to 00:25) from the cleanest timestamps.
   - Total duration: 10 to 40 seconds.`;

  const userPrompt = `Product Title: "${effectiveTitle}"
${effectiveDesc ? `Product Description / Key Features: "${effectiveDesc}"` : ''}
Video Title: "${videoMetadata?.title || effectiveTitle}"
Total Video Duration: ${totalDuration} seconds (${formatSeconds(totalDuration)})
Product Link: ${shopeeLink || 'https://shope.ee/link'}

Sampled Visual Frames (${frames.length} frames across timeline):
${frames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

INSPECTION INSTRUCTION:
Examine each frame carefully:
1. Check for burned-in subtitles, captions, Indonesian/foreign text overlays.
2. Check for watermarks, channel logos, brand logos, or @usernames.
3. Check for creator faces / talking heads.
4. Select ONLY the clean 5-second product demo intervals where no intrusive text or watermarks are present.
5. If the video does NOT contain at least 2 clean product-focused clips, REJECT it by setting "isUsableSourceVideo": false with the specific rejectionReason.

Return strict JSON in this format:
{
  "isProductMatch": true,
  "isUsableSourceVideo": true,
  "rejectionReason": "",
  "productHook": "Racun Shopee Viral Wajib Punya!",
  "clips": [
    {
      "startTime": "00:10",
      "endTime": "00:15",
      "startSeconds": 10,
      "reason": "Clean hands-only product demonstration without text, watermarks, or face.",
      "isCleanAffiliateShot": true,
      "sourceOwnerIdentityVisible": false,
      "sourceIdentityRisk": "none",
      "reframe": {
        "focusX": 0.5,
        "focusY": 0.55,
        "renderMode": "preserve_full_product",
        "cropStrategy": "keep_full_product_no_text_no_stickers_no_face",
        "avoidTextZones": [],
        "avoidFaceZones": ["top_left"],
        "faceSafety": true,
        "notes": "Clean product-only demonstration."
      }
    }
  ]
}`;

  const messageContent = [
    { type: 'text', text: userPrompt },
    ...frames.map((f) => ({
      type: 'image_url',
      image_url: { url: f.base64 },
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
        temperature: 0.5,
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

      if (parsed.isProductMatch === false || parsed.isUsableSourceVideo === false) {
        if (!allowFallbackClips) {
          throw new Error(parsed.rejectionReason || 'Video YouTube tidak cocok atau tidak bersih untuk produk ini.');
        }
        // When fallback is allowed, log the AI's rejection reason but still try fallback clips
        console.warn(`[AIService] AI flagged video as unclean: "${parsed.rejectionReason}". Applying fallback clip plan...`);
        parsed.clips = [];
      }

      const clips = normalizeClipPlan(parsed.clips, totalDuration, { allowFallback: allowFallbackClips });
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
  const targetDuration = Math.max(15, Math.round(Number(segmentDuration) || 45));
  const targetWords = Math.round(targetDuration * 2.6);
  const minWords = Math.round(targetDuration * 2.4);
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
   - Each line MUST start with an exact timestamp corresponding to the video timeline (e.g. [00:00], [00:05], [00:10], [00:15], [00:20], [00:25]), followed by the spoken line, e.g.:
     [00:00] Masih repot marut keju atau kelapa pakai alat lama?
     [00:05] Kenalin, Parutan Serbaguna Stainless super praktis ini!
     ...
     [00:25] Cek produk di bawah sekarang sebelum kehabisan promo spesialnya!

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
[One or two sentences describing tone, pacing, and style of the ad. e.g. "Iklan affiliate viral. Dimulai dengan hook yang menarik perhatian, membangun ke demonstrasi produk, diakhiri CTA yang meyakinkan. Nada suara hangat, antusias, dan persuasif."]

Speaker 1
[voiceover script with timestamps and emotion tags inline. Use ONLY these emotion tags: [intrigue] [desire] [information] [excited] [inspiration] [confident]. Every line starts with timestamp and emotion tag, e.g.
[00:00] [intrigue] Masih repot marut keju atau kelapa pakai alat lama?
[00:05] [excited] Kenalin, Parutan Serbaguna Stainless super praktis ini!
...
[00:25] [excited] Cek produk di bawah sekarang sebelum kehabisan!]

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
1. Durasi video adalah ${targetDuration} detik. Naskah voiceover HARUS pas ${minWords} s/d ${maxWords} kata (sekitar 12-14 kata tiap scene 5 detik) agar pas dengan durasi video tanpa perlu diperlambat!
2. Setiap baris naskah voiceover dan prompt AI Studio WAJIB diawali penanda waktu video, misal: [00:00], [00:05], [00:10], [00:15], [00:20], [00:25], dst.
3. JANGAN gunakan nama karakter suara khusus (cukup gunakan header "Speaker 1").
4. JANGAN PERNAH gunakan kata "Shopee" dalam naskah voiceover maupun Kotak Scene.
5. JANGAN PERNAH gunakan kata "link di bio".
6. Selalu gunakan ajakan seperti "Cek produk di bawah sekarang", "Klik produk di bawah", atau "Checkout produk di bawah sebelum kehabisan".

Return strict JSON in this format:
{
  "sampleContext": {
    "productName": "${effectiveTitle}",
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
  "voiceoverScript": "[00:00] Masih repot marut keju pakai alat lama?\\n[00:05] Kenalin parutan serbaguna ini...\\n[00:23] Cek produk di bawah sekarang!",
  "aiStudioPrompt": "Scene\\nStudio dapur modern...\\n\\nSample Context\\nIklan affiliate viral...\\n\\nSpeaker 1\\n[00:00] [intrigue] Masih repot...\\n[00:05] [excited] Kenalin...\\n[00:23] [excited] Cek produk di bawah sekarang!",
  "caption": "Teks caption lengkap dengan link pembelian dan hashtag..."
}`;

  const messageContent = [
    { type: 'text', text: userPrompt },
    ...trimmedFrames.map((f) => ({
      type: 'image_url',
      image_url: { url: f.base64 },
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
  if (!aiStudioPrompt) {
    aiStudioPrompt = `Scene\nStudio rekaman energik dengan presenter Indonesia yang antusias dan percaya diri.\n\nSample Context\nIklan affiliate viral. Dimulai dengan hook yang mengejutkan, membangun ke demonstrasi manfaat produk, diakhiri CTA yang meyakinkan. Nada suara hangat, antusias, dan persuasif.\n\nSpeaker 1 - Orus\n[intrigue] Stop scroll dulu! [desire] ${effectiveTitle} yang satu ini beneran wajib kamu punya! [information] ${effectiveDesc ? effectiveDesc.slice(0, 120) + '.' : 'Produk ini hadir dengan kualitas premium dan desain yang praktis untuk kebutuhan sehari-hari.'} [excited] Udah ribuan orang pake dan reviewnya bagus semua! [inspiration] Kualitasnya terbukti awet dan terpercaya untuk jangka panjang. [confident] Buruan cek produk di bawah sekarang sebelum kehabisan!`;
  }

  onProgress({
    step: 'gpt_scripting',
    message: `${AIVENE_MODEL} generated Kotak Scene, Sample Context, and Naskah successfully!`,
    progress: 88
  });

  return {
    sampleContext: parsed.sampleContext || {
      productName: effectiveTitle,
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
    notes: (reframe.notes || DEFAULT_REFRAME.notes).toString().slice(0, 180),
  };
}

function normalizeClipPlan(rawClips, totalDuration, { allowFallback = true } = {}) {
  const clipLength = 5;
  const sourceClips = Array.isArray(rawClips) ? rawClips : [];
  const normalized = [];
  let previousEnd = -1;

  console.log(`[normalizeClipPlan] totalDuration=${totalDuration}s, rawClips=${sourceClips.length}`);

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
    if (rawClip?.isCleanAffiliateShot === false) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}s: isCleanAffiliateShot=false`);
      continue;
    }
    if (hasSourceIdentityRisk(rawClip)) {
      console.log(`[normalizeClipPlan] Skip clip at ${startSeconds}s: sourceIdentityRisk=${rawClip?.sourceIdentityRisk}`);
      continue;
    }

    const endSeconds = startSeconds + clipLength;
    normalized.push({
      startSeconds,
      endSeconds,
      startTime: formatSeconds(startSeconds),
      endTime: formatSeconds(endSeconds),
      reason: (rawClip?.reason || 'Clean full-product affiliate shot.').toString().slice(0, 180),
      reframe: normalizeReframe(rawClip?.reframe),
    });
    previousEnd = endSeconds;
    if (normalized.length === 12) break;
  }

  console.log(`[normalizeClipPlan] Accepted ${normalized.length} clips from Gemini`);

  if (normalized.length) return normalized;
  if (!allowFallback) {
    throw new Error('Gemini tidak menemukan potongan faceless bersih yang cocok dengan produk.');
  }

  // Fallback: evenly spaced clips skipping first 10% (intro) and last 10% (outro)
  console.log(`[normalizeClipPlan] No clips accepted, building fallback plan for ${totalDuration}s video`);
  const maxStart = Math.max(0, Math.floor(totalDuration - clipLength));
  const fallbackStart = totalDuration > 25
    ? Math.min(maxStart, Math.max(8, Math.floor(totalDuration * 0.10)))
    : 0;
  const fallbackLastStart = totalDuration > 35
    ? Math.max(fallbackStart, Math.min(maxStart, Math.floor(totalDuration * 0.85) - clipLength))
    : maxStart;

  for (let startSeconds = fallbackStart; startSeconds <= fallbackLastStart && normalized.length < 6; startSeconds += clipLength) {
    normalized.push({
      startSeconds,
      endSeconds: startSeconds + clipLength,
      startTime: formatSeconds(startSeconds),
      endTime: formatSeconds(startSeconds + clipLength),
      reason: 'Fallback 5-second product shot.',
      reframe: normalizeReframe(),
    });
  }

  if (!normalized.length) {
    throw new Error('Video terlalu pendek untuk membuat potongan produk utama 5 detik.');
  }
  return normalized;
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
