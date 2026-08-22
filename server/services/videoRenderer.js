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
 * @param {string} [params.ttsAudio] - Path to TTS .mp3 voiceover file
 * @param {string} [params.srtPath] - Path to .srt subtitle file
 * @param {boolean} [params.hflip=true] - Whether to apply horizontal flip
 * @param {number} [params.speedMultiplier=1.03] - Speed adjustment (1.03x)
 * @param {Function} [params.onProgress] - Progress callback
 * @returns {Promise<{ outputPath: string, duration: number }>}
 */
export async function renderAntiDetectionVideo({
  inputVideo,
  startTime,
  endTime,
  outputVideo,
  ttsAudio = null,
  srtPath = null,
  hflip = true,
  speedMultiplier = 1.03,
  onProgress = () => {}
}) {
  const ffmpegPath = getFFmpegPath();

  // Ensure output directory exists
  const outDir = path.dirname(outputVideo);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  onProgress({ step: 'render', message: 'Starting FFmpeg Anti-Detection Rendering Pipeline (9:16, speed, eq, tts, subs)...', progress: 82 });

  return new Promise((resolve, reject) => {
    // 1. Calculate PTS factor for speed: 1.03x speed = 1 / 1.03 ≈ 0.97087 PTS
    const ptsFactor = (1 / speedMultiplier).toFixed(4);
    const audioTempo = speedMultiplier.toFixed(2);

    // 2. Build video filter chain:
    // a. Crop & scale to 9:16 (720x1280)
    // b. Alter speed with setpts
    // c. Color fingerprint alteration (contrast=1.05:saturation=1.05:brightness=0.01)
    // d. Horizontal flip (if enabled)
    // e. Burn subtitles
    const videoFilters = [];

    // 9:16 Portrait crop & scale: crop to center 9:16 area then scale to exact 720x1280
    videoFilters.push('crop=ih*9/16:ih:(iw-ih*9/16)/2:0');
    videoFilters.push('scale=720:1280');
    videoFilters.push(`setpts=${ptsFactor}*PTS`);
    videoFilters.push('eq=contrast=1.05:saturation=1.05:brightness=0.01');

    if (hflip) {
      videoFilters.push('hflip');
    }

    // Subtitle burning if SRT exists
    if (srtPath && fs.existsSync(srtPath)) {
      // Escape path for ffmpeg filter string across platforms (especially Windows)
      const sanitizedSrt = path.resolve(srtPath)
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:');

      const subtitleStyle = 'FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H90000000,BorderStyle=3,Outline=2,Shadow=0,Bold=1,Alignment=2,MarginV=70';
      videoFilters.push(`subtitles='${sanitizedSrt}':force_style='${subtitleStyle}'`);
    }

    const vfString = videoFilters.join(',');

    // 3. Build FFmpeg command arguments
    const args = ['-y'];

    // Input 0: Raw video trimmed with -ss and -to
    if (startTime) args.push('-ss', startTime.toString());
    if (endTime) args.push('-to', endTime.toString());
    args.push('-i', inputVideo);

    const hasTts = ttsAudio && fs.existsSync(ttsAudio);
    if (hasTts) {
      // Input 1: TTS voiceover audio
      args.push('-i', ttsAudio);
    }

    // Audio & Video filter complex or direct mapping
    if (hasTts) {
      // Mix background audio (ducked to 15%) + TTS voiceover (100%)
      const filterComplex = `[0:v]${vfString}[v];[0:a]volume=0.15,atempo=${audioTempo}[bg];[1:a]volume=1.0[voice];[bg][voice]amix=inputs=2:duration=first:dropout_transition=2[a]`;
      args.push('-filter_complex', filterComplex);
      args.push('-map', '[v]');
      args.push('-map', '[a]');
    } else {
      // Video filter + original audio adjusted
      args.push('-vf', vfString);
      args.push('-af', `atempo=${audioTempo}`);
    }

    // Output encoding configurations
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

      // Extract time= to track progress if possible
      const match = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        onProgress({ step: 'render', message: `Rendering 9:16 anti-detection video: ${match[0]}`, progress: 90 });
      }
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputVideo)) {
        onProgress({ step: 'render', message: '9:16 Anti-Detection video rendering completed successfully!', progress: 98 });
        resolve({ outputPath: outputVideo });
      } else {
        console.error(`[VideoRenderer] Error output:\n${stderr}`);
        // If subtitle filter specifically errored due to font or library, retry once without subtitles filter as fallback
        if (srtPath && stderr.includes('subtitles')) {
          console.warn('[VideoRenderer] Subtitle filter issue encountered. Retrying rendering without burned subtitles fallback...');
          return renderWithoutSubtitlesFallback({
            ffmpegPath,
            inputVideo,
            startTime,
            endTime,
            outputVideo,
            ttsAudio,
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

function renderWithoutSubtitlesFallback({
  ffmpegPath,
  inputVideo,
  startTime,
  endTime,
  outputVideo,
  ttsAudio,
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

  const hasTts = ttsAudio && fs.existsSync(ttsAudio);
  if (hasTts) {
    args.push('-i', ttsAudio);
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
      onProgress({ step: 'render', message: 'Rendered video successfully (fallback mode)', progress: 98 });
      resolve({ outputPath: outputVideo });
    } else {
      reject(new Error(`Fallback rendering failed: ${stderr.slice(-300)}`));
    }
  });
}
