import fs from 'fs';
import path from 'path';

/**
 * Generates a clean, synchronized SRT subtitle file from voiceover text and target duration.
 * Ensures the subtitle text matches the spoken voiceover word-for-word with accurate timeline syncing.
 * 
 * @param {string} scriptText - Spoken voiceover narration (may contain [00:05] timestamps or emotion tags)
 * @param {number} totalDurationSec - Segment duration in seconds
 * @param {string} srtOutputPath - Absolute path to write the .srt file
 * @returns {string} The path to the generated SRT file
 */
export function generateSrtSubtitles(scriptText, totalDurationSec, srtOutputPath) {
  const safeTotalDuration = Math.max(5, Number(totalDurationSec) || 30);

  if (!scriptText || !scriptText.trim()) {
    fs.writeFileSync(srtOutputPath, `1\n00:00:00,000 --> ${formatSrtTime(safeTotalDuration)}\nCek produk pilihan sekarang!\n`, 'utf8');
    return srtOutputPath;
  }

  // 1. Split script into raw lines and extract per-line timestamps & clean spoken text
  const rawLines = scriptText.split(/\r?\n/);
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

    // Strip section markers like [HOOK 0-3s], [PROBLEM & DEMO], [CALL TO ACTION], etc.
    line = line.replace(/\[[^\]]+\]/g, '');

    // Strip leading speaker prefixes (e.g. "Speaker 1:", "Narasi:")
    line = line.replace(/^(Speaker\s*\d*|Narasi|Voiceover|VO)\s*[:\-]\s*/i, '');

    // Clean formatting characters, markdown, quotes, colons, bullets
    line = line.replace(/[#*_~`]/g, '');
    line = line.replace(/^[:\-•*"\s]+/, '').replace(/["\s]+$/, '').trim();

    // Strip emojis
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
    const rawClean = scriptText
      .replace(/\[[^\]]+\]/g, '')
      .replace(/[#*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (rawClean) {
      lineItems.push({ text: rawClean, timestampSec: null });
    }
  }

  if (lineItems.length === 0) {
    fs.writeFileSync(srtOutputPath, `1\n00:00:00,000 --> ${formatSrtTime(safeTotalDuration)}\nCek produk pilihan sekarang!\n`, 'utf8');
    return srtOutputPath;
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
      // Split into concise 3 to 4 word phrases
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
  let srtContent = '';
  let currentCursor = 0;

  for (let i = 0; i < subtitleChunks.length; i++) {
    const chunk = subtitleChunks[i];
    let startSec = currentCursor;

    if (chunk.anchorSec !== null && chunk.anchorSec >= currentCursor && chunk.anchorSec < safeTotalDuration) {
      startSec = chunk.anchorSec;
    }

    // Find next explicit anchor if available
    const nextAnchor = subtitleChunks.slice(i + 1).find((c) => c.anchorSec !== null)?.anchorSec;
    const remainingTime = (nextAnchor ? nextAnchor : safeTotalDuration) - startSec;
    
    // Count words in current slice
    const nextAnchorIndex = nextAnchor ? subtitleChunks.findIndex((c, ci) => ci > i && c.anchorSec === nextAnchor) : subtitleChunks.length;
    const sliceWords = subtitleChunks.slice(i, nextAnchorIndex).reduce((sum, c) => sum + c.wordCount, 0) || chunk.wordCount;

    const proportionalDuration = remainingTime > 0
      ? remainingTime * (chunk.wordCount / sliceWords)
      : safeTotalDuration * (chunk.wordCount / totalWords);

    const endSec = i === subtitleChunks.length - 1
      ? safeTotalDuration
      : Math.min(safeTotalDuration, startSec + Math.max(1.0, proportionalDuration));

    currentCursor = endSec;

    const startTimeFormatted = formatSrtTime(startSec);
    const endTimeFormatted = formatSrtTime(endSec);

    srtContent += `${i + 1}\n`;
    srtContent += `${startTimeFormatted} --> ${endTimeFormatted}\n`;
    srtContent += `${chunk.text}\n\n`;
  }

  fs.writeFileSync(srtOutputPath, srtContent.trim() + '\n', 'utf8');
  console.log(`[SubtitleService] Generated ${subtitleChunks.length} accurate subtitle blocks at ${srtOutputPath}`);
  return srtOutputPath;
}

function formatSrtTime(totalSec) {
  const safeSec = Math.max(0, Number(totalSec) || 0);
  const hours = Math.floor(safeSec / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((safeSec % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(safeSec % 60).toString().padStart(2, '0');
  const millis = Math.floor((safeSec % 1) * 1000).toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${millis}`;
}
