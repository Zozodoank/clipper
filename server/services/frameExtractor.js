import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getFFmpegPath } from './binaryChecker.js';

/**
 * Extracts 1 frame every 2 seconds from the video and converts selected keyframes to base64.
 * @param {string} videoPath - Path to the local raw mp4 file
 * @param {string} framesDir - Directory to store extracted JPEG frames
 * @param {Function} onProgress - Progress status callback
 * @returns {Promise<{ frames: Array<{ index: number, timestamp: number, timeFormatted: string, base64: string }>, totalFrames: number, framesDir: string }>}
 */
export async function extractFrames(videoPath, framesDir, onProgress = () => {}) {
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  const ffmpegPath = getFFmpegPath();
  const outputPattern = path.join(framesDir, 'frame_%04d.jpg');

  // Guard against audio-only input path
  let targetVideoPath = videoPath;
  const isAudioFile = ['.m4a', '.mp3', '.aac', '.wav', '.opus'].some(ext => videoPath.toLowerCase().endsWith(ext));
  if (isAudioFile || !fs.existsSync(videoPath)) {
    const parentDir = path.dirname(videoPath);
    if (fs.existsSync(parentDir)) {
      const candidates = fs.readdirSync(parentDir).filter(f =>
        (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv') || f.endsWith('.mov')) &&
        !f.startsWith('silent_') && !f.startsWith('final_')
      );
      if (candidates.length > 0) {
        targetVideoPath = path.join(parentDir, candidates[0]);
        console.log(`[FrameExtractor] Auto-resolved video input to: ${targetVideoPath}`);
      }
    }
  }

  onProgress({ step: 'frames', message: 'Extracting video frames (1 frame every 2s)...', progress: 40 });

  return new Promise((resolve, reject) => {
    // Extract 1 frame per 2 seconds, resize to width 480 for fast AI processing & low token usage
    const args = [
      '-y',
      '-i', targetVideoPath,
      // Crop: remove top 5% and bottom 20% to avoid subscribe buttons and watermarks
      // Then scale to 480px width for fast AI processing
      '-vf', 'crop=iw:ih*0.75:0:ih*0.05,fps=1/2,scale=480:-1',
      '-q:v', '3',
      outputPattern
    ];

    console.log(`[FrameExtractor] Spawning FFmpeg: ${ffmpegPath} ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`FFmpeg frame extraction failed with code ${code}: ${stderr}`));
      }

      onProgress({ step: 'frames', message: 'Encoding extracted frames to Base64...', progress: 48 });

      // Read extracted frame files
      const frameFiles = fs.readdirSync(framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();

      if (frameFiles.length === 0) {
        return reject(new Error('No frames were extracted from the video.'));
      }

      // Sample frames intelligently (maximum 20 frames distributed evenly)
      const maxSampleFrames = 20;
      let sampledFiles = [];

      if (frameFiles.length <= maxSampleFrames) {
        sampledFiles = frameFiles;
      } else {
        const step = (frameFiles.length - 1) / (maxSampleFrames - 1);
        for (let i = 0; i < maxSampleFrames; i++) {
          const index = Math.round(i * step);
          if (index < frameFiles.length && !sampledFiles.includes(frameFiles[index])) {
            sampledFiles.push(frameFiles[index]);
          }
        }
      }

      const frames = [];

      for (let i = 0; i < sampledFiles.length; i++) {
        const filename = sampledFiles[i];
        const filePath = path.join(framesDir, filename);

        // Frame index in 1-based order. Each frame represents 2 seconds
        // frame_0001 is at 0s-2s, frame_0002 is at 2s-4s, etc.
        const frameNumber = parseInt(filename.replace('frame_', '').replace('.jpg', ''), 10);
        const timestampInSeconds = Math.max(0, (frameNumber - 1) * 2);

        const mins = Math.floor(timestampInSeconds / 60).toString().padStart(2, '0');
        const secs = Math.floor(timestampInSeconds % 60).toString().padStart(2, '0');
        const timeFormatted = `${mins}:${secs}`;

        const fileBuffer = fs.readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64Data}`;

        frames.push({
          index: i + 1,
          frameNumber,
          timestamp: timestampInSeconds,
          timeFormatted,
          base64: dataUrl,
          filePath,
        });
      }

      onProgress({ step: 'frames', message: `Successfully prepared ${frames.length} key visual frames for AI vision analysis.`, progress: 50 });

      resolve({
        frames,
        totalExtracted: frameFiles.length,
        sampledCount: frames.length,
        framesDir,
      });
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg for frame extraction: ${err.message}`));
    });
  });
}
