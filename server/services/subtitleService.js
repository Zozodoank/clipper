import fs from 'fs';
import path from 'path';

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file.
 * Native ASS format gives pixel-perfect control over canvas resolution (PlayResX/PlayResY),
 * font size, stroke outline, shadow, and position without relying on inconsistent FFmpeg CLI parsing.
 * 
 * Ensures the generated subtitles match the exact spoken voiceover word-for-word in natural sentences.
 *
 * @param {string} scriptText - Spoken voiceover narration
 * @param {number} totalDurationSec - Segment duration in seconds
 * @param {string} assOutputPath - Absolute path to write the .ass file
 * @returns {string} The path to the generated ASS file
 */
export function generateAssSubtitles(scriptText, totalDurationSec, assOutputPath) {
  const safeTotalDuration = Math.max(5, Number(totalDurationSec) || 30);

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
            anchorSec: sIdx === 0 ? timestampSec : null,
          });
          if (secondHalf) {
            rawPhrases.push({
              text: secondHalf,
              wordCount: words.length - half,
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
      rawPhrases.push({ text: rawClean, wordCount: rawClean.split(/\s+/).length, anchorSec: null });
    }
  }

  if (rawPhrases.length === 0) {
    rawPhrases.push({ text: 'Cek produk pilihan sekarang!', wordCount: 4, anchorSec: 0 });
  }

  // 2. Assign timing to each subtitle chunk proportionally or based on line anchors
  const totalWords = rawPhrases.reduce((sum, c) => sum + c.wordCount, 0) || rawPhrases.length;
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
    const sliceWords = rawPhrases.slice(i, nextAnchorIndex).reduce((sum, c) => sum + c.wordCount, 0) || chunk.wordCount;

    const proportionalDuration = remainingTime > 0
      ? remainingTime * (chunk.wordCount / sliceWords)
      : safeTotalDuration * (chunk.wordCount / totalWords);

    const endSec = i === rawPhrases.length - 1
      ? safeTotalDuration
      : Math.min(safeTotalDuration, startSec + Math.max(1.0, proportionalDuration));

    currentCursor = endSec;

    events.push({
      start: formatAssTime(startSec),
      end: formatAssTime(endSec),
      text: chunk.text,
    });
  }

  // Native ASS (Advanced SubStation Alpha) Header with exact 720x1280 coordinate system
  // Fontsize: 34, Outline: 2.8, Shadow: 1.5, Alignment: 2 (Bottom-Center), MarginV: 115
  // This places bold, highly legible text centered inside the bottom blur area (y: 1115-1165).
  const assContent = `[Script Info]
Title: TikTok/Reels Affiliate Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,34,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,2.8,1.5,2,40,40,115,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.map((e) => `Dialogue: 0,${e.start},${e.end},Default,,0,0,0,,${e.text}`).join('\n')}
`;

  fs.writeFileSync(assOutputPath, assContent, 'utf8');
  console.log(`[SubtitleService] Generated ${events.length} native ASS subtitle blocks from exact spoken script at ${assOutputPath}`);
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
