import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { applyTalingPhonetics } from './phoneticData.js';
import { getFFmpegPath } from './binaryChecker.js';

// Default Microsoft Edge TTS Voice: id-ID-GadisNeural (Indonesian female natural voice)
export const DEFAULT_EDGE_VOICE = 'id-ID-GadisNeural';
export const DEFAULT_EDGE_VOICE_NAME = 'Gadis (Edge-TTS Neural)';

// Default Fish Audio Model ID (legacy fallback): RINDI
export const DEFAULT_FISH_MODEL_ID = '9c94fb1d0504466898beb87481df9fa1';
export const DEFAULT_FISH_VOICE_NAME = 'RINDI';

// Supported emotional tone and audio effect tags in Fish Audio S2.1 Pro
export const VALID_FISH_TAGS = new Set([
  'excited', 'emphasis', 'soft', 'whispering', 'breathy',
  'angry', 'sad', 'embarrassed',
  'pause', 'long pause', 'sighing', 'laughing', 'chuckling'
]);

/**
 * Phonetic adaptations for Indonesian words on multilingual TTS models.
 * Solves common mispronunciation issues (such as "banget" sounding like "ban" + "et",
 * and distinguishing taling /e/ vs pepet /ə/ for Fish Audio Angelica).
 */
export function applyIndonesianPhoneticFixes(text, { useTaling = false } = {}) {
  if (!text || typeof text !== 'string') return '';

  let result = text;
  if (useTaling) {
    // Taling dictionary & diacritics for legacy multilingual models like Fish Audio
    result = applyTalingPhonetics(result);
  } else {
    // Edge TTS natively models standard Indonesian. Strip accent marks (é, è, ê -> e) so pronunciation stays pure.
    result = result.replace(/[éèê]/g, 'e').replace(/[ÉÈÊ]/g, 'E');
  }

  return result
    // 2. Vokal & Diakritik Slang/Khas Indonesia:
    .replace(/\b(?:banget|bangett|bangnget|bangget)\b/gi, useTaling ? 'bangét' : 'banget')
    .replace(/\bpengen\b/gi, useTaling ? 'péngin' : 'pengin')
    .replace(/\b(?:kece|kécé)\b/gi, 'keren')
    .replace(/\byuk\b/gi, 'yu')
    .replace(/\b(?:enggak|engga|nggak|ngga)\b/gi, 'tidak')

    // Hindari kata kangen dan kata-kata slang informal berawalan "ng":
    .replace(/\bkangen\b/gi, 'ingin')
    .replace(/\bngasih\b/gi, 'kasih')
    .replace(/\bngeliat\b/gi, 'melihat')
    .replace(/\bngerasain\b/gi, 'merasakan')
    .replace(/\bngapain\b/gi, 'kenapa')
    .replace(/\bngerepotin\b/gi, 'merepotkan')
    .replace(/\bngaruh\b/gi, 'berpengaruh')
    .replace(/\bngelakuin\b/gi, 'melakukan')
    .replace(/\bngambil\b/gi, 'mengambil')
    .replace(/\bngatur\b/gi, 'mengatur')
    .replace(/\bngabisin\b/gi, 'menghabiskan')
    .replace(/\bngeluarin\b/gi, 'mengeluarkan')
    .replace(/\bngeringin\b/gi, 'mengeringkan')
    .replace(/\bngisi\b/gi, 'mengisi')
    .replace(/\bngiris\b/gi, 'mengiris')
    .replace(/\bngulek\b/gi, 'mengulek')
    .replace(/\bngaduk\b/gi, 'mengaduk')
    .replace(/\bngupas\b/gi, 'mengupas')
    .replace(/\bngoles\b/gi, 'mengoles')
    .replace(/\bngocok\b/gi, 'mengocok')

    // Tulis persis keju=keju dan beres=beres tanpa tanda aksen kecil di atas huruf e:
    .replace(/\b(?:kéju|kèju|kêju)\b/gi, 'keju')
    .replace(/\b(?:bérés|bèrès|bêrês)\b/gi, 'beres')
    .replace(/\b(?:dibéréskan|dibèrèskan)\b/gi, 'dibereskan')
    .replace(/\b(?:membéréskan|membèrèskan)\b/gi, 'membereskan')
    .replace(/\b(?:méja|mèja|mêja)\b/gi, 'meja')

    // Filter platform media sosial / marketplace agar tidak pernah terucap di voiceover:
    .replace(/\b(?:racun\s+)?(?:tiktok|shopee|instagram|youtube|facebook|reels|medsos)\b/gi, 'belanja')
    .replace(/\b(?:Shopee|Syopi|TikTok|Tiktok|Instagram|Facebook|YouTube|Reels)\b/gi, '')

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

    // 3. Kata Serapan & Marketing yang Rawan Terbaca Bule / Aksen Inggris:
    // Kata-kata berawalan V diganti F agar model TTS tidak membacanya "bhee" / "vee"
    .replace(/\bviral\b/gi, 'firal')
    .replace(/\bvoucher\b/gi, 'fowcer')
    .replace(/\bvideo\b/gi, useTaling ? 'fidéo' : 'video')
    .replace(/\bvariasi\b/gi, 'fariasi')
    .replace(/\bvarian\b/gi, 'farian')
    .replace(/\bventilasi\b/gi, useTaling ? 'féntilasi' : 'ventilasi')
    .replace(/\bversi\b/gi, useTaling ? 'férsi' : 'versi')
    .replace(/\bvakum\b/gi, 'fakum')
    .replace(/\bvitamin\b/gi, 'fitamin')
    .replace(/\bvintage\b/gi, 'fintij')
    .replace(/\bportable\b/gi, 'portabel')          // Mencegah dibaca "por-tuh-bl"
    .replace(/\bdesign\b/gi, 'desain')              // Mencegah dibaca "di-zayn"
    .replace(/\bcompact\b/gi, 'kompak')             // Mencegah dibaca "kuhm-pækt"
    .replace(/\bready\s*stock\b/gi, 'redi stok')
    .replace(/\breadystock\b/gi, 'redi stok')
    .replace(/\breal\s*pict\b/gi, 'ril-pik')
    .replace(/\brealpict\b/gi, 'ril-pik')
    .replace(/\bbest\s*seller\b/gi, 'paling laris')
    .replace(/\bfree\s*ongkir\b/gi, 'gratis ongkir')
    .replace(/\bguys\b/gi, 'gais')
    .replace(/\bexclusive\b/gi, 'eksklusif')
    .replace(/\breview\b/gi, 'reviu')
    .replace(/\bsimple\b/gi, 'simpel')
    .replace(/\brecommended\b/gi, 'rekomended')

    // 4. Singkatan & Akronim E-Commerce (Mencegah salah baca atau dieja huruf per huruf):
    .replace(/\bCOD\b/gi, 'Ce O De')                // Mencegah dibaca "kod" (ikan kod)
    .replace(/\bRp\.?\s*([0-9.,]+)/gi, '$1 rupiah') // "Rp 50.000" -> "50.000 rupiah" (mencegah dibaca "ar-pi")
    .replace(/\b(\d+)\s*k\b/gi, '$1 ribu')          // "50k" -> "50 ribu"
    .replace(/\bNo\.?\s*1\b/gi, 'Nomor satu')       // "No 1" -> "Nomor satu"
    .replace(/\b(\d+)\s*(?:pcs|pc)\b/gi, '$1 buah') // "3 pcs" -> "3 buah"
    .replace(/\bShopee\b/gi, 'Syopi')
    .replace(/\bTikTok\b/gi, 'Tiktok')

    // 5. Satuan Produk (Mencegah lafal huruf asing "see-em", "kay-gee"):
    .replace(/\b(\d+)\s*cm\b/gi, '$1 senti')
    .replace(/\b(\d+)\s*ml\b/gi, '$1 mili')
    .replace(/\b(\d+)\s*kg\b/gi, '$1 kilo')
    .replace(/\b(\d+)\s*gr\b/gi, '$1 gram')
    .replace(/\b(\d+)\s*watt\b/gi, '$1 wat');
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

  // Apply phonetic fixes for Indonesian voiceover (Fish Audio uses taling accents é)
  return applyIndonesianPhoneticFixes(consolidated, { useTaling: true });
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
  text = text.replace(/\btu\s*in\s*wan\b/gi, '2 in 1');
  text = text.replace(/\btri\s*in\s*wan\b/gi, '3 in 1');
  text = text.replace(/\bfor\s*in\s*wan\b/gi, '4 in 1');
  text = text.replace(/\bflas\s*sel\b/gi, 'flash sale');
  text = text.replace(/\bwortit\b/gi, 'worth it');
  text = text.replace(/\bcekout\b/gi, 'checkout');
  text = text.replace(/\bCe\s*O\s*De\b/gi, 'COD');
  text = text.replace(/\b(vi-ral|firal)\b/gi, 'viral');
  text = text.replace(/\b(vowcer|fowcer)\b/gi, 'voucher');
  text = text.replace(/\b(fidéo|fideo)\b/gi, 'video');
  text = text.replace(/\bfariasi\b/gi, 'variasi');
  text = text.replace(/\bfarian\b/gi, 'varian');
  text = text.replace(/\b(férsi|fersi)\b/gi, 'versi');
  text = text.replace(/\b(féntilasi|fentilasi)\b/gi, 'ventilasi');
  text = text.replace(/\bfakum\b/gi, 'vakum');
  text = text.replace(/\bfitamin\b/gi, 'vitamin');
  text = text.replace(/\bredi\s*stok\b/gi, 'ready stock');
  text = text.replace(/\bril-pik\b/gi, 'real pict');
  text = text.replace(/\bgais\b/gi, 'guys');
  text = text.replace(/\bSyopi\b/gi, 'Shopee');
  text = text.replace(/\bpéngin\b/gi, 'pengen');
  text = text.replace(/\bskinker\b/gi, 'skincare');

  // Remove all accent marks (é, è, ê -> e) so subtitle screen text is pure standard Indonesian
  text = text.replace(/[éèê]/g, 'e').replace(/[ÉÈÊ]/g, 'E');

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !/^Speaker\s*\d/i.test(line));

  return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Prepares the script for Microsoft Edge TTS (id-ID-GadisNeural):
 * - Strips timestamps, speaker markers, and emotion tags.
 * - Applies phonetic Indonesian corrections and expansions.
 */
export function prepareScriptForEdgeTTS(rawScript) {
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

  // Convert [pause] or [long pause] to natural punctuation pause for Edge TTS
  text = text.replace(/\[\s*(?:long\s*)?pause\s*\]/gi, ', ');

  // Remove ALL other bracketed tags (e.g. [excited], [soft], etc.)
  text = text.replace(/\[\s*[^\]]+\s*\]/g, ' ');

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

  const consolidated = lines.join(' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.:!?])/g, '$1').trim();

  // Apply phonetic fixes for Indonesian voiceover (Edge-TTS does NOT use taling accents, pure standard Indonesian)
  return applyIndonesianPhoneticFixes(consolidated, { useTaling: false });
}

/**
 * Backwards-compatibility alias
 */
export const cleanScriptForTTS = prepareScriptForEdgeTTS;

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
 * Parses raw script into scene lines with target timestamps and emotion tags.
 */
export function parseScriptToScenes(rawScript, targetDurationSec = 20) {
  if (!rawScript || typeof rawScript !== 'string') return [];

  let text = rawScript;
  const speakerMatch = text.match(/(?:Speaker\s*\d*(?:\s*-[^\n\r:]+)?|SPEAKER\s*\d*)[\s\r\n:]+([\s\S]*)$/i);
  if (speakerMatch && speakerMatch[1].trim()) {
    text = speakerMatch[1].trim();
  }

  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^Speaker\s*\d/i.test(l));

  const scenes = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx];
    let targetSec = null;
    const timeMatch = line.match(/^\[?(\d{1,2}):(\d{2})\]?/);
    if (timeMatch) {
      targetSec = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
    }

    let clean = line.replace(/^\[?\d{1,2}:\d{2}\]?\s*/, '');

    let emotion = 'default';
    const emotionMatch = clean.match(/\[(excited|emphasis|soft|intrigue|urgent|happy|information)\]/i);
    if (emotionMatch) {
      emotion = emotionMatch[1].toLowerCase();
    }

    clean = clean.replace(/\[\s*(?:long\s*)?pause\s*\]/gi, ', ');
    clean = clean.replace(/\[\s*[^\]]+\s*\]/g, ' ');
    clean = clean.replace(/\([^)]+\)/g, ' ');
    clean = clean.replace(/^#+\s+/gm, '').replace(/[*_~`]/g, '').replace(/^[-•*]\s+/gm, '').replace(/#\w+/g, '');
    clean = clean.replace(/%/g, ' persen ').replace(/&/g, ' dan ').replace(/\+/g, ' plus ');
    clean = clean.replace(/\s{2,}/g, ' ').replace(/\s+([,.:!?])/g, '$1').trim();

    if (!clean) continue;

    const spokenText = applyIndonesianPhoneticFixes(clean, { useTaling: false });
    const subtitleText = cleanScriptForSubtitles(line);

    scenes.push({
      idx,
      rawLine: line,
      targetSec,
      emotion,
      spokenText,
      subtitleText,
    });
  }

  const maxSafeTarget = Math.max(2, targetDurationSec - 2.8);
  const highestTarget = Math.max(0, ...scenes.map((s) => s.targetSec || 0));

  if (highestTarget > maxSafeTarget && highestTarget > 0) {
    // If timestamps generated by AI were based on a longer script (e.g. 30s template),
    // scale them down proportionally so they fit comfortably within this video's duration.
    const scale = maxSafeTarget / highestTarget;
    for (const s of scenes) {
      if (s.targetSec !== null) {
        s.targetSec = +(s.targetSec * scale).toFixed(2);
      }
    }
  } else if (scenes.length > 0 && scenes.every((s) => s.targetSec === null)) {
    const spacing = Math.max(2.5, (targetDurationSec - 2.8) / Math.max(1, scenes.length - 1));
    for (let i = 0; i < scenes.length; i++) {
      scenes[i].targetSec = +(i * spacing).toFixed(2);
    }
  }

  return scenes;
}

/**
 * Generate Voiceover Audio via Microsoft Edge TTS (id-ID-GadisNeural).
 * 100% Free, no API key required, high quality natural Indonesian voiceover.
 * Synchronizes per-scene audio and extracts exact WordBoundary timestamps for pixel-perfect subtitles.
 */
export async function generateVoiceoverEdgeTTS({
  script,
  outputPath,
  targetDurationSec = null,
  voice = 'id-ID-GadisNeural',
  onProgress = null,
  jobId = '',
}) {
  const scenes = parseScriptToScenes(script, targetDurationSec || 20);
  const subtitleText = cleanScriptForSubtitles(script);
  const fullSpokenText = scenes.map((s) => s.spokenText).join(' ');

  if (!fullSpokenText || fullSpokenText.length < 3) {
    throw new Error('Naskah suara kosong setelah dibersihkan dari tag/timestamp.');
  }

  const log = (msg) => {
    console.log(`[Edge TTS${jobId ? ` ${jobId}` : ''}] ${msg}`);
    if (onProgress) onProgress(msg);
  };

  const selectedVoice = (voice || process.env.TTS_VOICE || DEFAULT_EDGE_VOICE).trim();
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (scenes.length <= 1) {
    log(`Menghasilkan voice over Gadis continuous (${fullSpokenText.length} karakter)...`);
    const tts = new MsEdgeTTS();
    await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    });

    const words = [];
    const { audioStream, metadataStream } = tts.toStream(fullSpokenText, {
      rate: '+8%',
      pitch: '+4Hz',
      volume: '+0%',
    });

    metadataStream.on('data', (d) => {
      try {
        const json = JSON.parse(d.toString());
        for (const m of json.Metadata || []) {
          if (m.Type === 'WordBoundary') {
            words.push({
              word: m.Data.text.Text,
              startSec: +(m.Data.Offset / 10000000).toFixed(3),
              durationSec: +(m.Data.Duration / 10000000).toFixed(3),
              endSec: +((m.Data.Offset + m.Data.Duration) / 10000000).toFixed(3),
            });
          }
        }
      } catch {}
    });

    const writeStream = fs.createWriteStream(outputPath);
    audioStream.pipe(writeStream);
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      audioStream.on('error', (err) => {
        writeStream.destroy();
        reject(new Error(`Edge TTS audio stream error: ${err.message}`));
      });
      writeStream.on('error', (err) => {
        reject(new Error(`Gagal menulis file audio TTS: ${err.message}`));
      });
    });

    const stats = fs.statSync(outputPath);
    return {
      audioPath: outputPath,
      provider: 'edge_tts',
      voice: 'Gadis (Edge-TTS Neural)',
      modelId: selectedVoice,
      sizeBytes: stats.size,
      cleanScript: subtitleText,
      spokenScript: fullSpokenText,
      wordBoundaries: words,
      totalDuration: words.length ? words[words.length - 1].endSec : (targetDurationSec || 20),
    };
  }

  log(`Menghasilkan voice over Gadis ekspresif (${scenes.length} adegan sinkron video)...`);
  const ffmpeg = getFFmpegPath();
  const tempDir = path.join(outDir, `tts_parts_${jobId || Date.now()}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    const parts = await Promise.all(
      scenes.map(async (scene) => {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
          wordBoundaryEnabled: true,
        });

        const isCta = scene.idx === scenes.length - 1;
        const prosody = (scene.emotion === 'excited' || isCta)
          ? { rate: '+10%', pitch: '+5Hz' }
          : scene.emotion === 'emphasis'
          ? { rate: '+7%', pitch: '+4Hz' }
          : scene.emotion === 'soft'
          ? { rate: '+5%', pitch: '+2Hz' }
          : { rate: '+8%', pitch: '+4Hz' };

        const words = [];
        const { audioStream, metadataStream } = tts.toStream(scene.spokenText, prosody);

        metadataStream.on('data', (d) => {
          try {
            const json = JSON.parse(d.toString());
            for (const m of json.Metadata || []) {
              if (m.Type === 'WordBoundary') {
                words.push({
                  word: m.Data.text.Text,
                  startSec: m.Data.Offset / 10000000,
                  durationSec: m.Data.Duration / 10000000,
                  endSec: (m.Data.Offset + m.Data.Duration) / 10000000,
                });
              }
            }
          } catch {}
        });

        const partPath = path.join(tempDir, `part_${scene.idx}.mp3`);
        const writeStream = fs.createWriteStream(partPath);
        audioStream.pipe(writeStream);

        await Promise.all([
          new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            audioStream.on('error', (err) => {
              writeStream.destroy();
              reject(new Error(`Edge TTS part ${scene.idx} error: ${err.message}`));
            });
            writeStream.on('error', (err) => reject(new Error(`Gagal menulis audio part ${scene.idx}: ${err.message}`)));
          }),
          new Promise((resolve) => {
            metadataStream.on('end', resolve);
            setTimeout(resolve, 1500); // Safety fallback timeout
          }),
        ]);

        let dur = words.length ? words[words.length - 1].endSec : 2.5;

        // Fallback safety: If Edge-TTS did not return word boundaries for this scene (e.g. short CTA),
        // synthesize word boundaries proportionally from spokenText so subtitles NEVER disappear!
        if (words.length === 0 && scene.spokenText && scene.spokenText.trim()) {
          const textWords = scene.spokenText.trim().split(/\s+/).filter(Boolean);
          const wordDur = Math.max(0.2, dur / Math.max(1, textWords.length));
          textWords.forEach((tw, twIdx) => {
            words.push({
              word: tw,
              startSec: +(twIdx * wordDur).toFixed(3),
              durationSec: +wordDur.toFixed(3),
              endSec: +((twIdx + 1) * wordDur).toFixed(3),
            });
          });
          dur = textWords.length * wordDur;
        }

        return { ...scene, partPath, words, duration: dur };
      })
    );

    let cursor = 0;
    const globalWords = [];
    const filterInputs = [];
    const filterDelays = [];
    const filterLabels = [];

    const effectiveTarget = Math.max(8, Number(targetDurationSec) || (parts.length * 3.8));
    const totalPartsDur = parts.reduce((sum, p) => sum + p.duration, 0);
    const remainingSlack = Math.max(0, effectiveTarget - totalPartsDur);
    // Natural breath pause between scenes (0.35s to 0.75s)
    const pausePerScene = parts.length > 1
      ? Math.min(0.75, Math.max(0.35, remainingSlack / (parts.length - 1)))
      : 0.35;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      filterInputs.push('-i', `"${p.partPath}"`);

      let startSec = cursor;
      // If targetSec was explicitly specified and fits naturally, align without creating huge dead silence (> 0.9s)
      if (p.targetSec !== null && p.targetSec >= cursor && p.targetSec <= effectiveTarget - p.duration) {
        if (p.targetSec - cursor < 0.9) {
          startSec = p.targetSec;
        }
      }

      // Ensure last scene (CTA) finishes cleanly before effectiveTarget
      if (i === parts.length - 1 && startSec + p.duration > effectiveTarget) {
        startSec = Math.max(cursor, effectiveTarget - p.duration - 0.2);
      }

      const delayMs = Math.max(0, Math.round(startSec * 1000));
      filterDelays.push(`[${i}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
      filterLabels.push(`[a${i}]`);

      for (const w of p.words) {
        globalWords.push({
          word: w.word,
          startSec: +(startSec + w.startSec).toFixed(3),
          endSec: +(startSec + w.endSec).toFixed(3),
        });
      }

      cursor = startSec + p.duration + pausePerScene;
    }

    const mixFilter = `${filterDelays.join(';')};${filterLabels.join('')}amix=inputs=${parts.length}:dropout_transition=0:normalize=0[aout]`;
    const cmd = `"${ffmpeg}" -y ${filterInputs.join(' ')} -filter_complex "${mixFilter}" -map "[aout]" -c:a libmp3lame "${outputPath}"`;

    execSync(cmd, { stdio: 'pipe' });

    parts.forEach((p) => {
      if (fs.existsSync(p.partPath)) fs.unlinkSync(p.partPath);
    });
    if (fs.existsSync(tempDir)) {
      try { fs.rmdirSync(tempDir); } catch {}
    }

    const stats = fs.statSync(outputPath);
    log(`✅ Berhasil menghasilkan voice over Gadis tersinkronisasi! Durasi: ${cursor.toFixed(1)}s`);

    return {
      audioPath: outputPath,
      provider: 'edge_tts',
      voice: 'Gadis (Edge-TTS Neural)',
      modelId: selectedVoice,
      sizeBytes: stats.size,
      cleanScript: subtitleText,
      spokenScript: fullSpokenText,
      wordBoundaries: globalWords,
      totalDuration: cursor,
    };
  } catch (syncErr) {
    console.warn(`[Edge TTS] Multi-scene sync error (${syncErr.message}), falling back to single stream...`);
    if (fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }

    const tts = new MsEdgeTTS();
    await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    });
    const words = [];
    const { audioStream, metadataStream } = tts.toStream(fullSpokenText, { rate: '+8%', pitch: '+4Hz' });
    metadataStream.on('data', (d) => {
      try {
        const json = JSON.parse(d.toString());
        for (const m of json.Metadata || []) {
          if (m.Type === 'WordBoundary') {
            words.push({
              word: m.Data.text.Text,
              startSec: +(m.Data.Offset / 10000000).toFixed(3),
              durationSec: +(m.Data.Duration / 10000000).toFixed(3),
              endSec: +((m.Data.Offset + m.Data.Duration) / 10000000).toFixed(3),
            });
          }
        }
      } catch {}
    });
    const writeStream = fs.createWriteStream(outputPath);
    audioStream.pipe(writeStream);
    await new Promise((res, rej) => {
      writeStream.on('finish', res);
      audioStream.on('error', rej);
    });
    const stats = fs.statSync(outputPath);
    return {
      audioPath: outputPath,
      provider: 'edge_tts',
      voice: 'Gadis (Edge-TTS Neural)',
      modelId: selectedVoice,
      sizeBytes: stats.size,
      cleanScript: subtitleText,
      spokenScript: fullSpokenText,
      wordBoundaries: words,
      totalDuration: words.length ? words[words.length - 1].endSec : (targetDurationSec || 20),
    };
  }
}

/**
 * Generate Voiceover Audio via Fish Audio API (S2.1 Pro)
 * Legacy fallback when TTS_PROVIDER=fish_audio is explicitly set.
 */
export async function generateVoiceoverFishAudio({
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

  log(`Menghasilkan voice over RINDI (${ttsText.length} karakter): "${ttsText.slice(0, 60)}..."`);

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
  log(`✅ Berhasil menghasilkan voice over RINDI! Ukuran: ${(buffer.length / 1024).toFixed(1)} KB`);

  return {
    audioPath: outputPath,
    provider: 'fish_audio',
    voice: 'RINDI',
    modelId: referenceId,
    sizeBytes: buffer.length,
    cleanScript: subtitleText,
    spokenScript: ttsText,
  };
}

/**
 * Main TTS entry point: Defaults to Edge-TTS Gadis (free & unmetered).
 */
export async function generateVoiceoverTTS({
  script,
  outputPath,
  targetDurationSec = null,
  voice = null,
  modelId = null,
  onProgress = null,
  jobId = '',
}) {
  const provider = (process.env.TTS_PROVIDER || 'edge_tts').toLowerCase().trim();
  if (provider === 'fish_audio') {
    return generateVoiceoverFishAudio({ script, outputPath, modelId, onProgress, jobId });
  }
  return generateVoiceoverEdgeTTS({ script, outputPath, targetDurationSec, voice, onProgress, jobId });
}
