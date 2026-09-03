import fs from 'fs';
import path from 'path';

// Default Model ID: ANGELICA (Indonesian female advertisement voice on Fish Audio)
export const DEFAULT_FISH_MODEL_ID = 'c95eaba077c7436aab953b1b1327d9c5';
export const DEFAULT_FISH_VOICE_NAME = 'ANGELICA';

/**
 * Strips timestamps, emotion tags, speaker markers, and markdown from AI script
 * to ensure pristine, natural speech reading without reciting metadata.
 *
 * Example input:
 *   [00:00] [intrigue] Wastafel dapurmu berantakan dan sabunnya cepat habis terus? Capek banget kan?
 *   [00:05] [excited] Kenalin, Dispenser Sabun 2in1 ini solusi paling praktis buat area wastafelmu!
 *
 * Output:
 *   Wastafel dapurmu berantakan dan sabunnya cepat habis terus? Capek banget kan?
 *   Kenalin, Dispenser Sabun 2 in 1 ini solusi paling praktis buat area wastafelmu!
 */
export function cleanScriptForTTS(rawScript) {
  if (!rawScript || typeof rawScript !== 'string') return '';

  let text = rawScript;

  // 1. If script contains Speaker section, extract text after Speaker 1
  const speakerMatch = text.match(/(?:Speaker\s*\d*(?:\s*-[^\n\r:]+)?|SPEAKER\s*\d*)[\s\r\n:]+([\s\S]*)$/i);
  if (speakerMatch && speakerMatch[1].trim()) {
    text = speakerMatch[1].trim();
  }

  // 2. Remove all timestamp markers like [00:00], [00:05], [01:23:45], (00:00)
  text = text.replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]/g, ' ');
  text = text.replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)/g, ' ');

  // 3. Remove emotion, cue, and direction tags like [intrigue], [excited], [desire], [cta], [hook], etc.
  text = text.replace(/\[\s*[a-zA-Z\s_-]{2,30}\s*\]/g, ' ');
  text = text.replace(/\(\s*(?:hook|cta|problem|solution|intrigue|excited|desire|urgency|information|pause|senyum|tunjuk|close-up|cut to)[^)]*\)/gi, ' ');

  // 4. Remove leftover markdown headers, bold/italics, bullet points, asterisks, hashtags
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/[*_~`]/g, '');
  text = text.replace(/^[-•*]\s+/gm, '');
  text = text.replace(/#\w+/g, ''); // remove hashtags

  // 5. Expand common symbols for natural Indonesian pronunciation
  text = text.replace(/\b(\d+)\s*in\s*(\d+)\b/gi, '$1 in $2');
  text = text.replace(/%/g, ' persen ');
  text = text.replace(/&/g, ' dan ');
  text = text.replace(/\+/g, ' plus ');

  // 6. Clean whitespace and normalize lines
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !/^Speaker\s*\d/i.test(line));

  return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
}

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
  const cleanText = cleanScriptForTTS(script);
  if (!cleanText || cleanText.length < 3) {
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

  log(`Menghasilkan voice over ANGELICA (${cleanText.length} karakter): "${cleanText.slice(0, 50)}..."`);

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
        text: cleanText,
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
    cleanScript: cleanText,
  };
}
