import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getYtDlpPath } from './binaryChecker.js';

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

    infoProc.on('close', (infoCode) => {
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

      // 2. Download the video file capped at 720p
      const dlArgs = [
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

      dlProc.on('close', (code) => {
        if (code === 0) {
          // Verify file exists
          let downloadedFile = finalExpectedPath;
          if (!fs.existsSync(downloadedFile)) {
            // Check if any file with raw_videoId exists
            const files = fs.readdirSync(outputDir).filter(f => f.startsWith(`raw_${videoId}`));
            if (files.length > 0) {
              downloadedFile = path.join(outputDir, files[0]);
            } else {
              return reject(new Error(`Downloaded file not found in ${outputDir}`));
            }
          }

          onProgress({ step: 'download', message: 'Video download completed successfully.', progress: 35 });
          resolve({ filePath: downloadedFile, metadata });
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
