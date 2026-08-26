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
 * Scan all common directory locations and filename variations for cookies.txt
 */
function findCookiesFile() {
  const rootDir = path.resolve(serverDir, '..');
  const candidatePaths = [
    path.join(serverDir, 'cookies.txt'),
    path.join(rootDir, 'cookies.txt'),
    path.join(serverDir, 'Cookies.txt'),
    path.join(rootDir, 'Cookies.txt'),
    path.join(serverDir, 'cookie.txt'),
    path.join(rootDir, 'cookie.txt'),
    path.join(serverDir, 'cookies.txt.txt'),
    path.join(rootDir, 'cookies.txt.txt'),
    path.join(serverDir, 'youtube_cookies.txt'),
    path.join(rootDir, 'youtube_cookies.txt'),
    path.join(process.cwd(), 'server', 'cookies.txt'),
    path.join(process.cwd(), 'cookies.txt')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const stats = fs.statSync(p);
        if (stats.size > 10) {
          return p;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Returns yt-dlp args configured with:
 * 1. Human-like rate pacing (--sleep-requests 3, --sleep-interval 3, --max-sleep-interval 6)
 * 2. Bandwidth throttling (--limit-rate 5M) to mimic natural video browsing
 * 3. Client manipulation (web, mweb, ios, android)
 * 4. Optional Residential Proxy support (via RESIDENTIAL_PROXY or PROXY_URL)
 * 5. Automatic detection of session cookies.txt across root and server/ folders
 */
function getYtDlpArgs() {
  const residentialProxy = (process.env.RESIDENTIAL_PROXY || process.env.PROXY_URL || '').trim();
  const proxyArgs = residentialProxy ? ['--proxy', residentialProxy] : [];

  const foundCookies = findCookiesFile();
  const cookiesArgs = foundCookies ? ['--cookies', foundCookies] : [];
  
  if (foundCookies) {
    console.log(`[Downloader] 🍪 Found active session cookies: ${foundCookies}`);
  } else {
    console.warn(`[Downloader] ⚠️ No cookies.txt found in server/ or root directory. Running in unauthenticated mode.`);
  }

  return [
    '--extractor-args', 'youtube:player_client=android,android_vr,web_embedded,mweb',
    '--referer', 'https://www.google.com/',
    '--user-agent', 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A.230803.041) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    '--sleep-requests', '3',
    '--sleep-interval', '3',
    '--max-sleep-interval', '6',
    '--limit-rate', '5M',
    '--rm-cache-dir',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--no-check-certificates',
    '--geo-bypass',
    ...cookiesArgs,
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

// ── Native Stream Downloader Helper ──────────────────────────────────────────

async function downloadFileFromUrl(streamUrl, outputPath, { onProgress = () => {} } = {}) {
  const res = await fetch(streamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch video stream: HTTP ${res.status}`);
  }

  const totalBytes = Number(res.headers.get('content-length')) || 0;
  let downloadedBytes = 0;

  const fileStream = fs.createWriteStream(outputPath);
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(Buffer.from(value));
    downloadedBytes += value.length;
    if (totalBytes > 0) {
      const pct = Math.round((downloadedBytes / totalBytes) * 100);
      const scaledProgress = 15 + Math.round(pct * 0.20);
      onProgress({ step: 'download', message: `Downloading video stream: ${pct}%`, progress: scaledProgress });
    }
  }

  fileStream.end();
  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  return outputPath;
}

// ── Cobalt API Downloader ───────────────────────────────────────────────────

async function downloadWithCobaltApi(url, outputPath, onProgress) {
  const cobaltEndpoint = process.env.COBALT_API_URL?.trim();
  const cobaltApiKey = process.env.COBALT_API_KEY?.trim();
  if (!cobaltEndpoint) return null;

  try {
    onProgress({ step: 'download', message: 'Delegating extraction to Cobalt API...', progress: 12 });
    console.log(`[Downloader] Requesting delegated extraction via Cobalt API: ${cobaltEndpoint}`);

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    };
    if (cobaltApiKey) {
      headers['Authorization'] = `Bearer ${cobaltApiKey}`;
    }

    const res = await fetch(cobaltEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url,
        videoQuality: '720',
        downloadMode: 'auto'
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      console.warn(`[Downloader] Cobalt API returned HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const downloadUrl = data.url || (data.status === 'redirect' ? data.url : null);
    if (!downloadUrl) {
      console.warn(`[Downloader] Cobalt API did not return a stream URL`);
      return null;
    }

    onProgress({ step: 'download', message: 'Downloading stream from Cobalt server...', progress: 20 });
    await downloadFileFromUrl(downloadUrl, outputPath, { onProgress });

    return {
      filePath: outputPath,
      metadata: {
        title: data.filename || 'YouTube Video',
        duration: 60
      }
    };
  } catch (err) {
    console.warn(`[Downloader] Cobalt API error: ${err.message}`);
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

    if (!best || !best.url) {
      return null;
    }

    onProgress({ step: 'download', message: `Downloading video via RapidAPI stream (${best.qualityLabel || '360p'})...`, progress: 18 });
    console.log(`[Downloader] yt-api stream: ${best.qualityLabel}, hasAudio=${!!best.audioQuality}`);

    await downloadFileFromUrl(best.url, outputPath, { onProgress });

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
 * Downloads a YouTube video with configurable quality (preview 240p vs full 720p HD).
 */
export async function downloadYouTubeVideo(url, outputDir, videoId, onProgress = () => {}, { quality = '720p', prefix = 'raw' } = {}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const isPreview = quality === 'preview' || quality === 'low' || quality === '240p';
  const finalExpectedPath = path.join(outputDir, `${prefix}_${videoId}.mp4`);

  // Tier 1: Try Cobalt API if configured (only for full download)
  if (process.env.COBALT_API_URL && !isPreview) {
    const cobaltRes = await downloadWithCobaltApi(url, finalExpectedPath, onProgress);
    if (cobaltRes) {
      onProgress({ step: 'download', message: 'Video downloaded via Cobalt API.', progress: 35 });
      return cobaltRes;
    }
  }

  // Tier 2: Direct resilient yt-dlp with client spoofing (web, mweb, ios, android)
  const ytDlpPath = await getYtDlpPath(onProgress);
  const ffmpegPath = getFFmpegPath();
  const outputTemplate = path.join(outputDir, `${prefix}_${videoId}.%(ext)s`);

  const qualityLabel = isPreview ? '240p/360p (Hemat Kuota)' : '720p HD';
  onProgress({ step: 'download', message: `Fetching video metadata and starting ${qualityLabel} download...`, progress: 10 });

  const baseArgs = getYtDlpArgs();
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

  const formatSelector = isPreview
    ? 'worst[ext=mp4]/18/best[height<=360]/best[height<=240]/worst'
    : '18/22/best[height<=720]/bestvideo[height<=720]+bestaudio/best';

  const dlArgs = [
    '--ffmpeg-location',
    ffmpegPath,
    ...baseArgs,
    '-f',
    formatSelector,
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

  console.log(`[Downloader] Spawning yt-dlp (${qualityLabel}): ${ytDlpPath} ${dlArgs.join(' ')}`);
  onProgress({ step: 'download', message: `Downloading "${metadata.title}" (${qualityLabel})...`, progress: 20 });

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
    let downloadedFile = finalExpectedPath;

    if (!fs.existsSync(downloadedFile)) {
      const videoFiles = fs.readdirSync(outputDir).filter(f =>
        f.startsWith(`${prefix}_${videoId}`) &&
        !f.endsWith('.m4a') &&
        !f.endsWith('.mp3') &&
        !f.endsWith('.aac') &&
        !f.endsWith('.opus') &&
        !f.endsWith('.part') &&
        !f.endsWith('.ytdl') &&
        (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv') || f.endsWith('.mov'))
      );

      const audioFiles = fs.readdirSync(outputDir).filter(f =>
        f.startsWith(`${prefix}_${videoId}`) &&
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

    onProgress({ step: 'download', message: `Video download (${qualityLabel}) completed successfully.`, progress: 35 });
    return { filePath: downloadedFile, metadata };
  }

  throw new Error(`Download failed with code ${downloadResult.code}: ${downloadResult.stderr.slice(-600)}`);
}
