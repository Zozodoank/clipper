import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const AIVENE_GEMINI_MODEL = 'gemini-3.7-flash';
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
 * Stage 1, Step A: Calls Aivene API with Gemini vision
 * to analyze the full video timeline and select a cut plan made of 5-second product shots.
 */
export async function selectHighlightWithGeminiFlash({
  apiKey,
  frames,
  videoMetadata,
  productTitle,
  productDescription,
  shopeeLink,
  onProgress = () => {}
}) {
  onProgress({
    step: 'gemini_vision',
    message: `Analyzing full video frames with ${AIVENE_GEMINI_MODEL} to plan 5-second product shots...`,
    progress: 45
  });

  const effectiveApiKey = apiKey || process.env.AIVENE_API_KEY;
  if (!effectiveApiKey) {
    throw new Error('Aivene API Key tidak ditemukan. Pastikan AIVENE_API_KEY sudah disetel di file server/.env.');
  }

  const client = new OpenAI({
    apiKey: effectiveApiKey,
    baseURL: 'https://api.aivene.com/v1',
  });

  const totalDuration = videoMetadata?.duration || 60;
  const effectiveTitle = productTitle || videoMetadata?.title || 'Product Showcase Video';
  const effectiveDesc = productDescription || videoMetadata?.description || '';

  const systemPrompt = `You are an Expert Video Editor & Viral Short-Form Producer.
Your task is to analyze the entire source-video timeline and create a professional Indonesian affiliate-video cut plan. The backend will cut and concatenate ONLY the exact clips you return.

Rules:
1. Return 6 to 12 separate clips in chronological order. Every clip MUST be exactly 5 seconds long. Do not return a long continuous highlight.
2. Each clip MUST be a usable affiliate shot: product full body/whole product visible from edge to edge, product in use, packaging, detail, or hands-only demonstration. The product must not be cropped by the source frame.
3. Reject any candidate with a creator face, talking head, person as subject, burned-in source caption, username, watermark, price sticker, or large on-screen text over the product. Choose another clean moment instead.
4. Clips must not overlap and must use timestamps supported by the supplied frames. Output exact start/end in "MM:SS" within 00:00 to ${formatSeconds(totalDuration)}.
5. The first clip must be the strongest clean full-product hook. Subsequent clips should vary detail, use, benefit, and closing product shot like a polished affiliate edit.
6. For every clip, decide the best vertical 9:16 treatment:
   - 'focusX' from 0.0 left to 1.0 right, centered on the product/action.
   - 'focusY' from 0.0 top to 1.0 bottom.
   - Use renderMode 'preserve_full_product' for most landscape sources. This places a large 720x720 product stage over a blurred 9:16 background, centered on the product/action.
   - Use renderMode 'vertical_crop' only when the source is already a clean 9:16 product shot with safe empty margins.
7. FACELESS is absolute: a visible creator face means the clip is invalid. Never use crop as a reason to accept a face shot.
8. Output MUST be valid JSON only.`;

  const userPrompt = `Product Title: "${effectiveTitle}"
${effectiveDesc ? `Product Description / Key Features: "${effectiveDesc}"` : ''}
Video Title: "${videoMetadata?.title || effectiveTitle}"
Total Video Duration: ${totalDuration} seconds (${formatSeconds(totalDuration)})
Product Link: ${shopeeLink || 'https://shope.ee/link'}

Sampled Visual Frames (${frames.length} frames across timeline):
${frames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

Analyze every supplied timestamp, then return the best non-overlapping 5-second clip plan.
Return strict JSON in this format:
{
  "productHook": "Racun Shopee Viral Wajib Punya!",
  "clips": [
    {
      "startTime": "00:15",
      "endTime": "00:20",
      "reason": "Produk utuh dan bersih sebagai hook.",
      "reframe": {
        "focusX": 0.5,
        "focusY": 0.55,
        "renderMode": "preserve_full_product",
        "cropStrategy": "keep_full_product_no_source_text_no_face",
        "avoidTextZones": [],
        "avoidFaceZones": ["top_left"],
        "faceSafety": true,
        "notes": "Whole product visible, no face and no built-in text."
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

  try {
    const response = await client.chat.completions.create({
      model: AIVENE_GEMINI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    });

    const rawContent = response.choices?.[0]?.message?.content || '{}';
    console.log(`[AIService ${AIVENE_GEMINI_MODEL}] Raw response:`, rawContent);

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    }

    const clips = normalizeClipPlan(parsed.clips, totalDuration);
    const duration = clips.reduce((total, clip) => total + (clip.endSeconds - clip.startSeconds), 0);
    const startTime = clips[0].startTime;
    const endTime = clips[clips.length - 1].endTime;

    onProgress({
      step: 'gemini_vision',
      message: `${AIVENE_GEMINI_MODEL} selected ${clips.length} clean 5-second product shots (${duration}s total).`,
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
    console.error(`[AIService ${AIVENE_GEMINI_MODEL}] Error:`, err);
    throw new Error(formatApiError(err, AIVENE_GEMINI_MODEL));
  }
}

/**
 * Stage 1, Step B: Calls Aivene API with Gemini
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
    message: `Analyzing trimmed video frames with ${AIVENE_GEMINI_MODEL} for Kotak Scene & Ad Advisor Naskah...`,
    progress: 75
  });

  const effectiveApiKey = apiKey || process.env.AIVENE_API_KEY;
  if (!effectiveApiKey) {
    throw new Error('Aivene API Key tidak ditemukan. Pastikan AIVENE_API_KEY sudah disetel di file server/.env.');
  }

  const client = new OpenAI({
    apiKey: effectiveApiKey,
    baseURL: 'https://api.aivene.com/v1',
  });

  const effectiveTitle = (productTitle || '').trim() || videoMetadata?.title || 'Produk Viral Shopee';
  const effectiveDesc = (productDescription || '').trim();

  const systemPrompt = `You are a Senior Creative Director and Ad Advisor specializing in Indonesian Short-Form Affiliate Video Marketing (TikTok Shop, Shopee Video, Instagram Reels).

You will receive the explicit Product Title, Product Description, and the sampled frames of a ${segmentDuration}-second video clip. Use this precise product knowledge together with the visual frames to generate 5 high-converting marketing assets without making incorrect assumptions:

1. 'sampleContext':
   - 'productName': Explicit product name.
   - 'targetAudience': Specific target audience profile in Indonesia.
   - 'coreProblem': The primary pain point this product solves based on description & visual.
   - 'keyFeatures': List of 3-4 key USPs (Unique Selling Propositions).
   - 'buyingTrigger': Psychological trigger (FOMO, convenience, discount, viral trend).

2. 'scenes' (Kotak Scene / Scene-by-Scene Breakdown):
   - Break the ${segmentDuration}-second video into short editing beats of 4 to 5 seconds each.
   - Produce enough scenes to cover the full clip duration, usually ${Math.ceil(segmentDuration / 5)} to ${Math.ceil(segmentDuration / 4)} scenes.
   - No single scene may be longer than 5 seconds unless it is the final leftover scene.
   - For each scene provide:
     * 'sceneNumber': integer (1, 2, 3...)
     * 'timeRange': e.g. "00:00 - 00:05"
     * 'visualDescription': What is happening visually in Indonesian.
     * 'voiceover': The exact spoken narration line for this scene, short enough to fit 4-5 seconds.
     * 'adAdvisorNotes': Director notes for sound effects (SFX), visual text overlays, or emotional pacing.

3. 'voiceoverScript' (Naskah Voiceover Lengkap):
   - A complete Indonesian spoken narration formatted cleanly with sections:
     [HOOK 0-3s]: Bold, curiosity-inducing hook line mentioning the product.
     [PROBLEM & DEMO 3-20s]: Story / problem and benefit demonstration based on product description and video visual.
     [VALUE PROPOSITION 20-35s]: Key advantages, specifications, and quality assurance.
     [CALL TO ACTION 35-${segmentDuration}s]: Direct CTA directing viewer to check the product below (e.g., "Cek produk di bawah sekarang sebelum kehabisan!").

STRICT RULES FOR VOICE OVER & CALL TO ACTION:
- NEVER use the word "Shopee" in the voiceover script or scene spoken lines.
- NEVER say "link di bio" or "klik link di bio".
- ALWAYS use direct calls like "Cek produk di bawah sekarang", "Klik produk di bawah", "Checkout produk di bawah mumpung promo", or "Cek selengkapnya di bawah".

4. 'aiStudioPrompt':
   - A copy-paste ready text block formatted EXACTLY for Google AI Studio TTS Playground (Composer view).
   - It MUST follow this exact structure (with these exact section headers on separate lines):

Scene
[One sentence describing the setting/environment, e.g. "Studio rekaman energik dengan presenter Indonesia yang antusias."]

Sample Context
[One or two sentences describing tone, pacing, and style of the ad. e.g. "Iklan affiliate viral. Dimulai dengan hook yang menarik perhatian, membangun ke demonstrasi produk, diakhiri CTA yang meyakinkan. Nada suara hangat, antusias, dan persuasif."]

Speaker 1 - Orus
[voiceover script with emotion tags inline. Use ONLY these emotion tags: [intrigue] [desire] [information] [excited] [inspiration] [confident]. Each sentence or phrase should start with the most fitting emotion tag. Write the full Indonesian voiceover narration here from hook to CTA, using the product's actual name and details.]

   - IMPORTANT: The output of 'aiStudioPrompt' must be a plain string (not JSON) ready to paste directly into AI Studio. Do NOT add any JSON object inside it.

5. 'caption':
   - High-converting Instagram & Facebook Reels caption with emojis, Indonesian hashtags (#racunbelanja, #racuntiktok, #reelsviral, #affiliateindonesia, etc.), and the provided affiliate link.

Output MUST be strictly valid JSON matching the requested schema.`;

  const userPrompt = `=== INFORMASI PRODUK UTAMA ===
Judul / Nama Produk: "${effectiveTitle}"
${effectiveDesc ? `Deskripsi & Spesifikasi Produk: "${effectiveDesc}"` : 'Deskripsi: (Analisis dari visual frame video)'}
Shopee Affiliate Link: ${shopeeLink || 'https://shope.ee/link'}
Visual Hook: "${productHook || 'Racun Viral Wajib Punya!'}"
Durasi Video Potongan: ${segmentDuration} detik

Visual Frames of the concatenated 5-second Gemini-selected product clips (${trimmedFrames.length} frames):
${trimmedFrames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

Gunakan informasi judul dan deskripsi produk di atas agar naskah sangat relevan dan akurat.
Buat Kotak Scene, Sample Context, Naskah Voiceover Ad Advisor, dan AI Studio prompt.

PENTING - ATURAN CTA & NARASI:
1. JANGAN PERNAH gunakan kata "Shopee" dalam naskah voiceover maupun Kotak Scene.
2. JANGAN PERNAH gunakan kata "link di bio".
3. Selalu gunakan ajakan seperti "Cek produk di bawah sekarang", "Klik produk di bawah", atau "Checkout produk di bawah sebelum kehabisan".

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
  "voiceoverScript": "[HOOK]\\n...\\n\\n[PROBLEM & DEMO]\\n...\\n\\n[CALL TO ACTION]\\n...",
  "aiStudioPrompt": "Prompt siap copy ke Google AI Studio...",
  "caption": "Teks caption lengkap dengan link pembelian dan hashtag..."
}`;

  const messageContent = [
    { type: 'text', text: userPrompt },
    ...trimmedFrames.map((f) => ({
      type: 'image_url',
      image_url: { url: f.base64 },
    })),
  ];

  try {
    const response = await client.chat.completions.create({
      model: AIVENE_GEMINI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const rawContent = response.choices?.[0]?.message?.content || '{}';
    console.log(`[AIService ${AIVENE_GEMINI_MODEL} Scripting] Raw response:`, rawContent);

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
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
      message: `${AIVENE_GEMINI_MODEL} generated Kotak Scene, Sample Context, and Naskah successfully!`,
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
  } catch (err) {
    console.error(`[AIService ${AIVENE_GEMINI_MODEL} Scripting] Error:`, err);
    throw new Error(formatApiError(err, AIVENE_GEMINI_MODEL));
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
    notes: (reframe.notes || DEFAULT_REFRAME.notes).toString().slice(0, 180),
  };
}

function normalizeClipPlan(rawClips, totalDuration) {
  const clipLength = 5;
  const sourceClips = Array.isArray(rawClips) ? rawClips : [];
  const normalized = [];
  let previousEnd = -1;

  for (const rawClip of sourceClips) {
    let startSeconds = Math.max(0, Math.round(parseTimeToSeconds(rawClip?.startSeconds ?? rawClip?.startTime)));
    if (startSeconds < previousEnd) continue;
    if (startSeconds + clipLength > totalDuration) continue;

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

  if (normalized.length) return normalized;

  // API fallback still keeps the renderer on five-second cuts instead of returning one long scene.
  const maxStart = Math.max(0, Math.floor(totalDuration - clipLength));
  for (let startSeconds = 0; startSeconds <= maxStart && normalized.length < 6; startSeconds += clipLength) {
    normalized.push({
      startSeconds,
      endSeconds: startSeconds + clipLength,
      startTime: formatSeconds(startSeconds),
      endTime: formatSeconds(startSeconds + clipLength),
      reason: 'Fallback 5-second product shot pending Gemini detail.',
      reframe: normalizeReframe(),
    });
  }

  if (!normalized.length) {
    throw new Error('Video terlalu pendek untuk membuat potongan produk utama 5 detik.');
  }
  return normalized;
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
