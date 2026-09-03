import fs from 'fs';
import path from 'path';

// Default Model ID: ANGELICA (Indonesian female advertisement voice on Fish Audio)
export const DEFAULT_FISH_MODEL_ID = 'c95eaba077c7436aab953b1b1327d9c5';
export const DEFAULT_FISH_VOICE_NAME = 'ANGELICA';

// Supported emotional tone and audio effect tags in Fish Audio S2.1 Pro
export const VALID_FISH_TAGS = new Set([
  'excited', 'emphasis', 'soft', 'whispering', 'breathy',
  'angry', 'sad', 'embarrassed',
  'pause', 'long pause', 'sighing', 'laughing', 'chuckling'
]);

/**
 * Phonetic adaptations for Indonesian words on multilingual TTS models.
 * Solves common mispronunciation issues (such as "banget" sounding like "ban" + "et").
 */
export function applyIndonesianPhoneticFixes(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    // 1. "banget" -> "bangét" (tanda aksen / garis miring kecil di atas e agar suara natural tanpa patahan glottal)
    .replace(/\bbanget\b/gi, 'bangét')
    .replace(/\bbangett\b/gi, 'bangét')
    .replace(/\bbangnget\b/gi, 'bangét')
    .replace(/\bbangget\b/gi, 'bangét')
    // 2. User-specified affiliate phonetic rules:
    // worth it ➔ wortit
    .replace(/\bworth\s*it\b/gi, 'wortit')
    // aesthetic ➔ estetik
    .replace(/\baesthetic\b/gi, 'estetik')
    // checkout ➔ cekout
    .replace(/\bcheck\s*out\b/gi, 'cekout')
    .replace(/\bcheckout\b/gi, 'cekout')
    // flash sale ➔ flas sel
    .replace(/\bflash\s*sale\b/gi, 'flas sel')
    // 2 in 1 / 2in1 ➔ tu in wan
    .replace(/\b1\s*in\s*1\b/gi, 'wan in wan')
    .replace(/\b2\s*in\s*1\b/gi, 'tu in wan')
    .replace(/\b3\s*in\s*1\b/gi, 'tri in wan')
    .replace(/\b4\s*in\s*1\b/gi, 'for in wan')
    .replace(/\b(\d+)\s*in\s*(\d+)\b/gi, '$1 in $2')
    // 3. Additional online shopping terms
    .replace(/\bShopee\b/gi, 'Syopi')
    .replace(/\bTikTok\b/gi, 'Tiktok')
    .replace(/\bvoucher\b/gi, 'vowcer')
    .replace(/\bfree\s*ongkir\b/gi, 'fri ongkir')
    .replace(/\breview\b/gi, 'reviu')
    .replace(/\bsimple\b/gi, 'simpel')
    .replace(/\brecommended\b/gi, 'rekomended');
}

/**
 * Prepares the script for Fish Audio S2.1 Pro TTS:
 * - Preserves supported emotion & pacing tags: [excited], [emphasis], [soft], [pause], etc.
 * - Strips timestamps, speaker markers, and unsupported brackets.
 * - Applies phonetic Indonesian corrections.
 */
export function prepareScriptForFishTTS(rawScript) {
  if (!rawScript || typeof rawScript !== 'string') return '';

  let text = rawScript;

  // Extract text after Speaker 1 if script has section headers
  const speakerMatch = text.match(/(?:Speaker\s*\d*(?:\s*-[^\n\r:]+)?|SPEAKER\s*\d*)[\s\r\n:]+([\s\S]*)$/i);
  if (speakerMatch && speakerMatch[1].trim()) {
    text = speakerMatch[1].trim();
  }

  // Remove timestamp markers like [00:00], [00:05], (00:00)
  text = text.replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]/g, ' ');
  text = text.replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)/g, ' ');

  // Filter brackets: Keep ONLY valid Fish Audio emotion/effect tags, strip unsupported ones
  text = text.replace(/\[\s*([a-zA-Z\s_-]{2,30})\s*\]/g, (match, tag) => {
    const normalizedTag = tag.trim().toLowerCase();
    if (VALID_FISH_TAGS.has(normalizedTag)) {
      return ` [${normalizedTag}] `;
    }
    return ' ';
  });

  // Remove parenthesized directions like (hook), (cta), (senyum), etc.
  text = text.replace(/\(\s*(?:hook|cta|problem|solution|intrigue|desire|urgency|information|senyum|tunjuk|close-up|cut to)[^)]*\)/gi, ' ');

  // Remove leftover markdown headers, bold/italics, bullet points, asterisks, hashtags
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/[*_~`]/g, '');
  text = text.replace(/^[-•*]\s+/gm, '');
  text = text.replace(/#\w+/g, '');

  // Expand common symbols
  text = text.replace(/%/g, ' persen ');
  text = text.replace(/&/g, ' dan ');
  text = text.replace(/\+/g, ' plus ');

  // Clean whitespace and normalize lines
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !/^Speaker\s*\d/i.test(line));

  const consolidated = lines.join(' ').replace(/\s{2,}/g, ' ').trim();

  // Apply phonetic fixes for Indonesian voiceover
  return applyIndonesianPhoneticFixes(consolidated);
}

/**
 * Produces clean standard Indonesian text for video subtitles:
 * Strips ALL tags and metadata, retaining proper standard Indonesian spelling.
 */
export function cleanScriptForSubtitles(rawScript) {
  if (!rawScript || typeof rawScript !== 'string') return '';

  let text = rawScript;

  const speakerMatch = text.match(/(?:Speaker\s*\d*(?:\s*-[^\n\r:]+)?|SPEAKER\s*\d*)[\s\r\n:]+([\s\S]*)$/i);
  if (speakerMatch && speakerMatch[1].trim()) {
    text = speakerMatch[1].trim();
  }

  // Remove all timestamp markers
  text = text.replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]/g, ' ');
  text = text.replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)/g, ' ');

  // Remove ALL bracket tags completely (both emotion tags and metadata)
  text = text.replace(/\[\s*[^\]]+\s*\]/g, ' ');
  text = text.replace(/\([^)]+\)/g, ' ');

  // Remove markdown formatting
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/[*_~`]/g, '');
  text = text.replace(/^[-•*]\s+/gm, '');
  text = text.replace(/#\w+/g, '');

  // Normalize phonetic spellings back to standard text for on-screen subtitles
  text = text.replace(/\bbangét\b/gi, 'banget');
  text = text.replace(/\btu\s*in\s*wan\b/gi, '2 in 1');
  text = text.replace(/\bflas\s*sel\b/gi, 'flash sale');
  text = text.replace(/\bwortit\b/gi, 'worth it');

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !/^Speaker\s*\d/i.test(line));

  return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Backwards-compatibility alias
 */
export const cleanScriptForTTS = prepareScriptForFishTTS;

/**
 * Helper to test whether an error is due to Fish Audio quota exhaustion
 */
export function isFishAudioQuotaError(statusCode, responseText = '') {
  if (statusCode === 402 || statusCode === 429) return true;
  const lower = String(responseText).toLowerCase();
  return lower.includes('insufficient') ||
    lower.includes('quota') ||
    lower.includes('credit') ||
    lower.includes('balance') ||
    lower.includes('saldo') ||
    lower.includes('rate limit') ||
    lower.includes('exceeded') ||
    lower.includes('free tier limit');
}

/**
 * Generate Voiceover Audio directly via Fish Audio API (S2.1 Pro)
 * Uses Voice Model ANGELICA (c95eaba077c7436aab953b1b1327d9c5).
 * If quota runs out, stops the job and marks it as retryable tomorrow.
 */
export async function generateVoiceoverTTS({
  script,
  outputPath,
  modelId = null,
  onProgress = null,
  jobId = '',
}) {
  const ttsText = prepareScriptForFishTTS(script);
  const subtitleText = cleanScriptForSubtitles(script);

  if (!ttsText || ttsText.length < 3) {
    throw new Error('Naskah suara kosong setelah dibersihkan dari tag/timestamp.');
  }

  const log = (msg) => {
    console.log(`[Fish Audio${jobId ? ` ${jobId}` : ''}] ${msg}`);
    if (onProgress) onProgress(msg);
  };

  const apiKey = (process.env.FISH_AUDIO_API_KEY || '').trim();
  if (!apiKey || apiKey.startsWith('your_') || apiKey.endsWith('_here')) {
    const err = new Error('FISH_AUDIO_API_KEY belum disetel di server/.env. Silakan isi API key Fish Audio Anda.');
    err.isConfigError = true;
    throw err;
  }

  const referenceId = (
    modelId ||
    process.env.FISH_AUDIO_MODEL_ID ||
    DEFAULT_FISH_MODEL_ID
  ).trim();

  log(`Menghasilkan voice over ANGELICA (${ttsText.length} karakter): "${ttsText.slice(0, 60)}..."`);

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let response;
  try {
    response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'model': 's2.1-pro-free',
      },
      body: JSON.stringify({
        text: ttsText,
        reference_id: referenceId,
        format: 'mp3',
      }),
    });
  } catch (networkErr) {
    throw new Error(`Gagal menghubungi server Fish Audio: ${networkErr.message}`);
  }

  if (!response.ok) {
    const rawError = await response.text().catch(() => '');
    console.error(`[Fish Audio Error HTTP ${response.status}]`, rawError);

    if (isFishAudioQuotaError(response.status, rawError)) {
      const quotaErr = new Error(
        'Kuota harian Fish Audio (S2.1 Pro) telah habis. Proses dihentikan dan Anda dapat menekan tombol Retry besok ketika kuota direset.'
      );
      quotaErr.isQuotaError = true;
      quotaErr.canRetry = true;
      quotaErr.statusCode = response.status;
      throw quotaErr;
    }

    throw new Error(`Fish Audio API HTTP ${response.status}: ${rawError || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 500) {
    throw new Error('Hasil audio Fish Audio kosong atau file rusak.');
  }

  fs.writeFileSync(outputPath, buffer);
  log(`✅ Berhasil menghasilkan voice over ANGELICA! Ukuran: ${(buffer.length / 1024).toFixed(1)} KB`);

  return {
    audioPath: outputPath,
    provider: 'fish_audio',
    voice: 'ANGELICA',
    modelId: referenceId,
    sizeBytes: buffer.length,
    cleanScript: subtitleText,
    spokenScript: ttsText,
  };
}
