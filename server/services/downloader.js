import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getYtDlpPath, getFFmpegPath } from './binaryChecker.js';

/**
 * Merge separate video and audio files using FFmpeg.
 */
function mergeStreamsWithFfmpeg(videoFile, audioFile, outputFile) {
  const ffmpegPath = getFFmpegPath();
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', videoFile,
      '-i', audioFile,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputFile
    ];
    console.log(`[Downloader] Merging streams with FFmpeg:\n${ffmpegPath} ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => stderr += d.toString());
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputFile)) {
        resolve(outputFile);
      } else {
        reject(new Error(`FFmpeg merge failed with code ${code}: ${stderr.slice(-300)}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Downloads a YouTube video at max 720p resolution using yt-dlp.
 * @param {string} url - YouTube URL
 * @param {string} outputDir - Directory to store the downloaded file
 * @param {string} videoId - Unique identifier for the job
 * @param {Function} onProgress - Progress status callback
 * @returns {Promise<{ filePath: string, metadata: object }>}
 */
export async function downloadYouTubeVideo(url, outputDir, videoId, onProgress = () => {}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ytDlpPath = await getYtDlpPath(onProgress);
  const ffmpegPath = getFFmpegPath();
  const outputTemplate = path.join(outputDir, `raw_${videoId}.%(ext)s`);
  const finalExpectedPath = path.join(outputDir, `raw_${videoId}.mp4`);

  onProgress({ step: 'download', message: 'Fetching video metadata and starting 720p download...', progress: 10 });

  return new Promise((resolve, reject) => {
    // 1. First fetch JSON metadata
    const infoArgs = ['--dump-json', '--no-playlist', url];
    const infoProc = spawn(ytDlpPath, infoArgs);

    let infoData = '';
    let infoErr = '';

    infoProc.stdout.on('data', (data) => {
      infoData += data.toString();
    });

    infoProc.stderr.on('data', (data) => {
      infoErr += data.toString();
    });

    infoProc.on('close', async (infoCode) => {
      let metadata = { title: 'YouTube Video', duration: 60 };
      if (infoCode === 0 && infoData) {
        try {
          const parsed = JSON.parse(infoData);
          metadata = {
            title: parsed.title || 'YouTube Video',
            duration: parsed.duration || 60,
            description: (parsed.description || '').slice(0, 500),
            channel: parsed.uploader || parsed.channel || '',
            tags: parsed.tags || [],
          };
        } catch (e) {
          console.warn('[Downloader] Warning: Could not parse video metadata JSON');
        }
      }

      // 2. Download the video file capped at 720p with explicit ffmpeg-location
      const dlArgs = [
        '--ffmpeg-location',
        ffmpegPath,
        '-f',
        'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best',
        '--merge-output-format',
        'mp4',
        '--no-playlist',
        '-o',
        outputTemplate,
        url,
      ];

      console.log(`[Downloader] Spawning yt-dlp: ${ytDlpPath} ${dlArgs.join(' ')}`);
      onProgress({ step: 'download', message: `Downloading "${metadata.title}" (720p)...`, progress: 20 });

      const dlProc = spawn(ytDlpPath, dlArgs);

      dlProc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        // Parse download percentage if available
        const match = text.match(/(\d+(\.\d+)?)%/);
        if (match) {
          const percent = parseFloat(match[1]);
          const scaledProgress = 20 + Math.round(percent * 0.15); // scales 20% to 35%
          onProgress({ step: 'download', message: `Downloading video: ${Math.round(percent)}%`, progress: scaledProgress });
        }
      });

      let errOutput = '';
      dlProc.stderr.on('data', (chunk) => {
        errOutput += chunk.toString();
      });

      dlProc.on('close', async (code) => {
        if (code === 0) {
          try {
            // Verify file exists
            let downloadedFile = finalExpectedPath;

            if (!fs.existsSync(downloadedFile)) {
              // Find video files (exclude audio files like .m4a, .mp3, .aac)
              const videoFiles = fs.readdirSync(outputDir).filter(f =>
                f.startsWith(`raw_${videoId}`) &&
                !f.endsWith('.m4a') &&
                !f.endsWith('.mp3') &&
                !f.endsWith('.aac') &&
                !f.endsWith('.opus') &&
                !f.endsWith('.part') &&
                !f.endsWith('.ytdl') &&
                (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv') || f.endsWith('.mov'))
              );

              const audioFiles = fs.readdirSync(outputDir).filter(f =>
                f.startsWith(`raw_${videoId}`) &&
                (f.endsWith('.m4a') || f.endsWith('.mp3') || f.endsWith('.aac') || f.endsWith('.opus'))
              );

              if (videoFiles.length > 0) {
                const primaryVideo = path.join(outputDir, videoFiles[0]);
                if (audioFiles.length > 0) {
                  const primaryAudio = path.join(outputDir, audioFiles[0]);
                  onProgress({ step: 'download', message: 'Merging video & audio streams with FFmpeg...', progress: 32 });
                  try {
                    await mergeStreamsWithFfmpeg(primaryVideo, primaryAudio, finalExpectedPath);
                    downloadedFile = finalExpectedPath;
                  } catch (mErr) {
                    console.warn('[Downloader] Stream merge fallback, using video stream directly:', mErr.message);
                    downloadedFile = primaryVideo;
                  }
                } else {
                  downloadedFile = primaryVideo;
                }
              } else {
                return reject(new Error(`Video file not found in ${outputDir} after download.`));
              }
            }

            onProgress({ step: 'download', message: 'Video download completed successfully.', progress: 35 });
            resolve({ filePath: downloadedFile, metadata });
          } catch (resErr) {
            reject(resErr);
          }
        } else {
          reject(new Error(`yt-dlp failed with code ${code}: ${errOutput}`));
        }
      });

      dlProc.on('error', (err) => {
        reject(new Error(`Failed to start yt-dlp: ${err.message}`));
      });
    });

    infoProc.on('error', (err) => {
      console.warn(`[Downloader] Metadata dump error: ${err.message}`);
    });
  });
}
