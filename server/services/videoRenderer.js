import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getFFmpegPath } from './binaryChecker.js';

/**
 * Renders the final 9:16 anti-detection vertical video using FFmpeg.
 * @param {object} params
 * @param {string} params.inputVideo - Source raw video path
 * @param {string} params.startTime - Trim start (e.g. "00:15" or seconds)
 * @param {string} params.endTime - Trim end (e.g. "00:40" or seconds)
 * @param {string} params.outputVideo - Target output .mp4 path
 * @param {string} [params.customAudio] - Optional path to audio file
 * @param {string} [params.srtPath] - Path to .srt subtitle file
 * @param {boolean} [params.hflip=true] - Whether to apply horizontal flip
 * @param {number} [params.speedMultiplier=1.03] - Speed adjustment (1.03x)
 * @param {Function} [params.onProgress] - Progress callback
 * @returns {Promise<{ outputPath: string }>}
 */
export async function renderAntiDetectionVideo({
  inputVideo,
  startTime,
  endTime,
  outputVideo,
  customAudio = null,
  srtPath = null,
  hflip = true,
  speedMultiplier = 1.03,
  onProgress = () => {}
}) {
  const ffmpegPath = getFFmpegPath();

  const outDir = path.dirname(outputVideo);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  onProgress({
    step: 'render',
    message: 'Rendering 9:16 Anti-Detection vertical video (Crop 720x1280, 1.03x speed, color tweak)...',
    progress: 82
  });

  return new Promise((resolve, reject) => {
    // Speed factor: 1.03x speed = 1 / 1.03 ≈ 0.97087 PTS
    const ptsFactor = (1 / speedMultiplier).toFixed(4);
    const audioTempo = speedMultiplier.toFixed(2);

    // Build video filter chain:
    // 1. Crop & scale to 9:16 (720x1280)
    // 2. Speed alteration with setpts
    // 3. Color fingerprint alteration (contrast=1.05:saturation=1.05:brightness=0.01)
    // 4. Horizontal flip (if enabled)
    // 5. Subtitles (if enabled)
    const videoFilters = [
      'crop=ih*9/16:ih:(iw-ih*9/16)/2:0',
      'scale=720:1280',
      `setpts=${ptsFactor}*PTS`,
      'eq=contrast=1.05:saturation=1.05:brightness=0.01'
    ];

    if (hflip) {
      videoFilters.push('hflip');
    }

    if (srtPath && fs.existsSync(srtPath)) {
      const sanitizedSrt = path.resolve(srtPath)
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:');

      const subtitleStyle = 'FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H90000000,BorderStyle=3,Outline=2,Shadow=0,Bold=1,Alignment=2,MarginV=70';
      videoFilters.push(`subtitles='${sanitizedSrt}':force_style='${subtitleStyle}'`);
    }

    const vfString = videoFilters.join(',');

    const args = ['-y'];
    if (startTime) args.push('-ss', startTime.toString());
    if (endTime) args.push('-to', endTime.toString());
    args.push('-i', inputVideo);

    const hasCustomAudio = customAudio && fs.existsSync(customAudio);
    if (hasCustomAudio) {
      args.push('-i', customAudio);
      const filterComplex = `[0:v]${vfString}[v];[0:a]volume=0.15,atempo=${audioTempo}[bg];[1:a]volume=1.0[voice];[bg][voice]amix=inputs=2:duration=first[a]`;
      args.push('-filter_complex', filterComplex, '-map', '[v]', '-map', '[a]');
    } else {
      args.push('-vf', vfString);
      args.push('-af', `atempo=${audioTempo}`);
    }

    args.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputVideo
    );

    console.log(`[VideoRenderer] Spawning FFmpeg:\n${ffmpegPath} ${args.join(' ')}`);

    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;

      const match = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        onProgress({ step: 'render', message: `Rendering 9:16 anti-detection video: ${match[0]}`, progress: 92 });
      }
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputVideo)) {
        onProgress({ step: 'render', message: '9:16 Anti-Detection video rendered successfully!', progress: 98 });
        resolve({ outputPath: outputVideo });
      } else {
        console.error(`[VideoRenderer] Error output:\n${stderr}`);
        // Fallback retry without subtitle filter if subtitle library failed
        if (srtPath && (stderr.includes('subtitles') || stderr.includes('font'))) {
          console.warn('[VideoRenderer] Subtitle filter issue encountered. Retrying rendering without burned subtitles filter...');
          return renderFallbackSimple({
            ffmpegPath,
            inputVideo,
            startTime,
            endTime,
            outputVideo,
            customAudio,
            hflip,
            ptsFactor,
            audioTempo,
            onProgress,
            resolve,
            reject
          });
        }
        reject(new Error(`FFmpeg rendering failed with code ${code}: ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg video renderer: ${err.message}`));
    });
  });
}

function renderFallbackSimple({
  ffmpegPath,
  inputVideo,
  startTime,
  endTime,
  outputVideo,
  customAudio,
  hflip,
  ptsFactor,
  audioTempo,
  onProgress,
  resolve,
  reject
}) {
  const videoFilters = [
    'crop=ih*9/16:ih:(iw-ih*9/16)/2:0',
    'scale=720:1280',
    `setpts=${ptsFactor}*PTS`,
    'eq=contrast=1.05:saturation=1.05:brightness=0.01'
  ];
  if (hflip) videoFilters.push('hflip');
  const vfString = videoFilters.join(',');

  const args = ['-y'];
  if (startTime) args.push('-ss', startTime.toString());
  if (endTime) args.push('-to', endTime.toString());
  args.push('-i', inputVideo);

  if (customAudio && fs.existsSync(customAudio)) {
    args.push('-i', customAudio);
    const filterComplex = `[0:v]${vfString}[v];[0:a]volume=0.15,atempo=${audioTempo}[bg];[1:a]volume=1.0[voice];[bg][voice]amix=inputs=2:duration=first[a]`;
    args.push('-filter_complex', filterComplex, '-map', '[v]', '-map', '[a]');
  } else {
    args.push('-vf', vfString, '-af', `atempo=${audioTempo}`);
  }

  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputVideo);

  const proc = spawn(ffmpegPath, args);
  let stderr = '';
  proc.stderr.on('data', d => stderr += d.toString());
  proc.on('close', code => {
    if (code === 0 && fs.existsSync(outputVideo)) {
      onProgress({ step: 'render', message: 'Video rendered successfully in fallback mode.', progress: 98 });
      resolve({ outputPath: outputVideo });
    } else {
      reject(new Error(`Fallback rendering failed: ${stderr.slice(-300)}`));
    }
  });
}
