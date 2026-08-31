import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getFFmpegPath } from './binaryChecker.js';

/**
 * Stage 1: Renders Gemini-selected 5-second product clips as one vertical 9:16 video
 * with NO AUDIO (-an) and NO SUBTITLES.
 * @param {object} params
 * @param {string} params.inputVideo - Source raw video path
 * @param {string} params.startTime - Trim start (e.g. "00:15")
 * @param {string} params.endTime - Trim end (e.g. "00:55")
 * @param {string} params.outputVideo - Target output .mp4 path
 * @param {Array<{ startTime?: string, endTime?: string, startSeconds?: number, endSeconds?: number, reframe?: object }>} [params.clips] - Gemini cut plan
 * @param {boolean} [params.hflip=false] - Horizontal flip toggle
 * @param {number} [params.speedMultiplier=1] - Speed factor
 * @param {{ focusX?: number, focusY?: number, faceSafety?: boolean, renderMode?: string }} [params.reframe] - Product-aware framing
 * @param {Function} [params.onProgress] - Progress callback
 * @returns {Promise<{ outputPath: string }>}
 */
export async function renderSilentAntiDetectionVideo({
  inputVideo,
  startTime,
  endTime,
  outputVideo,
  clips = [],
  hflip = false,
  speedMultiplier = 1,
  reframe = {},
  onProgress = () => {}
}) {
  const ffmpegPath = getFFmpegPath();
  const outDir = path.dirname(outputVideo);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let targetVideo = inputVideo;
  const isAudioFile = ['.m4a', '.mp3', '.aac', '.wav', '.opus'].some(ext => inputVideo.toLowerCase().endsWith(ext));
  if (isAudioFile || !fs.existsSync(inputVideo)) {
    const parentDir = path.dirname(inputVideo);
    if (fs.existsSync(parentDir)) {
      const candidates = fs.readdirSync(parentDir).filter(f =>
        (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv') || f.endsWith('.mov')) &&
        !f.startsWith('silent_') && !f.startsWith('final_')
      );
      if (candidates.length > 0) {
        targetVideo = path.join(parentDir, candidates[0]);
      }
    }
  }

  onProgress({
    step: 'render_silent',
    message: 'Rendering Gemini-selected faceless full-product 9:16 shots (Muted, No Subtitles)...',
    progress: 60
  });

  return new Promise((resolve, reject) => {
    const selectedClips = normalizeRenderClips(clips, startTime, endTime, reframe);
    const safeSpeedMultiplier = clampNumber(speedMultiplier, 0.5, 2, 1);
    const ptsFactor = (1 / safeSpeedMultiplier).toFixed(4);
    const args = ['-y'];

    for (const clip of selectedClips) {
      const sourceDuration = (clip.duration * safeSpeedMultiplier).toFixed(3);
      args.push('-ss', clip.startSeconds.toFixed(3), '-t', sourceDuration, '-i', targetVideo);
    }

    const filterChains = selectedClips.flatMap((clip, index) =>
      buildClipFilter({
        inputIndex: index,
        outputLabel: `v${index}`,
        reframe: clip.reframe,
        hflip,
        ptsFactor,
      })
    );

    if (selectedClips.length === 1) {
      filterChains.push('[v0]null[outv]');
    } else {
      filterChains.push(`${selectedClips.map((_, index) => `[v${index}]`).join('')}concat=n=${selectedClips.length}:v=1:a=0[outv]`);
    }

    args.push(
      '-filter_complex', filterChains.join(';'),
      '-map', '[outv]',
      '-an', // Strictly NO AUDIO
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '19',
      '-b:v', '5500k',
      '-maxrate', '7500k',
      '-bufsize', '10000k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputVideo
    );

    console.log(`[VideoRenderer Silent] Spawning FFmpeg:\n${ffmpegPath} ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputVideo)) {
        onProgress({
          step: 'render_silent',
          message: `${selectedClips.length} faceless full-product 5-second shots rendered successfully.`,
          progress: 70
        });
        resolve({ outputPath: outputVideo });
      } else {
        reject(new Error(`FFmpeg silent rendering failed with code ${code}: ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg for silent rendering: ${err.message}`));
    });
  });
}

/**
 * Stage 2: Merges uploaded voiceover audio file with the 9:16 silent video and burns synchronized subtitles.
 * @param {object} params
 * @param {string} params.silentVideoPath - Path to 9:16 silent video
 * @param {string} params.voiceoverAudioPath - Uploaded .mp3 voiceover path
 * @param {string} params.srtPath - Synchronized .srt subtitle file path
 * @param {string} params.outputVideoPath - Final output .mp4 path
 * @param {Function} [params.onProgress] - Progress callback
 * @returns {Promise<{ finalPath: string }>}
 */
export async function mergeVoiceoverAndBurnSubtitles({
  silentVideoPath,
  voiceoverAudioPath,
  srtPath,
  outputVideoPath,
  targetDurationSec = null,
  onProgress = () => {}
}) {
  const ffmpegPath = getFFmpegPath();
  const outDir = path.dirname(outputVideoPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const videoDuration = await getMediaDurationSec(silentVideoPath, ffmpegPath) || Number(targetDurationSec) || 45;
  const audioDuration = await getMediaDurationSec(voiceoverAudioPath, ffmpegPath);
  
  // Natural audio tempo constraint:
  // If audio duration is close to video duration (within ~15%), gently adjust tempo (0.88 - 1.2).
  // If audio is noticeably shorter, NEVER slow it down into a weird slow-motion drag.
  // Keep the speaking voice 100% natural (tempo 1.0) and pad silence at the end cleanly with apad.
  let atempoFactor = 1;
  if (audioDuration && videoDuration) {
    const rawRatio = audioDuration / videoDuration;
    if (rawRatio >= 0.88 && rawRatio <= 1.2) {
      atempoFactor = rawRatio;
    } else if (rawRatio > 1.2) {
      atempoFactor = Math.min(1.3, rawRatio);
    } else {
      atempoFactor = 1.0; // Preserve 100% natural human speaking tempo
    }
  }

  onProgress({
    step: 'merge_final',
    message: `Syncing voiceover to video duration (${videoDuration.toFixed(1)}s) and burning subtitles...`,
    progress: 50
  });

  return new Promise((resolve, reject) => {
    const filterChains = [];
    const mapArgs = [];

    if (srtPath && fs.existsSync(srtPath)) {
      const sanitizedSrt = path.resolve(srtPath)
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:');

      if (srtPath.endsWith('.ass')) {
        // Native ASS file: exact resolution (720x1280), FontSize (34), and MarginV (115) defined in file header
        // If the source ASS is 720p, subtitles filter will scale it up automatically for 1080p.
        filterChains.push(`[0:v]subtitles='${sanitizedSrt}'[v]`);
      } else {
        const subtitleStyle = 'FontName=Arial,FontSize=42,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=4.2,Shadow=2.2,Bold=1,Alignment=2,MarginV=172,MarginL=38,MarginR=38';
        filterChains.push(`[0:v]subtitles='${sanitizedSrt}':force_style='${subtitleStyle}'[v]`);
      }
      mapArgs.push('-map', '[v]');
    } else {
      mapArgs.push('-map', '0:v:0');
    }

    const audioFilter = buildAudioFitFilter(atempoFactor, videoDuration);
    filterChains.push(`[1:a]${audioFilter}[a]`);
    mapArgs.push('-map', '[a]');

    const args = [
      '-y',
      '-i', silentVideoPath,
      '-i', voiceoverAudioPath,
    ];

    args.push('-filter_complex', filterChains.join(';'), ...mapArgs);

    args.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '19',
      '-b:v', '5500k',
      '-maxrate', '7500k',
      '-bufsize', '10000k',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-t', videoDuration.toFixed(3),
      '-movflags', '+faststart',
      outputVideoPath
    );

    console.log(`[VideoRenderer Final] Spawning FFmpeg:\n${ffmpegPath} ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputVideoPath)) {
        onProgress({
          step: 'merge_final',
          message: 'Final video with Voiceover & Subtitles rendered successfully!',
          progress: 100
        });
        resolve({ finalPath: outputVideoPath });
      } else {
        console.error(`[VideoRenderer Final] Error:\n${stderr}`);
        // Fallback without subtitle filter if font error occurs
        if (srtPath && (stderr.includes('subtitles') || stderr.includes('font'))) {
          console.warn('[VideoRenderer Final] Subtitle burning issue. Retrying with direct audio merge fallback...');
          return mergeAudioOnlyFallback({
            ffmpegPath,
            silentVideoPath,
            voiceoverAudioPath,
            outputVideoPath,
            videoDuration,
            atempoFactor,
            onProgress,
            resolve,
            reject
          });
        }
        reject(new Error(`FFmpeg final merge failed with code ${code}: ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg for final merge: ${err.message}`));
    });
  });
}

function buildClipFilter({ inputIndex, outputLabel, reframe = {}, hflip, ptsFactor }) {
  const isFlipDisabled = reframe.allowHflip === false || reframe.hasProductBrand === true;
  const clipHflip = isFlipDisabled ? false : (reframe.hflip !== undefined ? reframe.hflip : hflip);
  const renderMode = reframe.renderMode === 'vertical_crop' ? 'vertical_crop' : 'preserve_full_product';
  const preFlip = clipHflip ? 'hflip,' : '';
  const finish = `setsar=1,setpts=${ptsFactor}*PTS,eq=contrast=1.05:saturation=1.05:brightness=0.01`;

  if (renderMode === 'vertical_crop') {
    const focusX = clampNumber(reframe.focusX, 0, 1, 0.5).toFixed(3);
    const focusY = clampNumber(reframe.focusY, 0, 1, 0.55).toFixed(3);
    return [
      `[${inputIndex}:v]${preFlip}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*${focusX}:(ih-1920)*${focusY},${finish}[${outputLabel}]`
    ];
  }

  const focusX = clampNumber(reframe.focusX, 0, 1, 0.5).toFixed(3);
  const focusY = clampNumber(reframe.focusY, 0, 1, 0.5).toFixed(3);

  // Put the source into a larger central square stage, matching the visible product area users expect.
  return [
    `[${inputIndex}:v]${preFlip}split=2[bgsrc${inputIndex}][fgsrc${inputIndex}]`,
    `[bgsrc${inputIndex}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:12,eq=brightness=-0.12:saturation=0.85[bg${inputIndex}]`,
    `[fgsrc${inputIndex}]scale=1080:1560:force_original_aspect_ratio=increase,crop=1080:1560:(iw-1080)*${focusX}:(ih-1560)*${focusY},setsar=1[fg${inputIndex}]`,
    `[bg${inputIndex}][fg${inputIndex}]overlay=(W-w)/2:(H-h)/2,${finish}[${outputLabel}]`,
  ];
}

function normalizeRenderClips(clips, fallbackStartTime, fallbackEndTime, fallbackReframe = {}) {
  const clipLength = 5;
  const sourceClips = Array.isArray(clips) ? clips : [];
  const normalized = [];

  if (sourceClips.length) {
    for (const clip of sourceClips) {
      const startSeconds = parseTimeToSeconds(clip?.startSeconds ?? clip?.startTime);
      const endSeconds = parseTimeToSeconds(clip?.endSeconds ?? clip?.endTime);
      if (!Number.isFinite(startSeconds) || startSeconds < 0) continue;
      if (Number.isFinite(endSeconds) && endSeconds - startSeconds < 4.9) continue;

      normalized.push({
        startSeconds,
        duration: clipLength,
        reframe: {
          ...(fallbackReframe || {}),
          ...(clip?.reframe || {}),
          allowHflip: clip?.allowHflip !== undefined ? clip.allowHflip : clip?.reframe?.allowHflip,
          hasProductBrand: clip?.hasProductBrand !== undefined ? clip.hasProductBrand : clip?.reframe?.hasProductBrand,
        },
      });
      if (normalized.length === 7) break; // Max 7 clips (35s)
    }
  }

  if (normalized.length) return normalized;

  const fallbackStart = parseTimeToSeconds(fallbackStartTime);
  const fallbackEnd = parseTimeToSeconds(fallbackEndTime);
  const fallbackDuration = fallbackEnd > fallbackStart ? fallbackEnd - fallbackStart : (clipLength * 6);
  const clipCount = Math.max(4, Math.min(7, Math.floor(fallbackDuration / clipLength)));

  for (let index = 0; index < clipCount; index++) {
    normalized.push({
      startSeconds: fallbackStart + (index * clipLength),
      duration: clipLength,
      reframe: fallbackReframe,
    });
  }

  return normalized;
}

function parseTimeToSeconds(value) {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  const parts = value.toString().split(':').map(Number);
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function buildAudioFitFilter(atempoFactor, targetDurationSec) {
  return [
    ...buildAtempoFilters(atempoFactor),
    'apad',
    `atrim=0:${targetDurationSec.toFixed(3)}`,
    'asetpts=N/SR/TB',
  ].join(',');
}

function buildAtempoFilters(factor) {
  let remaining = Number.isFinite(factor) ? factor : 1;
  if (Math.abs(remaining - 1) < 0.01) return [];

  const filters = [];
  while (remaining > 2) {
    filters.push('atempo=2.0000');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5000');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) >= 0.01) {
    filters.push(`atempo=${remaining.toFixed(4)}`);
  }
  return filters;
}

export function getMediaDurationSec(filePath, ffmpegPath = getFFmpegPath()) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath]);
    let stderr = '';
    proc.stderr.on('data', (d) => stderr += d.toString());
    proc.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return resolve(null);
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      resolve((hours * 3600) + (minutes * 60) + seconds);
    });
    proc.on('error', () => resolve(null));
  });
}

function mergeAudioOnlyFallback({
  ffmpegPath,
  silentVideoPath,
  voiceoverAudioPath,
  outputVideoPath,
  videoDuration,
  atempoFactor,
  onProgress,
  resolve,
  reject
}) {
  const audioFilter = buildAudioFitFilter(atempoFactor, videoDuration);
  const args = [
    '-y',
    '-i', silentVideoPath,
    '-i', voiceoverAudioPath,
    '-filter_complex', `[1:a]${audioFilter}[a]`,
    '-map', '0:v:0',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', videoDuration.toFixed(3),
    '-movflags', '+faststart',
    outputVideoPath
  ];

  const proc = spawn(ffmpegPath, args);
  let stderr = '';
  proc.stderr.on('data', d => stderr += d.toString());
  proc.on('close', code => {
    if (code === 0 && fs.existsSync(outputVideoPath)) {
      onProgress({ step: 'merge_final', message: 'Final video merged successfully (fallback mode).', progress: 100 });
      resolve({ finalPath: outputVideoPath });
    } else {
      reject(new Error(`Final fallback merge failed: ${stderr.slice(-300)}`));
    }
  });
}
