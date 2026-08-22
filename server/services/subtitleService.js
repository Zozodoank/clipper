import fs from 'fs';
import path from 'path';

/**
 * Generates an SRT subtitle file from voiceover text and target duration.
 * @param {string} scriptText - Indonesian promotional script
 * @param {number} totalDurationSec - Segment duration in seconds
 * @param {string} srtOutputPath - Absolute path to write the .srt file
 * @returns {string} The path to the generated SRT file
 */
export function generateSrtSubtitles(scriptText, totalDurationSec, srtOutputPath) {
  if (!scriptText || !scriptText.trim()) {
    // Return empty SRT if no text
    fs.writeFileSync(srtOutputPath, '1\n00:00:00,000 --> 00:00:05,000\nRacun Shopee Viral\n');
    return srtOutputPath;
  }

  // Clean script text: remove markdown, quotes, emojis for subtitle readability
  const cleaned = scriptText
    .replace(/[#*_~`]/g, '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .trim();

  // Split into natural sentences or chunks of 4-7 words
  const rawSentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  const phrases = [];

  for (const sentence of rawSentences) {
    const words = sentence.trim().split(/\s+/);
    if (words.length <= 7) {
      if (words.join(' ').trim()) phrases.push(words.join(' ').trim());
    } else {
      // Split into sub-chunks of 4-6 words
      for (let i = 0; i < words.length; i += 5) {
        const chunk = words.slice(i, i + 5).join(' ').trim();
        if (chunk) phrases.push(chunk);
      }
    }
  }

  if (phrases.length === 0) {
    phrases.push('Cek link Shopee sekarang!');
  }

  const durationPerPhrase = totalDurationSec / phrases.length;
  let srtContent = '';

  for (let i = 0; i < phrases.length; i++) {
    const startSec = i * durationPerPhrase;
    const endSec = Math.min(totalDurationSec, (i + 1) * durationPerPhrase);

    const startTimeFormatted = formatSrtTime(startSec);
    const endTimeFormatted = formatSrtTime(endSec);

    srtContent += `${i + 1}\n`;
    srtContent += `${startTimeFormatted} --> ${endTimeFormatted}\n`;
    srtContent += `${phrases[i]}\n\n`;
  }

  fs.writeFileSync(srtOutputPath, srtContent.trim() + '\n', 'utf8');
  console.log(`[SubtitleService] Generated SRT subtitles at ${srtOutputPath}`);
  return srtOutputPath;
}

function formatSrtTime(totalSec) {
  const hours = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSec % 60).toString().padStart(2, '0');
  const millis = Math.floor((totalSec % 1) * 1000).toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${millis}`;
}
