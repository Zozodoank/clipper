import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

/**
 * Stage 1, Step A: Calls Aivene API with model 'gemini-2.5-flash'
 * to analyze full video frames and select the optimal 30-60 second highlight window.
 * 
 * @param {object} params
 * @param {string} params.apiKey - Aivene API Key
 * @param {Array<object>} params.frames - Sampled video frames
 * @param {object} params.videoMetadata - { title, duration, description }
 * @param {string} params.shopeeLink - Affiliate URL
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<{ startTime: string, endTime: string, startSeconds: number, endSeconds: number, duration: number, productHook: string }>}
 */
export async function selectHighlightWithGemini25Flash({
  apiKey,
  frames,
  videoMetadata,
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
    throw new Error('Aivene API Key is required. Please provide your Aivene API Key in the UI or .env file.');
  }

  const client = new OpenAI({
    apiKey: effectiveApiKey,
    baseURL: 'https://api.aivene.com/v1',
  });

  const totalDuration = videoMetadata?.duration || 60;
  const videoTitle = videoMetadata?.title || 'Product Showcase Video';

  const systemPrompt = `You are an Expert Video Editor & Viral Short-Form Producer.
Your task is to analyze the sequence of video frames and select the SINGLE most captivating, action-packed continuous highlight window of 30 to 60 seconds suitable for an Indonesian Shopee Affiliate vertical reel.

Rules:
1. Choose a continuous segment strictly between 30 and 60 seconds in length (e.g. 30s, 45s, or up to 60s).
2. The segment MUST show the product in action, unboxing, key demonstration, or exciting moments.
3. Output exact 'startTime' and 'endTime' in format "MM:SS" (e.g. "00:15" to "00:55") within 00:00 to ${formatSeconds(totalDuration)}.
4. Provide a catchy short Indonesian hook headline ('productHook').
5. Output MUST be valid JSON only.`;

  const userPrompt = `Video Title: "${videoTitle}"
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
    throw new Error(`Gemini 2.5 Flash highlight selection failed: ${err.message}`);
  }
}

/**
 * Stage 1, Step B: Calls Aivene API with model 'gpt-4o-mini'
 * to analyze frames from the trimmed 30-60s silent 9:16 video and generate:
 * - Kotak Scene (Scene Breakdown)
 * - Sample Context (USPs, Target Audience, Core Problem)
 * - Naskah Voiceover (Ad Advisor Standard in Indonesian)
 * - Google AI Studio Prompt Template
 * - Reels Caption & Hashtags
 * 
 * @param {object} params
 * @param {string} params.apiKey - Aivene API Key
 * @param {Array<object>} params.trimmedFrames - Frames from the 30-60s trimmed vertical video
 * @param {object} params.videoMetadata - { title, duration }
 * @param {string} params.shopeeLink - Affiliate URL
 * @param {string} params.productHook - Hook from Gemini
 * @param {number} params.segmentDuration - Duration of segment (30-60s)
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<object>} Structured Ad Advisor creative output
 */
export async function generateAdAdvisorScriptWithGpt4oMini({
  apiKey,
  trimmedFrames,
  videoMetadata,
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
    throw new Error('Aivene API Key is required. Please provide your Aivene API Key in the UI or .env file.');
  }

  const client = new OpenAI({
    apiKey: effectiveApiKey,
    baseURL: 'https://api.aivene.com/v1',
  });

  const videoTitle = videoMetadata?.title || 'Product Showcase Video';

  const systemPrompt = `You are a Senior Creative Director and Ad Advisor specializing in Indonesian Short-Form Affiliate Video Marketing (TikTok Shop, Shopee Video, Instagram Reels).

You will analyze the sampled frames of a 30-60 second trimmed video and generate 5 comprehensive, high-converting creative assets:

1. 'sampleContext':
   - 'productName': Product identity and what it is.
   - 'targetAudience': Specific target audience profile in Indonesia.
   - 'coreProblem': The primary pain point this product solves.
   - 'keyFeatures': List of 3-4 key USPs (Unique Selling Propositions) visible in the frames.
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
     [HOOK 0-3s]: Bold, curiosity-inducing hook line.
     [PROBLEM & DEMO 3-20s]: Story / problem and benefit demonstration seen in the video.
     [VALUE PROPOSITION 20-35s]: Key advantages and quality assurance.
     [CALL TO ACTION 35-${segmentDuration}s]: Direct CTA directing viewer to checkout via Shopee link in bio/caption.

4. 'aiStudioPrompt':
   - A copy-paste ready prompt template formatted for Google AI Studio / Gemini TTS to generate or refine the Indonesian voiceover audio.

5. 'caption':
   - High-converting Instagram & Facebook Reels caption with emojis, Indonesian hashtags (#racunshopee, #shopeehaul, #spillracunshopee, #reelsviral, etc.), and the provided Shopee affiliate link.

Output MUST be strictly valid JSON matching the requested schema.`;

  const userPrompt = `Product Video Title: "${videoTitle}"
Video Segment Duration: ${segmentDuration} seconds
Visual Hook: "${productHook || 'Racun Shopee Viral!'}"
Shopee Affiliate Link: ${shopeeLink || 'https://shope.ee/link'}

Visual Frames of the 30-60s Trimmed Video (${trimmedFrames.length} frames):
${trimmedFrames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

Generate the complete Kotak Scene, Sample Context, Naskah Voiceover, and AI Studio prompt.

Return strict JSON in this format:
{
  "sampleContext": {
    "productName": "Nama Produk",
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
  "caption": "Teks caption lengkap dengan link Shopee dan hashtag..."
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
      voiceoverScript = `[HOOK]\nStop scroll! Barang yang satu ini bener-bener lagi viral dan wajib banget kamu punya di Shopee!\n\n[DEMO & BENEFIT]\nKualitasnya kokoh, desainnya elegan, dan praktis banget buat dipakai sehari-hari tanpa ribet.\n\n[VALUE PROPOSITION]\nUdah banyak yang review bagus dan terbukti awet buat jangka panjang.\n\n[CALL TO ACTION]\nMumpung lagi ada diskon spesial dan promo gratis ongkir, buruan checkout di link Shopee sekarang sebelum kehabisan!`;
    }

    let caption = (parsed.caption || '').trim();
    if (!caption) {
      caption = `🔥 Racun Shopee Viral Wajib Punya!\n\nBarang impian yang lagi viral banget! Buruan checkout sekarang mumpung lagi diskon & promo gratis ongkir!\n\n🛒 Link Pembelian Shopee: ${shopeeLink || 'https://shope.ee/link-disini'}\n\n#racunshopee #shopeehaul #racuntiktok #reelsviral #affiliateindonesia #spillracunshopee`;
    } else if (shopeeLink && !caption.includes(shopeeLink)) {
      caption += `\n\n🛒 Link Shopee: ${shopeeLink}`;
    }

    let aiStudioPrompt = (parsed.aiStudioPrompt || '').trim();
    if (!aiStudioPrompt) {
      aiStudioPrompt = `Bertindaklah sebagai Senior Ad Advisor untuk konten Shopee Affiliate Indonesia.\nKonteks Produk: "${videoTitle}"\nNaskah Spoken Voiceover:\n${voiceoverScript}\n\nHasilkan pembacaan audio voiceover dengan intonasi ramah, antusias, dan persuasif.`;
    }

    onProgress({
      step: 'gpt_scripting',
      message: 'GPT-4o-mini generated Kotak Scene, Sample Context, and Naskah successfully!',
      progress: 88
    });

    return {
      sampleContext: parsed.sampleContext || {
        productName: videoTitle,
        targetAudience: "Pengguna Shopee & pencari produk viral",
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
              visualDescription: "Tampilan visual hook produk di awal video.",
              voiceover: "Stop scroll! Barang yang satu ini beneran lagi rame banget di Shopee!",
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
              voiceover: "Buruan checkout sekarang mumpung ada diskon spesial di link Shopee!",
              adAdvisorNotes: "Munculkan panah animasi mengarah ke bio/deskripsi."
            }
          ],
      voiceoverScript,
      aiStudioPrompt,
      caption,
    };
  } catch (err) {
    console.error('[AIService GPT-4o-mini] Error:', err);
    throw new Error(`GPT-4o-mini scripting failed: ${err.message}`);
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
