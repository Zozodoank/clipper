import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'url';
import { getYtDlpPath, getFFmpegPath } from './binaryChecker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

const IS_LINUX = process.platform === 'linux';

/**
 * Check if a local proxy port (e.g. WARP SOCKS5 on 127.0.0.1:40000) is actively listening
 */
function isProxyListening(port = 40000, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(250);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Returns yt-dlp args configured with client spoofing (android_vr, android, ios, web).
 * No cookies are used, keeping backend 100% account-free and safe from bot-check locks.
 */
async function getYtDlpArgs({ useProxy = false } = {}) {
  let proxyArgs = [];
  if (useProxy && IS_LINUX) {
    const warpListening = await isProxyListening(40000, '127.0.0.1');
    if (warpListening) {
      proxyArgs = ['--proxy', 'socks5://127.0.0.1:40000'];
    }
  }

  return [
    '--extractor-args', 'youtube:player_client=android_vr,android,ios,web',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--no-check-certificates',
    '--geo-bypass',
    ...proxyArgs
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
    // Route through WARP proxy so the Azure datacenter IP doesn't get blocked.
    const ytDlpPath = await getYtDlpPath();
    const cdnProxy = IS_LINUX ? 'socks5://127.0.0.1:40000' : null;
    await new Promise((resolve, reject) => {
      const ytdlpArgs = [
        '--no-check-certificates',
        '--no-playlist',
        '--no-part',
        '--no-mtime',
      ];
      if (cdnProxy) {
        ytdlpArgs.push('--proxy', cdnProxy);
      }
      ytdlpArgs.push('-o', outputPath, best.url);

      console.log(`[Downloader] yt-dlp CDN download via WARP: ${ytDlpPath}`);
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
    ...(await getYtDlpArgs({ useProxy: false })),
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
 * Downloads a YouTube video using authentic cookies with automatic direct/proxy retry.
 */
export async function downloadYouTubeVideo(url, outputDir, videoId, onProgress = () => {}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const finalExpectedPath = path.join(outputDir, `raw_${videoId}.mp4`);
  const ytDlpPath = await getYtDlpPath(onProgress);
  const ffmpegPath = getFFmpegPath();
  const outputTemplate = path.join(outputDir, `raw_${videoId}.%(ext)s`);

  onProgress({ step: 'download', message: 'Fetching video metadata and starting 720p download...', progress: 10 });

  async function executeDownload(useProxy) {
    const baseArgs = await getYtDlpArgs({ useProxy });
    const infoArgs = [
      ...baseArgs,
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

    const dlArgs = [
      '--ffmpeg-location',
      ffmpegPath,
      ...baseArgs,
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

    console.log(`[Downloader] Spawning yt-dlp (proxy=${useProxy}): ${ytDlpPath} ${dlArgs.join(' ')}`);
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

    return { downloadResult, metadata };
  }

  // Attempt 1: Direct connection (cleanest reputation with authentic cookies)
  let { downloadResult, metadata } = await executeDownload(false);

  // Attempt 2: If direct connection failed, retry via Cloudflare WARP proxy
  if (downloadResult.code !== 0 && IS_LINUX) {
    const warpListening = await isProxyListening(40000, '127.0.0.1');
    if (warpListening) {
      console.warn(`[Downloader] Direct download failed (code ${downloadResult.code}). Retrying via Cloudflare WARP proxy...`);
      onProgress({ step: 'download', message: 'Retrying video download via proxy...', progress: 15 });
      const retryRes = await executeDownload(true);
      downloadResult = retryRes.downloadResult;
      metadata = retryRes.metadata;
    }
  }

  if (downloadResult.code === 0) {
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
        throw new Error(`Video file not found in ${outputDir} after download.`);
      }
    }

    onProgress({ step: 'download', message: 'Video download completed successfully.', progress: 35 });
    return { filePath: downloadedFile, metadata };
  }

  throw new Error(`Download failed with code ${downloadResult.code}: ${downloadResult.stderr.slice(-600)}`);
}
