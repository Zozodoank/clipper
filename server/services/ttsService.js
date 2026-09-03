import fs from 'fs';
import path from 'path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

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
 * Generate Voiceover Audio via Microsoft Edge Neural TTS (Default: id-ID-GadisNeural)
 * Extremely natural, expressive Indonesian female voice with high emotional dynamic,
 * 100% free, zero configuration, zero latency queue.
 */
async function generateWithEdgeNeural(cleanText, outputPath, voice = 'id-ID-GadisNeural') {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    
    // Create temp directory for msedge-tts output
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const result = await tts.toFile(outDir, cleanText);
    tts.close();

    if (result && result.audioFilePath) {
      // If filename differs from target outputPath, move/copy it
      if (path.resolve(result.audioFilePath) !== path.resolve(outputPath)) {
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch {}
        }
        fs.copyFileSync(result.audioFilePath, outputPath);
        try { fs.unlinkSync(result.audioFilePath); } catch {}
      }
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 500) {
      throw new Error('File audio yang dihasilkan kosong atau tidak valid.');
    }

    return {
      audioPath: outputPath,
      provider: 'edge_neural',
      voice: voice,
      sizeBytes: fs.statSync(outputPath).size,
    };
  } catch (err) {
    try { tts.close(); } catch {}
    throw err;
  }
}

/**
 * Generate Voiceover Audio via Fish Audio Official API (https://api.fish.audio/v1/tts)
 * Uses high-fidelity neural Indonesian female voice model when FISH_AUDIO_API_KEY is available.
 */
async function generateWithFishAudioApi(cleanText, outputPath, apiKey, modelId) {
  if (!apiKey) {
    throw new Error('FISH_AUDIO_API_KEY is not configured in .env');
  }

  // Use configured modelId or fallback to general high-quality Indonesian female reference
  const referenceId = modelId || process.env.FISH_AUDIO_MODEL_ID || '7f92f8afb8ec43bf81429cc1c9199cb1';

  const response = await fetch('https://api.fish.audio/v1/tts', {
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

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Fish Audio API HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length < 500) {
    throw new Error('Hasil audio Fish Audio kosong atau terlalu kecil.');
  }

  fs.writeFileSync(outputPath, buffer);

  return {
    audioPath: outputPath,
    provider: 'fish_audio_api',
    voice: `Fish Audio (${referenceId})`,
    sizeBytes: buffer.length,
  };
}

/**
 * Generate Voiceover Audio via Hugging Face Gradio Client (@gradio/client)
 * Optional experimental integration for Fish Speech HF spaces.
 */
async function generateWithGradioSpace(cleanText, outputPath, spaceName = 'fishaudio/fish-speech-1.4') {
  const { client } = await import('@gradio/client');
  const app = await client(spaceName);
  const result = await app.predict(0, [cleanText]);

  if (!result || !result.data) {
    throw new Error('Gradio Space tidak mengembalikan data audio.');
  }

  // Handle URL or file blob from gradio client
  const audioData = result.data[0];
  if (typeof audioData === 'string' && (audioData.startsWith('http://') || audioData.startsWith('https://'))) {
    const resp = await fetch(audioData);
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(outputPath, buf);
  } else if (audioData?.url) {
    const resp = await fetch(audioData.url);
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(outputPath, buf);
  } else {
    throw new Error('Format data audio dari Gradio Space tidak dikenali.');
  }

  return {
    audioPath: outputPath,
    provider: 'fish_speech_gradio',
    voice: spaceName,
    sizeBytes: fs.statSync(outputPath).size,
  };
}

/**
 * Primary Unified TTS Dispatcher
 * Defaults to the ultra-realistic Indonesian female voice "Gadis" (id-ID-GadisNeural).
 * If Fish Audio API Key is present, prefers Fish Audio with automatic fallback to Gadis.
 */
export async function generateVoiceoverTTS({
  script,
  outputPath,
  voice = 'id-ID-GadisNeural',
  onProgress = null,
  jobId = '',
}) {
  const cleanText = cleanScriptForTTS(script);
  if (!cleanText || cleanText.length < 3) {
    throw new Error('Naskah suara kosong setelah dibersihkan dari tag/timestamp.');
  }

  const log = (msg) => {
    console.log(`[TTS${jobId ? ` ${jobId}` : ''}] ${msg}`);
    if (onProgress) onProgress(msg);
  };

  log(`Memproses naskah TTS (${cleanText.length} karakter): "${cleanText.slice(0, 60)}..."`);

  const fishApiKey = (process.env.FISH_AUDIO_API_KEY || '').trim();
  const ttsEngine = (process.env.TTS_PROVIDER || '').toLowerCase().trim();

  // Try Fish Audio if explicitly requested or if FISH_AUDIO_API_KEY is configured
  if (ttsEngine === 'fish_audio' || (fishApiKey && !fishApiKey.startsWith('your_'))) {
    try {
      log('Mencoba generate dengan Fish Audio API...');
      const res = await generateWithFishAudioApi(cleanText, outputPath, fishApiKey);
      log(`✅ Berhasil dengan Fish Audio! Ukuran: ${(res.sizeBytes / 1024).toFixed(1)} KB`);
      return { ...res, cleanScript: cleanText };
    } catch (fishErr) {
      log(`⚠️ Fish Audio gagal (${fishErr.message}). Beralih otomatis ke Suara Gadis Indonesia (Edge Neural)...`);
    }
  }

  // Try Gradio Space if requested
  if (ttsEngine === 'gradio') {
    try {
      log('Mencoba generate via HuggingFace Gradio Space...');
      const res = await generateWithGradioSpace(cleanText, outputPath);
      log(`✅ Berhasil via Gradio Space! Ukuran: ${(res.sizeBytes / 1024).toFixed(1)} KB`);
      return { ...res, cleanScript: cleanText };
    } catch (gradioErr) {
      log(`⚠️ Gradio Space gagal (${gradioErr.message}). Beralih otomatis ke Suara Gadis Indonesia...`);
    }
  }

  // Primary Default: Ultra-Realistic Indonesian Female Voice (id-ID-GadisNeural)
  log(`Menghasilkan suara wanita Indonesia paling realistis (Gadis Neural - "${voice}")...`);
  const result = await generateWithEdgeNeural(cleanText, outputPath, voice);
  log(`✅ Suara Gadis Indonesia berhasil digenerate! Ukuran: ${(result.sizeBytes / 1024).toFixed(1)} KB`);

  return {
    ...result,
    cleanScript: cleanText,
  };
}
