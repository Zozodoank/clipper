import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getYtDlpPath, getFFmpegPath } from './binaryChecker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

const IS_LINUX = process.platform === 'linux';

// Cookies file path - used by yt-dlp to authenticate as a real YouTube session
const COOKIES_PATH = path.join(serverDir, 'cookies.txt');
const cookiesArgs = fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : [];
if (cookiesArgs.length) {
  console.log('[Downloader] YouTube cookies file found, will use for yt-dlp authentication.');
} else {
  console.warn('[Downloader] WARNING: cookies.txt not found at', COOKIES_PATH);
}

/**
 * Returns yt-dlp args that work seamlessly through proxy or Cloudflare WARP.
 */
function getYtDlpArgs() {
  // Do NOT use WARP proxy here - it gets rate-limited (429) by Google quickly.
  // Instead use tv_embedded client which is more permissive from datacenter IPs.
  return [
    '--extractor-args', 'youtube:player_client=android,tv_embedded;player_skip=configs',
    '--no-check-certificates',
    '--geo-bypass'
  ];
}


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

export function extractVideoId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// ── RapidAPI Search Helper ──────────────────────────────────────────────────

async function searchWithRapidApi(query, limit = 10) {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  const host = process.env.RAPIDAPI_HOST?.trim() || 'yt-api.p.rapidapi.com';
  if (!apiKey) return null;

  try {
    console.log(`[Downloader] Searching YouTube via RapidAPI: "${query}"`);
    const res = await fetch(`https://${host}/search?query=${encodeURIComponent(query)}`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': host
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.data || data.results || [];
    return items
      .filter(item => item.type === 'video' || item.videoId || item.id)
      .slice(0, limit)
      .map(item => ({
        id: item.videoId || item.id,
        title: item.title || 'YouTube Video',
        url: item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : (item.url || ''),
        duration: Number(item.lengthSeconds || item.duration) || 60,
        channel: item.channelTitle || item.author || '',
        description: (item.description || '').slice(0, 500)
      }))
      .filter(item => item.id && item.url);
  } catch (e) {
    return null;
  }
}

// ── YouTube Downloader via RapidAPI (yt-api) ──

async function downloadWithYouTubeMediaDownloader(url, outputPath, onProgress) {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  const host = process.env.RAPIDAPI_HOST?.trim() || 'yt-api.p.rapidapi.com';
  if (!apiKey) return null;

  const videoId = extractVideoId(url);
  if (!videoId) return null;

  try {
    onProgress({ step: 'download', message: 'Fetching video stream link from RapidAPI...', progress: 12 });

    const detailRes = await fetch(`https://${host}/dl?id=${videoId}`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': host
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!detailRes.ok) {
      console.warn(`[Downloader] yt-api returned HTTP ${detailRes.status}`);
      return null;
    }

    const data = await detailRes.json();
    if (!data.formats || data.formats.length === 0) {
      console.warn(`[Downloader] yt-api error: No formats returned`);
      return null;
    }

    const metadata = {
      title: data.title || 'YouTube Video',
      duration: Math.round(Number(data.lengthSeconds) || 60),
      description: (data.description || '').slice(0, 500),
      channel: data.channelTitle || '',
      tags: []
    };

    // Pick best combined audio+video format at <=720p (itag 22 or 18)
    let best = data.formats.find(f => f.qualityLabel === '720p' && f.audioQuality) ||
               data.formats.find(f => f.qualityLabel === '360p' && f.audioQuality) ||
               data.formats.find(f => f.audioQuality) || 
               data.formats[0];

    onProgress({ step: 'download', message: `Downloading video via RapidAPI stream (${best.qualityLabel || '360p'})...`, progress: 18 });
    console.log(`[Downloader] yt-api stream: ${best.qualityLabel}, hasAudio=${!!best.audioQuality}`);

    // Use yt-dlp to download from the direct CDN URL (no YouTube auth needed).
    // yt-dlp's generic downloader handles googlevideo.com URLs without IP binding checks.
    const ytDlpPath = getYtDlpPath();
    await new Promise((resolve, reject) => {
      const ytdlpArgs = [
        '--no-check-certificates',
        '--no-playlist',
        '--no-part',
        '--no-mtime',
        '-o', outputPath,
        best.url
      ];
      console.log(`[Downloader] yt-dlp CDN download: ${ytDlpPath} ${ytdlpArgs.slice(-2).join(' ')}`);
      const proc = spawn(ytDlpPath, ytdlpArgs);
      
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          resolve();
        } else {
          console.warn(`[Downloader] yt-dlp CDN download failed (code ${code}): ${stderr.slice(-200)}`);
          reject(new Error(`yt-dlp CDN download failed`));
        }
      });
      proc.on('error', reject);
    });

    return { filePath: outputPath, metadata };
  } catch (e) {
    console.warn(`[Downloader] RapidAPI download error: ${e.message}`);
    return null;
  }
}


/**
 * Searches YouTube candidates using RapidAPI or direct Android API client.
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

  // 1. Prioritize RapidAPI search if key is configured
  const rapidResults = await searchWithRapidApi(query, limit);
  if (rapidResults && rapidResults.length > 0) {
    return rapidResults;
  }

  // 2. Fallback to direct Android API yt-dlp search
  const ytDlpPath = await getYtDlpPath(reportProgress);
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  const searchTarget = `ytsearch${safeLimit}:${query}`;

  reportProgress({
    step: 'auto_youtube_search',
    message: `Searching YouTube candidates: ${query}`,
    progress: 8,
  });

  const baseArgs = [
    ...getYtDlpArgs(),
    '--flat-playlist',
    '--dump-json',
    '--skip-download',
    searchTarget
  ];
  const result = await runYtDlp(ytDlpPath, baseArgs);

  if (result.code !== 0) {
    throw new Error(`yt-dlp search failed with code ${result.code}: ${result.stderr.slice(-400)}`);
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
 * Downloads a YouTube video using native Android protocol in Codespaces.
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

  const finalExpectedPath = path.join(outputDir, `raw_${videoId}.mp4`);

  // 1. Try YouTube Media Downloader API first (CDN-proxied, works from any cloud IP)
  const mediaDlResult = await downloadWithYouTubeMediaDownloader(url, finalExpectedPath, onProgress);
  if (mediaDlResult && fs.existsSync(mediaDlResult.filePath)) {
    onProgress({ step: 'download', message: 'Video download completed successfully via RapidAPI.', progress: 35 });
    return mediaDlResult;
  }

  // 2. Fallback to direct yt-dlp with Android client
  const ytDlpPath = await getYtDlpPath(onProgress);
  const ffmpegPath = getFFmpegPath();
  const outputTemplate = path.join(outputDir, `raw_${videoId}.%(ext)s`);

  onProgress({ step: 'download', message: 'Fetching video metadata and starting 720p download...', progress: 10 });

  return new Promise((resolve, reject) => {
    (async () => {
      // Fetch metadata via native Android player client
      const infoArgs = [
        ...getYtDlpArgs(),
        '--dump-json',
        '--no-playlist',
        url
      ];
      const infoResult = await runYtDlp(ytDlpPath, infoArgs);

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
      }

      // 2. Download the video file with Android Player protocol
      const dlArgs = [
        '--ffmpeg-location',
        ffmpegPath,
        ...getYtDlpArgs(),
        '-f',
        '18/22/best[height<=720]/bestvideo[height<=720]+bestaudio/best',
        '--merge-output-format',
        'mp4',
        '--no-playlist',
        '--no-part',
        '--no-mtime',
        ...(IS_LINUX ? [] : ['--windows-filenames']),
        '--retries', '5',
        '--fragment-retries', '5',
        '-o',
        outputTemplate,
        url,
      ];

      console.log(`[Downloader] Spawning yt-dlp Android client: ${ytDlpPath} ${dlArgs.join(' ')}`);
      onProgress({ step: 'download', message: `Downloading "${metadata.title}" (720p)...`, progress: 20 });

      const downloadResult = await runYtDlp(ytDlpPath, dlArgs, {
        onStdout: (text) => {
          const match = text.match(/(\d+(\.\d+)?)%/);
          if (match) {
            const percent = parseFloat(match[1]);
            const scaledProgress = 20 + Math.round(percent * 0.15);
            onProgress({ step: 'download', message: `Downloading video: ${Math.round(percent)}%`, progress: scaledProgress });
          }
        },
      });

      if (downloadResult.code === 0) {
        try {
          let downloadedFile = finalExpectedPath;

          if (!fs.existsSync(downloadedFile)) {
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

      reject(new Error(`Download failed with code ${downloadResult.code}: ${downloadResult.stderr.slice(-600)}`));
    })().catch(reject);
  });
}
