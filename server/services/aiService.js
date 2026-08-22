import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

/**
 * Calls Aivene API (using model 'gpt-4o-mini' or 'gemini-1.5-flash') using OpenAI SDK with multimodal Base64 image frames.
 * Generates Ad Advisor standard affiliate creative assets: Scene Breakdown (Kotak Scene), Sample Context,
 * Voiceover Script (ID), AI Studio / Gemini prompt template, and Reels Caption with Shopee Affiliate link.
 * 
 * @param {object} params
 * @param {string} params.apiKey - Aivene API Key
 * @param {string} [params.model='gpt-4o-mini'] - Target AI model
 * @param {Array<object>} params.frames - Array of { timestamp, timeFormatted, base64 }
 * @param {object} params.videoMetadata - { title, duration, description }
 * @param {string} params.shopeeLink - Affiliate URL
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<object>} Structured Ad Advisor creative output
 */
export async function analyzeVideoWithAivene({
  apiKey,
  model = 'gpt-4o-mini',
  frames,
  videoMetadata,
  shopeeLink,
  onProgress = () => {}
}) {
  onProgress({
    step: 'ai_vision',
    message: `Sending visual frames to Aivene (${model}) for Ad Advisor analysis...`,
    progress: 55
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

  const systemPrompt = `You are a World-Class Short-Form Video Producer and Senior Ad Advisor specializing in high-converting Indonesian Affiliate Video Ads (TikTok Shop, Shopee Video, Instagram Reels, Facebook Reels) conforming to Google AI Studio Ad Advisor best practices.

Your objective:
Analyze the sampled video frames, extract deep product context, identify the most captivating 15-30 second viral highlight window, and generate 5 structured creative marketing assets:

1. 'sampleContext': Comprehensive context breakdown in Indonesian:
   - Product Identity & What it does
   - Target Audience & Their Core Pain Point
   - Key Unique Selling Propositions (USPs) seen in the visual frames
   - Best emotional buying trigger

2. 'scenes' (Kotak Scene / Scene-by-Scene Breakdown):
   - Break the chosen 15-30 second highlight into 3 to 4 distinct scenes.
   - For each scene provide:
     * 'sceneNumber': integer (1, 2, 3...)
     * 'timeRange': e.g. "00:00 - 00:05"
     * 'visualDescription': What is happening visually in Indonesian
     * 'voiceover': The exact spoken narration line for this scene
     * 'adAdvisorNotes': Director tips on pacing, sound effects (SFX), or visual text overlays

3. 'voiceoverScript': Complete, cohesive Indonesian spoken script written in Ad Advisor structure:
   - [HOOK 0-3s]: High-curiosity question or bold statement ("Racun Shopee", "Stop scroll!", etc.)
   - [AGITATION & DEMO 3-15s]: Demonstrating the benefit shown in the video
   - [VALUE PROPOSITION 15-22s]: Why this product is worth buying
   - [CALL TO ACTION 22-30s]: Direct CTA to checkout via Shopee link in bio/caption

4. 'aiStudioPrompt': A ready-to-copy prompt in Indonesian formatted specifically for manual copy-pasting into Google AI Studio / Gemini to experiment with alternate voiceover variations or scripts.

5. 'caption': Viral Instagram & Facebook Reels caption with emojis, Indonesian hashtags (#racunshopee, #shopeehaul, #spillracun, etc.), and the provided Shopee affiliate link.

6. 'startTime' and 'endTime': Best continuous 15-30s highlight window (format "MM:SS").

Output MUST be strictly valid JSON matching the requested schema.`;

  const userTextPrompt = `Video Title: "${videoTitle}"
Total Video Duration: ${totalDuration} seconds (${formatSeconds(totalDuration)})
Shopee Affiliate Link to promote: ${shopeeLink || 'https://shope.ee/affiliate_link'}

Visual Frames Sampled (${frames.length} frames across timeline):
${frames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

Analyze the product, choose the 15-30s highlight segment, and generate the Ad Advisor structured breakdown and voiceover script in Indonesian.

Return strict JSON in this format:
{
  "startTime": "00:15",
  "endTime": "00:40",
  "productHook": "Headline hook untuk banner video",
  "sampleContext": {
    "productName": "Nama produk",
    "targetAudience": "Target audiens spesifik",
    "coreProblem": "Masalah utama yang diselesaikan",
    "keyFeatures": ["Fitur 1", "Fitur 2", "Fitur 3"],
    "buyingTrigger": "Alasan psikologis beli"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "timeRange": "00:15 - 00:20",
      "visualDescription": "Deskripsi visual adegan",
      "voiceover": "Teks voiceover scene 1",
      "adAdvisorNotes": "Tips sutradara (SFX / Pacing / Text on screen)"
    }
  ],
  "voiceoverScript": "[HOOK]\\n...\\n\\n[PROBLEM & DEMO]\\n...\\n\\n[CALL TO ACTION]\\n...",
  "aiStudioPrompt": "Salin prompt ini ke Google AI Studio / Gemini...",
  "caption": "Teks caption lengkap dengan link Shopee dan hashtag..."
}`;

  const messageContent = [
    { type: 'text', text: userTextPrompt },
    ...frames.map((f) => ({
      type: 'image_url',
      image_url: {
        url: f.base64,
      },
    })),
  ];

  const primaryModel = model || 'gpt-4o-mini';

  try {
    const response = await client.chat.completions.create({
      model: primaryModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const rawContent = response.choices?.[0]?.message?.content || '{}';
    console.log('[AIService] Raw Aivene response:', rawContent);

    let parsedResult;
    try {
      parsedResult = JSON.parse(rawContent);
    } catch (parseErr) {
      const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleaned);
    }

    // Validate and sanitize timestamps
    let startSec = parseTimeToSeconds(parsedResult.startTime || '00:00');
    let endSec = parseTimeToSeconds(parsedResult.endTime || '00:25');

    if (endSec <= startSec || endSec - startSec < 10) {
      endSec = Math.min(totalDuration, startSec + 25);
    }
    if (endSec - startSec > 40) {
      endSec = startSec + 30;
    }
    if (endSec > totalDuration && totalDuration > 15) {
      endSec = totalDuration;
      startSec = Math.max(0, endSec - 25);
    }

    const duration = endSec - startSec;
    const finalStartTime = formatSeconds(startSec);
    const finalEndTime = formatSeconds(endSec);

    // Fallbacks
    let voiceoverScript = (parsedResult.voiceoverScript || '').trim();
    if (!voiceoverScript) {
      voiceoverScript = `[HOOK]\nGila sih, barang yang satu ini bener-bener viral dan wajib banget kamu punya!\n\n[DEMO & BENEFIT]\nKualitasnya kokoh, praktis dipakai sehari-hari, dan bikin hidup jauh lebih mudah.\n\n[CALL TO ACTION]\nHarganya lagi diskon gila-gilaan di Shopee, buruan klik link di bio/deskripsi sebelum kehabisan!`;
    }

    let caption = (parsedResult.caption || '').trim();
    if (!caption) {
      caption = `🔥 Racun Shopee Viral Wajib Punya!\n\nBarang impian yang lagi viral! Buruan checkout sekarang mumpung lagi diskon & promo gratis ongkir!\n\n🛒 Link Pembelian Shopee: ${shopeeLink || 'https://shope.ee/link-disini'}\n\n#racunshopee #shopeehaul #racuntiktok #reelsviral #affiliateindonesia #spillracunshopee`;
    } else if (shopeeLink && !caption.includes(shopeeLink)) {
      caption += `\n\n🛒 Link Shopee: ${shopeeLink}`;
    }

    // Fallback for AI Studio Prompt if empty
    let aiStudioPrompt = (parsedResult.aiStudioPrompt || '').trim();
    if (!aiStudioPrompt) {
      aiStudioPrompt = `Bertindaklah sebagai Senior Ad Advisor untuk konten Shopee Affiliate Indonesia.\nKonteks Produk: "${videoTitle}"\nBuat variasi script voiceover 20-30 detik dengan formula Hook (0-3s), Story/Problem (3-15s), dan Call To Action ke link Shopee: ${shopeeLink || 'https://shope.ee/link'}`;
    }

    // Fallback for Scenes if empty
    let scenes = Array.isArray(parsedResult.scenes) && parsedResult.scenes.length > 0
      ? parsedResult.scenes
      : [
          {
            sceneNumber: 1,
            timeRange: `${finalStartTime} - ${formatSeconds(startSec + 5)}`,
            visualDescription: "Tampilan visual produk dengan aksi menarik di awal.",
            voiceover: "Gila sih, barang yang satu ini bener-bener lagi rame banget!",
            adAdvisorNotes: "Gunakan hook visual dinamis & teks 'Wajib Punya!' di layar."
          },
          {
            sceneNumber: 2,
            timeRange: `${formatSeconds(startSec + 5)} - ${formatSeconds(startSec + 15)}`,
            visualDescription: "Demonstrasi fitur utama dan kepraktisan penggunaan produk.",
            voiceover: "Kualitasnya juara dan praktis banget buat kebutuhan sehari-hari.",
            adAdvisorNotes: "Pacing suara antusias, sorot keunggulan produk secara close-up."
          },
          {
            sceneNumber: 3,
            timeRange: `${formatSeconds(startSec + 15)} - ${finalEndTime}`,
            visualDescription: "Hasil akhir penggunaan produk dan ajakan bertindak.",
            voiceover: "Buruan checkout sekarang mumpung ada promo diskon di link Shopee!",
            adAdvisorNotes: "Munculkan tanda panah / animasi ke bio / link pembelian."
          }
        ];

    onProgress({
      step: 'ai_vision',
      message: `Ad Advisor analysis complete (${primaryModel})! Highlight chosen: ${finalStartTime} - ${finalEndTime} (${duration}s)`,
      progress: 75
    });

    return {
      startTime: finalStartTime,
      endTime: finalEndTime,
      startSeconds: startSec,
      endSeconds: endSec,
      duration,
      productHook: parsedResult.productHook || 'Racun Shopee Viral!',
      sampleContext: parsedResult.sampleContext || {
        productName: videoTitle,
        targetAudience: "Pengguna Shopee & pencari produk viral",
        coreProblem: "Mencari produk berkualitas dengan harga terjangkau",
        keyFeatures: ["Praktis", "Bahan Berkualitas", "Harga Terjangkau"],
        buyingTrigger: "FOMO & Diskon Terbatas"
      },
      scenes,
      voiceoverScript,
      aiStudioPrompt,
      caption,
    };
  } catch (error) {
    console.error('[AIService] Aivene API error:', error);
    throw new Error(`Aivene API Ad Advisor analysis failed: ${error.message}`);
  }
}

/**
 * Optional fallback helper for generating MP3 voiceover if user chooses to enable it.
 */
export async function generateVoiceoverAudio({
  apiKey,
  voiceoverScript,
  outputPath,
  voice = 'alloy',
  onProgress = () => {}
}) {
  onProgress({ step: 'tts', message: 'Generating Indonesian voiceover audio (Optional TTS)...', progress: 78 });

  const effectiveApiKey = apiKey || process.env.AIVENE_API_KEY;

  if (effectiveApiKey) {
    try {
      const client = new OpenAI({
        apiKey: effectiveApiKey,
        baseURL: 'https://api.aivene.com/v1',
      });

      const cleanText = voiceoverScript.replace(/\[.*?\]/g, '').trim();
      const mp3Response = await client.audio.speech.create({
        model: 'tts-1',
        voice: voice || 'alloy',
        input: cleanText,
      });

      const buffer = Buffer.from(await mp3Response.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);
      return { audioPath: outputPath };
    } catch (ttsErr) {
      console.warn(`[AIService] TTS optional engine note: ${ttsErr.message}`);
    }
  }

  return { audioPath: null };
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
