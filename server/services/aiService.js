import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

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
 * Stage 1, Step A: Calls Aivene API with model 'gemini-2.5-flash'
 * to analyze full video frames and select the optimal 30-60 second highlight window.
 */
export async function selectHighlightWithGemini25Flash({
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
    message: 'Analyzing full video frames with Gemini 2.5 Flash to select best 30-60s segment...',
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
Your task is to analyze the sequence of video frames and select the SINGLE most captivating, action-packed continuous highlight window of 30 to 60 seconds suitable for an Indonesian Shopee Affiliate vertical reel.

Rules:
1. Choose a continuous segment strictly between 30 and 60 seconds in length (e.g. 30s, 45s, or up to 60s).
2. The segment MUST show the product in action, unboxing, key demonstration, or exciting moments.
3. Output exact 'startTime' and 'endTime' in format "MM:SS" within 00:00 to ${formatSeconds(totalDuration)}.
4. Provide a catchy short Indonesian hook headline ('productHook').
5. Output MUST be valid JSON only.`;

  const userPrompt = `Product Title: "${effectiveTitle}"
${effectiveDesc ? `Product Description / Key Features: "${effectiveDesc}"` : ''}
Video Title: "${videoMetadata?.title || effectiveTitle}"
Total Video Duration: ${totalDuration} seconds (${formatSeconds(totalDuration)})
Product Link: ${shopeeLink || 'https://shope.ee/link'}

Sampled Visual Frames (${frames.length} frames across timeline):
${frames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

Identify the best 30-60 second highlight window.
Return strict JSON in this format:
{
  "startTime": "00:15",
  "endTime": "00:55",
  "duration": 40,
  "productHook": "Racun Shopee Viral Wajib Punya!"
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
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    });

    const rawContent = response.choices?.[0]?.message?.content || '{}';
    console.log('[AIService Gemini 2.5 Flash] Raw response:', rawContent);

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    }

    let startSec = parseTimeToSeconds(parsed.startTime || '00:00');
    let endSec = parseTimeToSeconds(parsed.endTime || '00:45');

    // Ensure 30-60 second segment duration constraint
    if (endSec <= startSec || endSec - startSec < 25) {
      endSec = Math.min(totalDuration, startSec + 40);
    }
    if (endSec - startSec > 60) {
      endSec = startSec + 55;
    }
    if (endSec > totalDuration && totalDuration > 30) {
      endSec = totalDuration;
      startSec = Math.max(0, endSec - 45);
    }

    const duration = endSec - startSec;
    const startTime = formatSeconds(startSec);
    const endTime = formatSeconds(endSec);

    onProgress({
      step: 'gemini_vision',
      message: `Gemini 2.5 Flash selected 30-60s highlight: ${startTime} - ${endTime} (${duration}s)`,
      progress: 55
    });

    return {
      startTime,
      endTime,
      startSeconds: startSec,
      endSeconds: endSec,
      duration,
      productHook: parsed.productHook || 'Racun Shopee Viral Wajib Punya!',
    };
  } catch (err) {
    console.error('[AIService Gemini 2.5 Flash] Error:', err);
    throw new Error(formatApiError(err, 'gemini-2.5-flash'));
  }
}

/**
 * Stage 1, Step B: Calls Aivene API with model 'gpt-4o-mini'
 * using explicit user provided Product Title and Product Description to generate:
 * - Kotak Scene (Scene Breakdown)
 * - Sample Context (USPs, Target Audience, Core Problem)
 * - Naskah Voiceover (Ad Advisor Standard in Indonesian)
 * - Google AI Studio Prompt Template
 * - Reels Caption & Hashtags
 */
export async function generateAdAdvisorScriptWithGpt4oMini({
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
    message: 'Analyzing trimmed video frames with GPT-4o-mini for Kotak Scene & Ad Advisor Naskah...',
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
   - Break the ${segmentDuration}-second video into 3 to 4 distinct sequential scenes.
   - For each scene provide:
     * 'sceneNumber': integer (1, 2, 3...)
     * 'timeRange': e.g. "00:00 - 00:10"
     * 'visualDescription': What is happening visually in Indonesian.
     * 'voiceover': The exact spoken narration line for this scene.
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
   - A copy-paste ready prompt template formatted for Google AI Studio / Gemini TTS to generate or refine the Indonesian voiceover audio.

5. 'caption':
   - High-converting Instagram & Facebook Reels caption with emojis, Indonesian hashtags (#racunbelanja, #racuntiktok, #reelsviral, #affiliateindonesia, etc.), and the provided affiliate link.

Output MUST be strictly valid JSON matching the requested schema.`;

  const userPrompt = `=== INFORMASI PRODUK UTAMA ===
Judul / Nama Produk: "${effectiveTitle}"
${effectiveDesc ? `Deskripsi & Spesifikasi Produk: "${effectiveDesc}"` : 'Deskripsi: (Analisis dari visual frame video)'}
Shopee Affiliate Link: ${shopeeLink || 'https://shope.ee/link'}
Visual Hook: "${productHook || 'Racun Viral Wajib Punya!'}"
Durasi Video Potongan: ${segmentDuration} detik

Visual Frames of the 30-60s Trimmed Video (${trimmedFrames.length} frames):
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
      "timeRange": "00:00 - 00:10",
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
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const rawContent = response.choices?.[0]?.message?.content || '{}';
    console.log('[AIService GPT-4o-mini] Raw response:', rawContent);

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
      aiStudioPrompt = `Bertindaklah sebagai Senior Ad Advisor untuk konten Affiliate Video Indonesia.\nKonteks Produk: "${effectiveTitle}"\n${effectiveDesc ? `Deskripsi: ${effectiveDesc}\n` : ''}Naskah Spoken Voiceover:\n${voiceoverScript}\n\nHasilkan pembacaan audio voiceover dengan intonasi ramah, antusias, dan persuasif.`;
    }

    onProgress({
      step: 'gpt_scripting',
      message: 'GPT-4o-mini generated Kotak Scene, Sample Context, and Naskah successfully!',
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
      scenes: Array.isArray(parsed.scenes) && parsed.scenes.length > 0
        ? parsed.scenes
        : [
            {
              sceneNumber: 1,
              timeRange: "00:00 - 00:10",
              visualDescription: `Tampilan visual ${effectiveTitle} di awal video.`,
              voiceover: `Stop scroll! ${effectiveTitle} yang satu ini beneran lagi viral dan wajib kamu punya!`,
              adAdvisorNotes: "Gunakan hook visual dinamis & teks 'Wajib Punya!' di layar."
            },
            {
              sceneNumber: 2,
              timeRange: "00:10 - 00:30",
              visualDescription: "Demonstrasi fitur utama dan kepraktisan produk.",
              voiceover: "Kualitasnya juara dan praktis banget buat kebutuhan sehari-hari.",
              adAdvisorNotes: "Pacing suara antusias, sorot keunggulan produk secara detail."
            },
            {
              sceneNumber: 3,
              timeRange: `00:30 - 00:${segmentDuration.toString().padStart(2, '0')}`,
              visualDescription: "Hasil akhir dan ajakan bertindak (CTA).",
              voiceover: "Buruan checkout sekarang mumpung lagi diskon spesial, cek produk di bawah!",
              adAdvisorNotes: "Munculkan panah animasi mengarah ke produk di bawah."
            }
          ],
      voiceoverScript,
      aiStudioPrompt,
      caption,
    };
  } catch (err) {
    console.error('[AIService GPT-4o-mini] Error:', err);
    throw new Error(formatApiError(err, 'gpt-4o-mini'));
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
