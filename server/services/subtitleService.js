import fs from 'fs';
import path from 'path';

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file.
 * Native ASS format gives pixel-perfect control over canvas resolution (PlayResX/PlayResY),
 * font size, stroke outline, shadow, and position without relying on inconsistent FFmpeg CLI parsing.
 *
 * @param {string} scriptText - Spoken voiceover narration
 * @param {number} totalDurationSec - Segment duration in seconds
 * @param {string} assOutputPath - Absolute path to write the .ass file
 * @returns {string} The path to the generated ASS file
 */
export function generateAssSubtitles(scriptText, totalDurationSec, assOutputPath) {
  const safeTotalDuration = Math.max(5, Number(totalDurationSec) || 30);

  // 1. Split script into raw lines and extract per-line timestamps & clean spoken text
  const rawLines = (scriptText || '').split(/\r?\n/);
  const lineItems = [];

  for (const rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Skip metadata headers from AI Studio prompt (Scene, Sample Context, Speaker 1)
    if (/^(Scene|Sample Context|Speaker\s*\d*(?:\s*-\s*[A-Za-z0-9]+)?|Setting|Context):?$/i.test(line)) continue;
    if (/^(Studio |Iklan affiliate |Suara |Presenter )/i.test(line) && !line.includes('[') && line.length < 90) {
      continue;
    }

    // Extract leading timestamp if present, e.g. [00:05] or [0:05] or 00:05
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

    lineItems.push({
      text: line,
      timestampSec: timestampSec !== null && timestampSec < safeTotalDuration ? timestampSec : null,
    });
  }

  // Fallback if structured parsing returned nothing
  if (lineItems.length === 0) {
    const rawClean = (scriptText || '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/[#*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (rawClean) {
      lineItems.push({ text: rawClean, timestampSec: null });
    }
  }

  if (lineItems.length === 0) {
    lineItems.push({ text: 'Cek produk pilihan sekarang!', timestampSec: 0 });
  }

  // 2. Break lines into concise subtitle display chunks (max 3 to 4 words each)
  // so subtitles stay neatly on 1 line inside the bottom blurred banner.
  const subtitleChunks = [];

  for (let idx = 0; idx < lineItems.length; idx++) {
    const item = lineItems[idx];
    const words = item.text.split(/\s+/).filter(Boolean);

    if (words.length <= 4) {
      subtitleChunks.push({
        text: words.join(' '),
        wordCount: words.length,
        anchorSec: item.timestampSec,
      });
    } else {
      const chunkSize = words.length <= 8 ? Math.ceil(words.length / 2) : 4;
      for (let w = 0; w < words.length; w += chunkSize) {
        const subWords = words.slice(w, w + chunkSize);
        if (subWords.length > 0) {
          subtitleChunks.push({
            text: subWords.join(' '),
            wordCount: subWords.length,
            anchorSec: w === 0 ? item.timestampSec : null,
          });
        }
      }
    }
  }

  // 3. Assign timing to each subtitle chunk proportionally or based on line anchors
  const totalWords = subtitleChunks.reduce((sum, c) => sum + c.wordCount, 0) || subtitleChunks.length;
  let currentCursor = 0;
  const events = [];

  for (let i = 0; i < subtitleChunks.length; i++) {
    const chunk = subtitleChunks[i];
    let startSec = currentCursor;

    if (chunk.anchorSec !== null && chunk.anchorSec >= currentCursor && chunk.anchorSec < safeTotalDuration) {
      startSec = chunk.anchorSec;
    }

    const nextAnchor = subtitleChunks.slice(i + 1).find((c) => c.anchorSec !== null)?.anchorSec;
    const remainingTime = (nextAnchor ? nextAnchor : safeTotalDuration) - startSec;
    const nextAnchorIndex = nextAnchor ? subtitleChunks.findIndex((c, ci) => ci > i && c.anchorSec === nextAnchor) : subtitleChunks.length;
    const sliceWords = subtitleChunks.slice(i, nextAnchorIndex).reduce((sum, c) => sum + c.wordCount, 0) || chunk.wordCount;

    const proportionalDuration = remainingTime > 0
      ? remainingTime * (chunk.wordCount / sliceWords)
      : safeTotalDuration * (chunk.wordCount / totalWords);

    const endSec = i === subtitleChunks.length - 1
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
  console.log(`[SubtitleService] Generated ${events.length} native ASS subtitle blocks at ${assOutputPath}`);
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
