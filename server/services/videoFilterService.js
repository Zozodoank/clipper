import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getYtDlpPath, getFFmpegPath } from './binaryChecker.js';
import { trackBandwidth, trackSavedBandwidth } from './bandwidthTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

/**
 * Scan common locations for cookies.txt
 */
export function findCookiesFile() {
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
 * Base yt-dlp arguments with residential proxy and cookies
 */
function getYtDlpBaseArgs() {
  const residentialProxy = (process.env.RESIDENTIAL_PROXY || process.env.PROXY_URL || '').trim();
  const proxyArgs = residentialProxy ? ['--proxy', residentialProxy] : [];

  const foundCookies = findCookiesFile();
  const cookiesArgs = foundCookies ? ['--cookies', foundCookies] : [];

  const args = [
    '--no-check-certificates',
    '--geo-bypass',
  ];

  if (cookiesArgs.length) args.push(...cookiesArgs);
  if (proxyArgs.length) args.push(...proxyArgs);

  return args;
}

/**
 * ── TAHAP 1: FETCH METADATA & DIRECT STREAM URL (0 VIDEO DOWNLOAD) ───────────
 * Fetches YouTube metadata and 360p direct HTTP stream URL using yt-dlp.
 */
export async function fetchVideoMetadataAndStream(url, { onProgress = () => {} } = {}) {
  const ytDlpPath = await getYtDlpPath();

  onProgress({
    step: 'metadata_fetch',
    message: 'Membaca metadata & stream URL YouTube tanpa download...',
    progress: 10,
  });

  // Step 1: Dump single JSON for metadata
  const metaArgs = [
    ...getYtDlpBaseArgs(),
    '--dump-json',
    '--no-playlist',
    '--skip-download',
    url
  ];

  const metaResult = await new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath, metaArgs);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        try {
          const parsedMeta = JSON.parse(stdout.trim());
          const metaBytes = Buffer.byteLength(stdout || '', 'utf-8');
          trackBandwidth('metadata', metaBytes, `Metadata video: ${(parsedMeta.title || '').slice(0, 40)}`);
          resolve(parsedMeta);
        } catch (e) {
          reject(new Error(`Gagal membaca metadata JSON yt-dlp: ${e.message}`));
        }
      } else {
        reject(new Error(`yt-dlp metadata failed (code ${code}): ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', reject);
  });

  const duration = Number(metaResult.duration) || 60;
  const metadata = {
    id: metaResult.id,
    title: metaResult.title || 'YouTube Video',
    duration,
    description: (metaResult.description || '').slice(0, 1000),
    channel: metaResult.uploader || metaResult.channel || '',
    tags: Array.isArray(metaResult.tags) ? metaResult.tags : [],
    subtitles: metaResult.subtitles || {},
    automatic_captions: metaResult.automatic_captions || {},
  };

  // Step 2: Extract direct stream URL for low-resolution 360p (Fast & Quota-efficient)
  onProgress({
    step: 'stream_url_fetch',
    message: 'Mengambil stream URL preview 360p langsung dari YouTube...',
    progress: 14,
  });

  const streamArgs = [
    ...getYtDlpBaseArgs(),
    '-g',
    '-f', '18/bestvideo[height<=360]+bestaudio/bestvideo[height<=360]/best[height<=360]/worstvideo/worst/best',
    '--no-playlist',
    url
  ];

  const streamUrl = await new Promise((resolve, reject) => {
    const proc = spawn(ytDlpPath, streamArgs);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        const firstLine = stdout.trim().split(/\r?\n/)[0].trim();
        if (firstLine.startsWith('http')) {
          resolve(firstLine);
        } else {
          reject(new Error(`Stream URL tidak valid: ${firstLine}`));
        }
      } else {
        reject(new Error(`yt-dlp stream URL failed (code ${code}): ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', reject);
  });

  return { metadata, streamUrl };
}

/**
 * ── TAHAP 1: FILTER KASAR METADATA (0 KUOTA VIDEO, 0 TOKEN AI) ───────────────
 * Checks duration, tags, captions, and title/description for compliance.
 */
export function checkVideoMetadataCompliance(metadata, productTitle = '', options = {}) {
  if (!metadata) {
    return { eligible: false, reason: 'Metadata video kosong atau tidak tersedia.' };
  }

  // 1. Durasi Video (Wajib antara 15 detik s/d 30 menit)
  const duration = Number(metadata.duration) || 0;
  if (duration > 0 && duration < 15) {
    return { eligible: false, reason: `Durasi video terlalu pendek (${duration}s < 15s).` };
  }
  if (duration > 1800) {
    return { eligible: false, reason: `Durasi video terlalu panjang (${Math.round(duration / 60)} menit > 30 menit).` };
  }

  const titleLower = (metadata.title || '').toLowerCase();
  const descLower = (metadata.description || '').toLowerCase();
  const tagsLower = (metadata.tags || []).map(t => String(t).toLowerCase());
  const combinedText = `${titleLower} ${descLower} ${tagsLower.join(' ')}`;

  // 2. Filter Subtitle & Closed Captions (CC)
  const subtitleKeywords = [
    'sub indo', 'subtitle', 'subtitles', 'sub english', 'eng sub',
    'terjemahan', 'lirik', 'lyrics', 'lyric', 'cc sub'
  ];
  if (subtitleKeywords.some(kw => combinedText.includes(kw))) {
    return { eligible: false, reason: 'Terdeteksi indikasi teks subtitle bawaan pada judul/deskripsi/tags.' };
  }

  // Cek jika ada track subtitle manual (misal track 'id', 'en', 'ms')
  const subtitleTracks = Object.keys(metadata.subtitles || {});
  if (subtitleTracks.length > 0) {
    // Video memiliki hardburned or manual subtitle tracks
    return { eligible: false, reason: `Terdeteksi subtitle tracks manual (${subtitleTracks.join(', ')}).` };
  }

  // 3. Filter Iklan & Sponsor Komersial
  const adKeywords = [
    'sponsored', 'promoted', 'paid promotion', 'endorsement', 'iklan',
    'kolaborasi berbayar', 'afiliasi tutorial', 'cara jualan', 'cara live'
  ];
  if (adKeywords.some(kw => combinedText.includes(kw))) {
    return { eligible: false, reason: 'Terdeteksi indikasi konten iklan berbayar atau promosi sponsor.' };
  }

  // 4. Filter Wajah Manusia / Vlog / Format yang dilarang
  const faceAndVlogKeywords = [
    'vlog', 'daily vlog', 'a day in my life', 'podcast', 'reaction',
    'facecam', 'webcam', 'selfie', 'muka', 'wajah', 'grwm', 'get ready with me',
    'try on haul', 'try on', 'outfit', 'ootd', 'mukbang', 'skincare routine',
    'makeup tutorial', 'gameplay', 'live stream'
  ];
  if (faceAndVlogKeywords.some(kw => titleLower.includes(kw))) {
    return { eligible: false, reason: 'Format video terindikasi berpusat pada wajah / vlogger / podcast.' };
  }

  // 5. Filter Watermark & Repost Sosmed
  const watermarkKeywords = [
    'tiktok', 'douyin', 'kuaishou', 'capcut', 'repost', 'watermark',
    'shorts tiktok', 'video tiktok', 'vt tiktok'
  ];
  if (watermarkKeywords.some(kw => titleLower.includes(kw))) {
    return { eligible: false, reason: 'Judul video mengindikasikan watermark/repost dari platform sosial media lain.' };
  }

  // 6. Filter AI-Generated & Animasi / Kartun
  const aiKeywords = [
    'ai generated', 'ai video', 'sora', 'runway', 'kling', 'hailuo',
    'pika', 'animasi', '3d animation', 'cgi', 'cartoon', 'kartun', 'anime'
  ];
  if (aiKeywords.some(kw => combinedText.includes(kw))) {
    return { eligible: false, reason: 'Video terindikasi animasi, kartun, atau buatan AI.' };
  }

  // 7. Kesesuaian Kata Kunci Produk Target
  if (productTitle && productTitle.trim()) {
    const cleanProd = productTitle.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const words = cleanProd.split(/\s+/).filter(w => w.length >= 3);
    const stopWords = ['dan', 'yang', 'untuk', 'dengan', 'dari', 'bisa', 'anti', 'mini', 'super', 'termurah', 'viral', 'original', 'promo'];
    const significantWords = words.filter(w => !stopWords.includes(w));

    if (significantWords.length > 0) {
      const hasMatch = significantWords.some(w => combinedText.includes(w));
      if (!hasMatch) {
        return { eligible: false, reason: `Metadata video tidak memuat kata kunci produk "${significantWords.slice(0, 3).join(', ')}".` };
      }
    }
  }

  return { eligible: true };
}

/**
 * ── TAHAP 2: SAMPLING FRAME LANGSUNG DARI STREAM URL (~2MB KUOTA) ────────────
 * Uses FFmpeg to extract 30 frames directly from the stream URL without downloading full video.
 */
export async function sampleFramesFromStream(streamUrl, outputDir, {
  duration = 60,
  maxSampleFrames = 30,
  onProgress = () => {}
} = {}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Clean old frames in directory
  const existingFiles = fs.readdirSync(outputDir);
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(outputDir, f)); } catch {}
  }

  const ffmpegPath = getFFmpegPath();
  const safeMax = Math.max(5, Math.min(30, Number(maxSampleFrames) || 30));
  const safeDuration = Math.max(10, Number(duration) || 60);
  const sampleInterval = Math.max(1, Math.floor(safeDuration / safeMax));

  onProgress({
    step: 'stream_sampling',
    message: `Sampling ${safeMax} frame visual langsung dari stream URL (1 frame setiap ${sampleInterval}s)...`,
    progress: 25,
  });

  const outputPattern = path.join(outputDir, 'frame_%04d.png');

  // FFmpeg extracts frames directly from HTTP stream URL.
  // Seeking via -ss and stream sampling only transfers ~1-2 MB of image packets!
  const args = [
    '-y',
    '-ss', '1',
    '-i', streamUrl,
    '-vf', `fps=1/${sampleInterval},scale=-2:360`,
    '-frames:v', String(safeMax),
    outputPattern
  ];

  console.log(`[VideoFilterService] Sampling stream frames with FFmpeg: ${ffmpegPath} ${args.join(' ')}`);

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg stream sampling failed (code ${code}): ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', reject);
  });

  const frameFiles = fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
    .sort();

  if (frameFiles.length === 0) {
    throw new Error('Tidak ada frame yang berhasil diekstrak dari stream URL.');
  }

  const frames = [];
  for (let i = 0; i < frameFiles.length; i++) {
    const filename = frameFiles[i];
    const filePath = path.join(outputDir, filename);

    const frameNumber = parseInt(filename.replace('frame_', '').replace('.png', '').replace('.jpg', ''), 10);
    const timestampInSeconds = Math.max(0, (frameNumber - 1) * sampleInterval);

    const mins = Math.floor(timestampInSeconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(timestampInSeconds % 60).toString().padStart(2, '0');
    const timeFormatted = `${mins}:${secs}`;

    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    frames.push({
      index: i + 1,
      frameNumber,
      timestamp: timestampInSeconds,
      timeFormatted,
      base64: dataUrl,
      filePath,
    });
  }

  // Track internet data used by stream sampling (~1.5-2.5 MB)
  let sampledBytes = 0;
  for (const f of frameFiles) {
    try {
      sampledBytes += fs.statSync(path.join(outputDir, f)).size;
    } catch {}
  }
  // Include network packet overhead (~200KB)
  sampledBytes = Math.max(sampledBytes, 1.2 * 1024 * 1024);
  trackBandwidth('streamSampling', sampledBytes, `Sampling 30 frame stream URL (~${(sampledBytes / (1024 * 1024)).toFixed(2)} MB)`);

  onProgress({
    step: 'stream_sampling_done',
    message: `Berhasil mengambil ${frames.length} frame visual dari stream URL (~${(sampledBytes / (1024 * 1024)).toFixed(1)} MB kuota).`,
    progress: 35,
  });

  return { frames, totalFrames: frames.length, framesDir: outputDir };
}

/**
 * ── TAHAP 2: ANALISA LOKAL AREA 9:16 (0 TOKEN AI) ───────────────────────────
 * Memeriksa frame visual HANYA pada area tengah rasio 9:16.
 * CATATAN PENTING:
 * Di KEDUA project (clipper maupun YTCLIPER), bagian kiri dan kanan video 16:9
 * akan DIBUANG (di-crop keluar pada clipper, dan tertutup pilar pada YTCLIPER).
 * Oleh karena itu, jika ada watermark/logo di sayap kiri atau kanan, video
 * TETAP DITERIMA di kedua project karena bagian tersebut tidak akan tampil!
 * Yang diperiksa dan wajib 100% bersih hanyalah area tengah 9:16.
 */
export function inspectFramesLocally(frames, { aspectRatio = '9:16', onProgress = () => {} } = {}) {
  if (!Array.isArray(frames) || frames.length < 5) {
    return { eligible: false, reason: 'Jumlah frame visual tidak mencukupi untuk dianalisa.' };
  }

  const ffmpeg = getFFmpegPath();
  let subtitleBandCount = 0;
  let blackFrameCount = 0;

  // Inspect frames using fast FFmpeg rawvideo pixel stream (grayscale)
  // Center 9:16 area is [iw*0.25 to iw*0.75].
  // Bottom subtitle band is [ih*0.75 to ih*1.0].
  for (const f of frames) {
    if (!f.filePath || !fs.existsSync(f.filePath)) continue;

    // Crop bottom 25% of center 9:16, scale to 100x50 raw grayscale
    const res = spawnSync(ffmpeg, [
      '-y',
      '-i', f.filePath,
      '-vf', 'crop=w=iw*0.5:h=ih*0.25:x=iw*0.25:y=ih*0.75,scale=100:50',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-'
    ]);

    if (res.status === 0 && res.stdout && res.stdout.length > 0) {
      const buf = res.stdout;
      let sum = 0;
      let whitePixels = 0;

      for (let i = 0; i < buf.length; i++) {
        sum += buf[i];
        if (buf[i] > 225) whitePixels++; // High-contrast white text pixel
      }

      const avg = sum / buf.length;
      const whiteRatio = whitePixels / buf.length;

      // Pitch black frame check
      if (avg < 8) {
        blackFrameCount++;
      }

      // If bottom zone has dense text-like high-contrast white pixels (e.g. subtitle lines)
      if (whiteRatio > 0.08 && avg > 30) {
        subtitleBandCount++;
      }
    }
  }

  // Rejection threshold: If > 40% of frames have persistent subtitle strips in the bottom 9:16 zone
  const subtitleRatio = subtitleBandCount / frames.length;
  if (subtitleRatio > 0.40) {
    return {
      eligible: false,
      reason: `Analisa lokal mendeteksi teks subtitle bawaan yang persisten pada area 9:16 (${Math.round(subtitleRatio * 100)}% frame).`
    };
  }

  // Rejection threshold: If > 50% of frames are black / blank
  const blackRatio = blackFrameCount / frames.length;
  if (blackRatio > 0.50) {
    return {
      eligible: false,
      reason: `Analisa lokal mendeteksi mayoritas frame kosong / blank (${Math.round(blackRatio * 100)}% frame).`
    };
  }

  return { eligible: true };
}
