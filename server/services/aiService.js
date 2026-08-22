import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

/**
 * Calls Aivene API (model 'gemini-1.5-flash') using OpenAI SDK with multimodal Base64 image frames.
 * @param {object} params
 * @param {string} params.apiKey - Aivene API Key
 * @param {Array<object>} params.frames - Array of { timestamp, timeFormatted, base64 }
 * @param {object} params.videoMetadata - { title, duration, description }
 * @param {string} params.shopeeLink - Affiliate URL
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<{ startTime: string, endTime: string, startSeconds: number, endSeconds: number, duration: number, voiceoverScript: string, caption: string, productHook: string }>}
 */
export async function analyzeVideoWithAivene({
  apiKey,
  frames,
  videoMetadata,
  shopeeLink,
  onProgress = () => {}
}) {
  onProgress({ step: 'ai_vision', message: 'Sending visual frames to Aivene (gemini-1.5-flash)...', progress: 55 });

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

  const systemPrompt = `You are a World-Class Viral Affiliate Marketing Producer specializing in Indonesian Short-Form Content (TikTok, Instagram Reels, Facebook Reels, YouTube Shorts).
Your goal is to analyze the sequence of video frames extracted from a video, find the most engaging and viral 15-30 second segment, and create an irresistible Indonesian affiliate sales pitch for Shopee.

Strict Rules:
1. Identify the most engaging, action-packed, or product-demonstrating 15 to 30 second continuous clip from the video frames.
2. Output exact 'startTime' and 'endTime' (format "MM:SS" or "HH:MM:SS", within 00:00 to ${formatSeconds(totalDuration)}). Ensure segment duration is between 15 and 30 seconds.
3. Write a high-converting, natural Indonesian promotional voiceover script ('voiceoverScript'). It must:
   - Hook the viewer in the first 3 seconds (curiosity, pain point, or "Racun Shopee" curiosity hook).
   - Highlight 2-3 key benefits shown in the visual clip.
   - End with a strong Call to Action (CTA) telling viewers to check the Shopee link in bio / caption / comments.
   - Match the 15-30 second speaking duration (approximately 35-70 spoken Indonesian words).
4. Write an engaging social media Reels caption ('caption'):
   - Punchy headline with emojis.
   - Persuasive product description.
   - Direct CTA with the provided Shopee affiliate link.
   - 8-12 trending Indonesian hashtags (#racunshopee #shopeehaul #affiliatehaul #spillracunshopee #tiktokshop #reelsviral #fyp, etc.).
5. You MUST return ONLY valid JSON matching the requested schema.`;

  const userTextPrompt = `Video Title: "${videoTitle}"
Total Video Duration: ${totalDuration} seconds (${formatSeconds(totalDuration)})
Shopee Affiliate Link to promote: ${shopeeLink || 'https://shope.ee/affiliate_link'}

Visual Frames Sampled (${frames.length} frames across timeline):
${frames.map((f, i) => `Frame #${i + 1} at timestamp ${f.timeFormatted} (${f.timestamp}s)`).join('\n')}

Analyze the visual frames attached to identify the product/scene, select the best 15-30s highlight segment, and generate the Indonesian affiliate script and caption.

Return JSON strictly in this structure:
{
  "startTime": "00:15",
  "endTime": "00:40",
  "productHook": "Short punchy Indonesian hook text for video overlay",
  "voiceoverScript": "Lengkap teks voiceover bahasa Indonesia tanpa markdown/tanda baca aneh...",
  "caption": "Teks caption lengkap beserta link Shopee dan hashtag..."
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

  try {
    const response = await client.chat.completions.create({
      model: 'gemini-1.5-flash',
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
      // Clean possible markdown backticks
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

    // Fallback script if empty
    let voiceoverScript = (parsedResult.voiceoverScript || '').trim();
    if (!voiceoverScript) {
      voiceoverScript = `Gila sih, produk yang satu ini bener-bener viral dan berguna banget buat kamu! Kualitasnya mantap, harganya juga ramah di kantong. Buruan cek link Shopee di deskripsi sekarang sebelum kehabisan diskonnya ya!`;
    }

    let caption = (parsedResult.caption || '').trim();
    if (!caption) {
      caption = `🔥 Racun Shopee Viral Wajib Punya!\n\nBarang impian yang lagi rame banget! Buruan checkout sebelum kehabisan diskon & promo gratis ongkirnya!\n\n🛒 Link Pembelian Shopee: ${shopeeLink || 'https://shope.ee/link-disini'}\n\n#racunshopee #shopeehaul #racuntiktok #reelsviral #affiliateindonesia #spillracunshopee`;
    } else if (shopeeLink && !caption.includes(shopeeLink)) {
      caption += `\n\n🛒 Link Shopee: ${shopeeLink}`;
    }

    onProgress({
      step: 'ai_vision',
      message: `AI Vision analysis complete! Highlight chosen: ${finalStartTime} - ${finalEndTime} (${duration}s)`,
      progress: 68
    });

    return {
      startTime: finalStartTime,
      endTime: finalEndTime,
      startSeconds: startSec,
      endSeconds: endSec,
      duration,
      productHook: parsedResult.productHook || 'Racun Shopee Viral!',
      voiceoverScript,
      caption,
    };
  } catch (error) {
    console.error('[AIService] Aivene API error:', error);
    throw new Error(`Aivene API Vision analysis failed: ${error.message}`);
  }
}

/**
 * Generates an MP3 TTS voiceover file from script using Aivene TTS or Google TTS fallback.
 * @param {object} params
 * @param {string} params.apiKey - Aivene API Key
 * @param {string} params.voiceoverScript - Indonesian text
 * @param {string} params.outputPath - Output MP3 path
 * @param {Function} params.onProgress - Progress callback
 * @returns {Promise<{ audioPath: string, durationEstimate: number }>}
 */
export async function generateVoiceoverAudio({
  apiKey,
  voiceoverScript,
  outputPath,
  voice = 'alloy',
  onProgress = () => {}
}) {
  onProgress({ step: 'tts', message: 'Generating Indonesian voiceover audio (TTS)...', progress: 72 });

  const effectiveApiKey = apiKey || process.env.AIVENE_API_KEY;

  // 1. Try Aivene TTS via OpenAI SDK
  if (effectiveApiKey) {
    try {
      const client = new OpenAI({
        apiKey: effectiveApiKey,
        baseURL: 'https://api.aivene.com/v1',
      });

      console.log('[AIService] Requesting TTS audio via Aivene API...');
      const mp3Response = await client.audio.speech.create({
        model: 'tts-1',
        voice: voice || 'alloy',
        input: voiceoverScript,
      });

      const buffer = Buffer.from(await mp3Response.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);
      console.log(`[AIService] TTS audio successfully generated at ${outputPath}`);
      onProgress({ step: 'tts', message: 'Voiceover audio successfully synthesized via Aivene.', progress: 80 });
      return { audioPath: outputPath };
    } catch (ttsErr) {
      console.warn(`[AIService] Aivene TTS API not available or error (${ttsErr.message}). Switching to Google TTS fallback...`);
    }
  }

  // 2. Fallback: Google Translate TTS for Indonesian ('id')
  try {
    console.log('[AIService] Using Indonesian TTS fallback synthesis...');
    const encodedText = encodeURIComponent(voiceoverScript.slice(0, 300));
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=id&client=tw-ob`;

    const res = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Fallback TTS HTTP error: ${res.statusText}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`[AIService] Fallback TTS audio written to ${outputPath}`);
    onProgress({ step: 'tts', message: 'Indonesian voiceover synthesized using fallback engine.', progress: 80 });
    return { audioPath: outputPath };
  } catch (fallbackErr) {
    console.error(`[AIService] Fallback TTS failed: ${fallbackErr.message}`);
    // If TTS totally fails, return null so videoRenderer will use source audio
    return { audioPath: null };
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
