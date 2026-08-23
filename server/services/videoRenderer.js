import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getFFmpegPath } from './binaryChecker.js';

/**
 * Stage 1: Renders a 30-60s anti-detection vertical 9:16 video with NO AUDIO (-an) and NO SUBTITLES.
 * @param {object} params
 * @param {string} params.inputVideo - Source raw video path
 * @param {string} params.startTime - Trim start (e.g. "00:15")
 * @param {string} params.endTime - Trim end (e.g. "00:55")
 * @param {string} params.outputVideo - Target output .mp4 path
 * @param {boolean} [params.hflip=true] - Horizontal flip toggle
 * @param {number} [params.speedMultiplier=1.03] - Speed factor (1.03x)
 * @param {Function} [params.onProgress] - Progress callback
 * @returns {Promise<{ outputPath: string }>}
 */
export async function renderSilentAntiDetectionVideo({
  inputVideo,
  startTime,
  endTime,
  outputVideo,
  hflip = true,
  speedMultiplier = 1.03,
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
    message: 'Rendering 30-60s Anti-Detection 9:16 vertical video (Muted, No Subtitles)...',
    progress: 60
  });

  return new Promise((resolve, reject) => {
    const ptsFactor = (1 / speedMultiplier).toFixed(4);

    const videoFilters = [
      // Step 1: Crop bottom 15% of original video to remove subscribe/watermark overlays
      'crop=iw:ih*0.85:0:0',
      // Step 2: Scale to fit 720x1280 (9:16) without zooming - pad with black bars if needed
      'scale=720:1280:force_original_aspect_ratio=decrease',
      'pad=720:1280:(ow-iw)/2:(oh-ih)/2:black',
      `setpts=${ptsFactor}*PTS`,
      'eq=contrast=1.05:saturation=1.05:brightness=0.01'
    ];
    if (hflip) videoFilters.push('hflip');

    const args = [
      '-y',
      '-ss', startTime.toString(),
      '-to', endTime.toString(),
      '-i', targetVideo,
      '-vf', videoFilters.join(','),
      '-an', // Strictly NO AUDIO
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputVideo
    ];

    console.log(`[VideoRenderer Silent] Spawning FFmpeg:\n${ffmpegPath} ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputVideo)) {
        onProgress({
          step: 'render_silent',
          message: 'Silent 9:16 Anti-Detection video rendered successfully.',
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
  onProgress = () => {}
}) {
  const ffmpegPath = getFFmpegPath();
  const outDir = path.dirname(outputVideoPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  onProgress({
    step: 'merge_final',
    message: 'Merging uploaded Voiceover & burning high-contrast synchronized subtitles...',
    progress: 50
  });

  return new Promise((resolve, reject) => {
    const videoFilters = [];

    if (srtPath && fs.existsSync(srtPath)) {
      const sanitizedSrt = path.resolve(srtPath)
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:');

      // High-converting mobile reel typography: Bold white text with black outline & dark translucent box
      // Alignment=2 = bottom-center, MarginV=40 = 40px from bottom edge
      const subtitleStyle = 'FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H90000000,BorderStyle=3,Outline=2,Shadow=0,Bold=1,Alignment=2,MarginV=40';
      videoFilters.push(`subtitles='${sanitizedSrt}':force_style='${subtitleStyle}'`);
    }

    const args = [
      '-y',
      '-i', silentVideoPath,
      '-i', voiceoverAudioPath,
    ];

    if (videoFilters.length > 0) {
      args.push('-vf', videoFilters.join(','));
    }

    args.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-shortest',
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

function mergeAudioOnlyFallback({
  ffmpegPath,
  silentVideoPath,
  voiceoverAudioPath,
  outputVideoPath,
  onProgress,
  resolve,
  reject
}) {
  const args = [
    '-y',
    '-i', silentVideoPath,
    '-i', voiceoverAudioPath,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
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
