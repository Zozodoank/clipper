import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getYtDlpPath, getFFmpegPath } from './binaryChecker.js';
import { getYouTubePoTokenArgs } from './poTokenService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

const IS_LINUX = process.platform === 'linux';

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

// ── RapidAPI YT-API Integration ─────────────────────────────────────────────

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
    if (!res.ok) {
      console.warn(`[Downloader] RapidAPI search returned HTTP ${res.status}`);
      return null;
    }
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
    console.warn('[Downloader] RapidAPI search error:', e.message);
    return null;
  }
}

async function downloadStreamFromDirectUrl(streamUrl, outputPath, onProgress) {
  const res = await fetch(streamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive'
    }
  });
  if (!res.ok) throw new Error(`Stream download failed with HTTP ${res.status}`);
  const totalBytes = Number(res.headers.get('content-length')) || 0;
  let downloadedBytes = 0;

  const fileStream = fs.createWriteStream(outputPath);
  return new Promise((resolve, reject) => {
    res.body.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (totalBytes > 0 && onProgress) {
        const percent = Math.round((downloadedBytes / totalBytes) * 100);
        const scaledProgress = 20 + Math.round(percent * 0.15);
        onProgress({ step: 'download', message: `Downloading video via RapidAPI: ${percent}%`, progress: scaledProgress });
      }
    });
    res.body.pipe(fileStream);
    fileStream.on('finish', () => resolve(outputPath));
    fileStream.on('error', reject);
    res.body.on('error', reject);
  });
}

async function downloadWithRapidApi(url, outputFilePath, onProgress) {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  const host = process.env.RAPIDAPI_HOST?.trim() || 'yt-api.p.rapidapi.com';
  const videoId = extractVideoId(url);
  if (!apiKey || !videoId) return null;

  try {
    onProgress({ step: 'download', message: 'Fetching video stream link from RapidAPI...', progress: 12 });
    const res = await fetch(`https://${host}/dl?id=${videoId}`, {
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': host
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      console.warn(`[Downloader] RapidAPI /dl returned HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    
    // Find suitable format (720p or 360p or progressive MP4 format)
    const formats = data.formats || data.adaptiveFormats || [];
    const directFormat = formats.find(f => f.qualityLabel?.includes('720') && f.url && f.mimeType?.includes('video/mp4') && f.audioQuality)
      || formats.find(f => f.url && f.mimeType?.includes('video/mp4') && f.audioQuality)
      || formats.find(f => f.url && f.mimeType?.includes('video/mp4'))
      || formats[0];

    const streamUrl = directFormat?.url || data.link || data.downloadUrl;
    if (!streamUrl) {
      console.warn('[Downloader] No stream URL found in RapidAPI response');
      return null;
    }

    onProgress({ step: 'download', message: 'Downloading video via RapidAPI direct stream...', progress: 20 });
    await downloadStreamFromDirectUrl(streamUrl, outputFilePath, onProgress);

    const metadata = {
      title: data.title || 'YouTube Video',
      duration: Number(data.lengthSeconds || data.duration) || 60,
      description: (data.description || '').slice(0, 500),
      channel: data.channelTitle || data.author || '',
      tags: data.keywords || []
    };

    return { filePath: outputFilePath, metadata };
  } catch (e) {
    console.warn('[Downloader] RapidAPI download error, falling back to yt-dlp:', e.message);
    return null;
  }
}

// ── Search & Download Functions ─────────────────────────────────────────────

/**
 * Searches YouTube through RapidAPI or yt-dlp.
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

  // 1. Prioritize RapidAPI search if key is provided
  const rapidResults = await searchWithRapidApi(query, limit);
  if (rapidResults && rapidResults.length > 0) {
    return rapidResults;
  }

  // 2. Fallback to yt-dlp search
  const ytDlpPath = await getYtDlpPath(reportProgress);
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  const searchTarget = `ytsearch${safeLimit}:${query}`;

  reportProgress({
    step: 'auto_youtube_search',
    message: `Searching YouTube candidates: ${query}`,
    progress: 8,
  });

  const poTokenArgs = await getYouTubePoTokenArgs();
  const baseArgs = [
    ...poTokenArgs,
    '--no-check-certificates',
    '--geo-bypass',
    '--flat-playlist',
    '--dump-json',
    '--skip-download',
    searchTarget
  ];
  const result = await runYtDlp(ytDlpPath, baseArgs);

  if (result.code !== 0) {
    throw new Error(`yt-dlp search failed with code ${result.code}: ${result.stderr.slice(-600)}`);
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
 * Downloads a YouTube video at max 720p resolution using RapidAPI or yt-dlp.
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

  // 1. Try RapidAPI first if API Key is configured
  const rapidResult = await downloadWithRapidApi(url, finalExpectedPath, onProgress);
  if (rapidResult && fs.existsSync(rapidResult.filePath)) {
    onProgress({ step: 'download', message: 'Video download completed successfully via RapidAPI.', progress: 35 });
    return rapidResult;
  }

  // 2. Fallback to direct yt-dlp pipeline with PO-Token generator
  const ytDlpPath = await getYtDlpPath(onProgress);
  const ffmpegPath = getFFmpegPath();
  const outputTemplate = path.join(outputDir, `raw_${videoId}.%(ext)s`);

  onProgress({ step: 'download', message: 'Fetching video metadata and starting 720p download...', progress: 10 });

  return new Promise((resolve, reject) => {
    (async () => {
      const poTokenArgs = await getYouTubePoTokenArgs();

      // Fetch JSON metadata
      const infoArgs = [
        ...poTokenArgs,
        '--no-check-certificates',
        '--geo-bypass',
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

      // Download the video file capped at 720p
      const dlArgs = [
        '--ffmpeg-location',
        ffmpegPath,
        ...poTokenArgs,
        '--no-check-certificates',
        '--geo-bypass',
        '-f',
        'best[height<=720]/bestvideo[height<=720]+bestaudio/18/22/best',
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

      console.log(`[Downloader] Spawning yt-dlp: ${ytDlpPath} ${dlArgs.join(' ')}`);
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
