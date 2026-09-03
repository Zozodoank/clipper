import fs from 'fs';
import path from 'path';

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file synchronized to the voiceover audio.
 * Native ASS format gives pixel-perfect control over canvas resolution (PlayResX/PlayResY),
 * font size, stroke outline, shadow, and position without relying on inconsistent FFmpeg CLI parsing.
 * 
 * Synchronizes timing directly with the spoken audio duration using syllable/character weighting.
 *
 * @param {string} scriptText - Spoken voiceover narration
 * @param {number} totalDurationSec - Actual voiceover audio duration in seconds
 * @param {string} assOutputPath - Absolute path to write the .ass file
 * @returns {string} The path to the generated ASS file
 */
export function generateAssSubtitles(scriptText, totalDurationSec, assOutputPath) {
  const safeTotalDuration = Math.max(3, Number(totalDurationSec) || 25);

  // 1. Extract pure spoken dialogue and strip headers, prompt instructions, etc.
  let cleaned = String(scriptText || '').trim();

  // If full AI Studio prompt was passed, extract Speaker section
  const speakerMatch = cleaned.match(/(?:Speaker\s*\d*(?:\s*-\s*[A-Za-z0-9]+)?|SPEAKER\s*\d*)[\s\r\n:]+([\s\S]*)$/i);
  if (speakerMatch && speakerMatch[1].trim()) {
    cleaned = speakerMatch[1].trim();
  }

  // Remove metadata lines if any (Scene, Sample Context, Setting, etc.)
  cleaned = cleaned.replace(/^(Scene|Sample Context|Setting|Context):?[^\n]*\n?/gim, '');

  const lines = cleaned.split(/\r?\n/);
  const rawPhrases = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Check for timestamp anchor e.g. [00:05]
    let timestampSec = null;
    const timeMatch = line.match(/^\[?(\d{1,2}):(\d{2})\]?/);
    if (timeMatch) {
      timestampSec = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
      line = line.replace(/^\[?\d{1,2}:\d{2}\]?\s*/, '');
    }

    // Strip emotion tags: [intrigue], [excited], [information], [desire], [confident], [inspiration], [happy], etc.
    line = line.replace(/\[(intrigue|excited|information|desire|confident|inspiration|happy|urgent|curious|hook|demo|problem|value|cta|scene\s*\d*)\]/gi, '');
    line = line.replace(/\[[^\]]+\]/g, '');
    line = line.replace(/^(Speaker\s*\d*|Narasi|Voiceover|VO)\s*[:\-]\s*/i, '');
    line = line.replace(/[#*_~`]/g, '');
    line = line.replace(/^[:\-•*"\s]+/, '').replace(/["\s]+$/, '').trim();
    line = line.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
    // Ensure on-screen subtitles always display standard Indonesian spelling without accents (e.g. kécé -> kece)
    line = line.replace(/[éèê]/g, 'e').replace(/[ÉÈÊ]/g, 'E');
    // Ensure on-screen subtitles never contain "kece" or platform names
    line = line.replace(/\b(?:kece|Kece|KECE)\b/g, 'keren');
    line = line.replace(/\b(?:racun\s+)?(?:tiktok|shopee|instagram|youtube|facebook|reels|medsos)\b/gi, 'belanja');
    line = line.replace(/\b(?:Shopee|TikTok|Instagram|Facebook|YouTube|Reels)\b/gi, '');
    line = line.replace(/\s+/g, ' ').trim();

    if (!line) continue;

    // Split this line into natural sentence/clause chunks by punctuation (. ! ? ;)
    const sentenceMatches = line.match(/[^.!?]+[.!?]+/g) || [line];

    for (let sIdx = 0; sIdx < sentenceMatches.length; sIdx++) {
      const sentence = sentenceMatches[sIdx].trim();
      if (!sentence) continue;

      const words = sentence.split(/\s+/).filter(Boolean);
      if (words.length <= 6) {
        rawPhrases.push({
          text: sentence,
          wordCount: words.length,
          charCount: sentence.replace(/\s+/g, '').length,
          anchorSec: sIdx === 0 ? timestampSec : null,
        });
      } else {
        // Split longer sentences by commas if available, or into 2 clean halves
        const commaParts = sentence.split(/,\s*/);
        if (commaParts.length > 1 && commaParts.every((p) => p.split(/\s+/).length <= 7)) {
          for (let cpIdx = 0; cpIdx < commaParts.length; cpIdx++) {
            const partText = commaParts[cpIdx].trim() + (cpIdx < commaParts.length - 1 ? ',' : '');
            const partWords = partText.split(/\s+/).filter(Boolean);
            if (partWords.length > 0) {
              rawPhrases.push({
                text: partText,
                wordCount: partWords.length,
                charCount: partText.replace(/\s+/g, '').length,
                anchorSec: sIdx === 0 && cpIdx === 0 ? timestampSec : null,
              });
            }
          }
        } else {
          // Split into 2 clean halves
          const half = Math.ceil(words.length / 2);
          const firstHalf = words.slice(0, half).join(' ');
          const secondHalf = words.slice(half).join(' ');
          rawPhrases.push({
            text: firstHalf,
            wordCount: half,
            charCount: firstHalf.replace(/\s+/g, '').length,
            anchorSec: sIdx === 0 ? timestampSec : null,
          });
          if (secondHalf) {
            rawPhrases.push({
              text: secondHalf,
              wordCount: words.length - half,
              charCount: secondHalf.replace(/\s+/g, '').length,
              anchorSec: null,
            });
          }
        }
      }
    }
  }

  // Fallback if structured parsing returned nothing
  if (rawPhrases.length === 0) {
    const rawClean = cleaned
      .replace(/\[[^\]]+\]/g, '')
      .replace(/[#*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (rawClean) {
      rawPhrases.push({
        text: rawClean,
        wordCount: rawClean.split(/\s+/).length,
        charCount: rawClean.replace(/\s+/g, '').length,
        anchorSec: null
      });
    }
  }

  if (rawPhrases.length === 0) {
    rawPhrases.push({ text: 'Cek produk pilihan sekarang!', wordCount: 4, charCount: 24, anchorSec: 0 });
  }

  // 2. Calculate speech weight per phrase based on character count + sentence pause buffer
  // In Indonesian narration, syllables & character count give far more accurate speech pacing than raw word count.
  const weights = rawPhrases.map((p) => {
    const baseWeight = Math.max(8, p.charCount);
    const pauseWeight = p.text.endsWith('?') || p.text.endsWith('!') || p.text.endsWith('.') ? 6 : (p.text.endsWith(',') ? 3 : 0);
    return baseWeight + pauseWeight;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  let currentCursor = 0;
  const events = [];

  for (let i = 0; i < rawPhrases.length; i++) {
    const chunk = rawPhrases[i];
    let startSec = currentCursor;

    if (chunk.anchorSec !== null && chunk.anchorSec >= currentCursor && chunk.anchorSec < safeTotalDuration) {
      startSec = chunk.anchorSec;
    }

    const nextAnchor = rawPhrases.slice(i + 1).find((c) => c.anchorSec !== null)?.anchorSec;
    const remainingTime = (nextAnchor ? nextAnchor : safeTotalDuration) - startSec;
    const nextAnchorIndex = nextAnchor ? rawPhrases.findIndex((c, ci) => ci > i && c.anchorSec === nextAnchor) : rawPhrases.length;
    const sliceWeights = weights.slice(i, nextAnchorIndex).reduce((sum, w) => sum + w, 0) || weights[i];

    const proportionalDuration = remainingTime > 0
      ? remainingTime * (weights[i] / sliceWeights)
      : safeTotalDuration * (weights[i] / totalWeight);

    // Ensure minimum display duration so quick phrases are readable
    const minDisplaySec = Math.min(1.2, safeTotalDuration / rawPhrases.length);
    const endSec = i === rawPhrases.length - 1
      ? safeTotalDuration
      : Math.min(safeTotalDuration, startSec + Math.max(minDisplaySec, proportionalDuration));

    currentCursor = endSec;

    events.push({
      start: formatAssTime(startSec),
      end: formatAssTime(endSec),
      text: chunk.text,
    });
  }

  // Native ASS (Advanced SubStation Alpha) Header with exact 1080x1920 coordinate system
  // Fontsize: 50, Outline: 4.2, Shadow: 2.2, Alignment: 2 (Bottom-Center), MarginV: 172
  // This places bold, highly legible text centered inside the bottom area (y: 1680-1760).
  const assContent = `[Script Info]
Title: TikTok/Reels Affiliate Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,50,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4.2,2.2,2,60,60,172,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.map((e) => `Dialogue: 0,${e.start},${e.end},Default,,0,0,0,,${e.text}`).join('\n')}
`;

  fs.writeFileSync(assOutputPath, assContent, 'utf8');
  console.log(`[SubtitleService] Generated ${events.length} native ASS subtitle blocks synchronized to ${safeTotalDuration.toFixed(1)}s audio at ${assOutputPath}`);
  return assOutputPath;
}

// Backward compatibility alias
export const generateSrtSubtitles = generateAssSubtitles;

function formatAssTime(totalSec) {
  const safeSec = Math.max(0, Number(totalSec) || 0);
  const hours = Math.floor(safeSec / 3600);
  const minutes = Math.floor((safeSec % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(safeSec % 60).toString().padStart(2, '0');
  const centis = Math.floor(((safeSec % 1) * 100)).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}.${centis}`;
}

function formatSrtTime(totalSec) {
  const safeSec = Math.max(0, Number(totalSec) || 0);
  const hours = Math.floor(safeSec / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((safeSec % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(safeSec % 60).toString().padStart(2, '0');
  const millis = Math.floor((safeSec % 1) * 1000).toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${millis}`;
}
