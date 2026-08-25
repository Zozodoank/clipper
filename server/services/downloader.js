import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getYtDlpPath, getFFmpegPath } from './binaryChecker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

const YOUTUBE_AUTH_ERROR_PATTERN = /(HTTP Error 429|Too Many Requests|Sign in to confirm|not a bot|cookies-from-browser|cookies for the authentication|confirm you)/i;
const DEFAULT_BROWSER_COOKIE_SOURCES = ['chrome', 'edge', 'firefox', 'brave'];

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

function runYtDlp(ytDlpPath, args, { onStdout = null } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onStdout) onStdout(text);
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
  });
}

function isYouTubeAuthError(stderr = '') {
  return YOUTUBE_AUTH_ERROR_PATTERN.test(stderr);
}

function getCookiesFileArgs() {
  const configuredPath = process.env.YTDLP_COOKIES_FILE?.trim();
  const candidates = [
    ...resolveCookieFileCandidates(configuredPath),
    path.join(serverDir, 'cookies.txt'),
    path.join(process.cwd(), 'cookies.txt'),
  ].filter(Boolean);

  const cookiesPath = candidates.find((candidate) => fs.existsSync(candidate));
  return cookiesPath
    ? { label: `cookies file (${cookiesPath})`, args: ['--cookies', cookiesPath] }
    : null;
}

function resolveCookieFileCandidates(configuredPath) {
  if (!configuredPath) return [];
  if (path.isAbsolute(configuredPath)) return [configuredPath];
  return [
    path.resolve(serverDir, configuredPath),
    path.resolve(process.cwd(), configuredPath),
  ];
}

function getBrowserCookieSources() {
  const configured = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (configured && configured.toLowerCase() === 'none') return [];

  const configuredBrowsers = configured
    ? configured.split(',').map((item) => item.trim()).filter(Boolean)
    : [];

  const browsers = [...configuredBrowsers, ...DEFAULT_BROWSER_COOKIE_SOURCES]
    .filter((browser, index, list) => list.indexOf(browser) === index);

  return browsers.map((browser) => ({
    label: `browser cookies (${browser})`,
    args: ['--cookies-from-browser', browser],
  }));
}

function getCookieSources() {
  return [
    getCookiesFileArgs(),
    ...getBrowserCookieSources(),
  ].filter(Boolean);
}

function buildYtDlpArgs(args, cookieSource = null) {
  return [
    ...(cookieSource?.args || []),
    '--extractor-args',
    'youtube:player_client=default,ios',
    ...args,
  ];
}

async function runWithCookieFallback({
  ytDlpPath,
  baseArgs,
  onProgress,
  onStdout,
  actionLabel,
}) {
  let result = await runYtDlp(ytDlpPath, buildYtDlpArgs(baseArgs), { onStdout });
  if (result.code === 0 || !isYouTubeAuthError(result.stderr)) {
    return { ...result, cookieSource: null };
  }

  const cookieSources = getCookieSources();
  for (const cookieSource of cookieSources) {
    onProgress({
      step: 'download',
      message: `YouTube meminta verifikasi. Mencoba ${actionLabel} dengan ${cookieSource.label}...`,
      progress: 18,
    });

    result = await runYtDlp(
      ytDlpPath,
      buildYtDlpArgs(baseArgs, cookieSource),
      { onStdout }
    );

    if (result.code === 0) {
      return { ...result, cookieSource };
    }
  }

  return { ...result, cookieSource: null };
}

function formatYtDlpError(code, stderr) {
  if (isYouTubeAuthError(stderr)) {
    return [
      `yt-dlp failed with code ${code}: YouTube meminta verifikasi anti-bot / login.`,
      'Solusi cepat:',
      '1. Login YouTube di Chrome atau Edge pada komputer ini.',
      '2. Tutup browser tersebut agar cookies bisa dibaca.',
      '3. Jalankan ulang generate.',
      '',
      'Opsional: set YTDLP_COOKIES_FROM_BROWSER=chrome atau edge di server/.env.',
      'Alternatif: export cookies YouTube ke server/cookies.txt.',
      '',
      stderr.slice(-1200),
    ].join('\n');
  }

  return `yt-dlp failed with code ${code}: ${stderr}`;
}

/**
 * Searches YouTube through yt-dlp without the official YouTube API.
 * @param {string} query - Search query text
 * @param {{ limit?: number, onProgress?: Function }} options
 * @returns {Promise<Array<{ id: string, title: string, url: string, duration: number, channel: string, description: string }>>}
 */
export async function searchYouTubeVideos(query, { limit = 10, onProgress = () => {} } = {}) {
  const reportProgress = (data) => {
    if (typeof data === 'string') {
      onProgress({ step: 'auto_youtube_search', message: data, progress: 5 });
    } else {
      onProgress(data);
    }
  };
  const ytDlpPath = await getYtDlpPath(reportProgress);
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  const searchTarget = `ytsearch${safeLimit}:${query}`;

  reportProgress({
    step: 'auto_youtube_search',
    message: `Searching YouTube candidates: ${query}`,
    progress: 8,
  });

  const baseArgs = ['--flat-playlist', '--dump-json', '--skip-download', searchTarget];
  let result = await runYtDlp(ytDlpPath, baseArgs);
  if (result.code !== 0 && isYouTubeAuthError(result.stderr)) {
    for (const cookieSource of getCookieSources()) {
      reportProgress({
        step: 'auto_youtube_search',
        message: `YouTube meminta verifikasi. Mencoba search dengan ${cookieSource.label}...`,
        progress: 9,
      });
      result = await runYtDlp(ytDlpPath, [...cookieSource.args, ...baseArgs]);
      if (result.code === 0) break;
    }
  }

  if (result.code !== 0) {
    throw new Error(formatYtDlpError(result.code, result.stderr));
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      title: item.title || 'YouTube Video',
      url: item.webpage_url || item.original_url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : ''),
      duration: Number(item.duration) || 0,
      channel: item.uploader || item.channel || '',
      description: (item.description || '').slice(0, 500),
    }))
    .filter((item) => item.id && item.url && item.duration >= 20 && item.duration <= 900);
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
    (async () => {
      // 1. First fetch JSON metadata
      const infoArgs = ['--dump-json', '--no-playlist', url];
      const infoResult = await runWithCookieFallback({
        ytDlpPath,
        baseArgs: infoArgs,
        onProgress,
        actionLabel: 'metadata',
      });

      let metadata = { title: 'YouTube Video', duration: 60 };
      if (infoResult.code === 0 && infoResult.stdout) {
        try {
          const parsed = JSON.parse(infoResult.stdout);
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
      } else if (isYouTubeAuthError(infoResult.stderr)) {
        console.warn('[Downloader] Metadata requires cookies/auth; continuing to download fallback.');
      }

      // 2. Download the video file capped at 720p with explicit ffmpeg-location and Windows-safe flags
      const dlArgs = [
        '--ffmpeg-location',
        ffmpegPath,
        '-f',
        'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best',
        '--merge-output-format',
        'mp4',
        '--no-playlist',
        '--no-part',             // Disables .part file creation to prevent Windows [WinError 32] file locking on rename
        '--no-mtime',            // Avoids timestamp modification lock
        '--windows-filenames',   // Ensures fully compliant Windows filenames
        '--retries', '5',
        '--fragment-retries', '5',
        '-o',
        outputTemplate,
        url,
      ];

      console.log(`[Downloader] Spawning yt-dlp: ${ytDlpPath} ${dlArgs.join(' ')}`);
      onProgress({ step: 'download', message: `Downloading "${metadata.title}" (720p)...`, progress: 20 });

      const downloadResult = await runWithCookieFallback({
        ytDlpPath,
        baseArgs: dlArgs,
        onProgress,
        actionLabel: 'download',
        onStdout: (text) => {
          const match = text.match(/(\d+(\.\d+)?)%/);
          if (match) {
            const percent = parseFloat(match[1]);
            const scaledProgress = 20 + Math.round(percent * 0.15); // scales 20% to 35%
            onProgress({ step: 'download', message: `Downloading video: ${Math.round(percent)}%`, progress: scaledProgress });
          }
        },
      });

      if (downloadResult.code === 0) {
        if (downloadResult.cookieSource) {
          console.log(`[Downloader] yt-dlp succeeded with ${downloadResult.cookieSource.label}.`);
        }

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
          return;
      }

      reject(new Error(formatYtDlpError(downloadResult.code, downloadResult.stderr)));
    })().catch(reject);
  });
}
