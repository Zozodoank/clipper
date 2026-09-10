import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getYtDlpPath, getFFmpegPath } from './binaryChecker.js';
import { trackBandwidth, trackSavedBandwidth } from './bandwidthTracker.js';
import { extractCoreProductInfo, isTitleMatchingProduct } from './discoveryService.js';

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

  // 1. Durasi Video (Wajib antara 5 menit s/d 15 menit)
  const duration = Number(metadata.duration) || 0;
  if (duration > 0 && duration < 300) {
    return { eligible: false, reason: `Durasi video terlalu pendek (${Math.round(duration)} detik / ${(duration / 60).toFixed(1)} menit). Minimal durasi video 5 menit agar memiliki peragaan produk yang memadai.` };
  }
  if (duration > 900) {
    return { eligible: false, reason: `Durasi video terlalu panjang (${(duration / 60).toFixed(1)} menit). Maksimal durasi video 15 menit.` };
  }

  const titleLower = (metadata.title || '').toLowerCase();
  const descLower = (metadata.description || '').toLowerCase();
  const tagsLower = (metadata.tags || []).map(t => String(t).toLowerCase());
  const combinedText = `${titleLower} ${descLower} ${tagsLower.join(' ')}`;

  // 2. Filter Subtitle Hardburned pada Judul / Deskripsi / Tags
  // Catatan: Soft Closed Captions (CC) di YouTube (metadata.subtitles) adalah teks eksternal yang TIDAK
  // ter-render pada pixel stream/MP4. Subtitle hardburned yang sesungguhnya dideteksi via OCR di Tahap 2.
  const subtitleKeywords = [
    'sub indo', 'subtitle', 'subtitles', 'sub english', 'eng sub',
    'terjemahan', 'lirik', 'lyrics', 'lyric', 'cc sub'
  ];
  if (subtitleKeywords.some(kw => combinedText.includes(kw))) {
    return { eligible: false, reason: 'Terdeteksi indikasi teks subtitle bawaan pada judul/deskripsi/tags.' };
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
    'makeup tutorial', 'gameplay', 'live stream',
    'pengalaman pribadi', 'kulitku', 'mukaku', 'wajahku',
    'curhat', 'keseharianku', 'kenalan', 'ngobrol', 'bincang', 'q&a', 'storytime',
    'halo guys', 'halo teman', 'halo semuanya', 'sama aku', 'bareng aku',
    'unbox with me', 'talking head', 'vlogger', 'blogger',
    'haul with me', 'watch me'
  ];
  // Honorific/persona standalone words must use word boundaries (\b) so "memasang", "memasak", "kemasan" don't falsely match "mas"
  const personaRegex = /\b(mas|mbak|abang|bunda|mamah|teteh|kakak|host|creator)\b/i;

  const descPreview = descLower.slice(0, 500);
  const isFaceTitle = faceAndVlogKeywords.some(kw => titleLower.includes(kw)) || personaRegex.test(titleLower);
  const isFaceDesc = faceAndVlogKeywords.some(kw => descPreview.includes(kw)) || personaRegex.test(descPreview);

  if (isFaceTitle || isFaceDesc) {
    return { eligible: false, reason: 'Format video terindikasi berpusat pada wajah / vlogger / persona manusia.' };
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

  // 7. Kesesuaian Kata Kunci Produk Target (Policy 1 & Policy 2: Core Noun & Multi-word Intersection)
  if (productTitle && productTitle.trim()) {
    const prodInfo = extractCoreProductInfo(productTitle, metadata.description || '');
    const coreWords = prodInfo.coreWords || [];

    // Local check on video title against core product words and cross-category exclusions
    if (!isTitleMatchingProduct(metadata.title, coreWords)) {
      return {
        eligible: false,
        reason: `Judul video YouTube ("${metadata.title}") tidak cocok dengan produk target ("${prodInfo.coreProductNoun}"). Dibutuhkan kecocokan multi-kata kunci produk.`
      };
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
  maxSampleFrames = 20,
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
  const safeMax = Math.max(5, Math.min(20, Number(maxSampleFrames) || 20));
  const safeDuration = Math.max(10, Number(duration) || 60);

  // Generate evenly distributed timestamps across the video timeline (avoiding extreme 0s and last seconds)
  const interval = safeDuration / (safeMax + 1);
  const samplePoints = [];
  for (let i = 1; i <= safeMax; i++) {
    const ts = Math.max(1, Math.min(Math.floor(safeDuration - 2), Math.round(i * interval)));
    samplePoints.push({ index: i, timestamp: ts });
  }

  onProgress({
    step: 'stream_sampling',
    message: `Sampling cepat ${safeMax} keyframe visual langsung dari stream URL (fast seek paralel)...`,
    progress: 25,
  });

  console.log(`[VideoFilterService] Fast seek sampling ${safeMax} frames across ${safeDuration}s from stream...`);

  // Fast seek each timestamp with concurrency limit (5 parallel workers)
  const concurrency = 5;
  const executing = [];
  for (const point of samplePoints) {
    const frameFile = `frame_${String(point.index).padStart(4, '0')}.jpg`;
    const outputPath = path.join(outputDir, frameFile);

    const p = new Promise((resolve) => {
      // Input seeking (-ss before -i) fetches only the keyframe near timestamp via HTTP Range headers
      const proc = spawn(ffmpegPath, [
        '-y',
        '-ss', String(point.timestamp),
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '4',
        '-i', streamUrl,
        '-frames:v', '1',
        '-vf', 'scale=-2:360',
        '-q:v', '3',
        outputPath
      ]);
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });

    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);

  const frameFiles = fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
    .sort();

  if (frameFiles.length === 0) {
    throw new Error('Tidak ada frame yang berhasil diekstrak dari stream URL.');
  }

  const pointMap = new Map(samplePoints.map(p => [`frame_${String(p.index).padStart(4, '0')}.jpg`, p.timestamp]));

  const frames = [];
  for (let i = 0; i < frameFiles.length; i++) {
    const filename = frameFiles[i];
    const filePath = path.join(outputDir, filename);

    const frameNumber = parseInt(filename.replace('frame_', '').replace('.png', '').replace('.jpg', ''), 10);
    const timestampInSeconds = pointMap.get(filename) !== undefined
      ? pointMap.get(filename)
      : Math.max(0, Math.round(i * interval));

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

  // Track internet data used by stream sampling (~0.8-1.5 MB)
  let sampledBytes = 0;
  for (const f of frameFiles) {
    try {
      sampledBytes += fs.statSync(path.join(outputDir, f)).size;
    } catch {}
  }
  // Include network packet overhead (~200KB)
  sampledBytes = Math.max(sampledBytes, 0.8 * 1024 * 1024);
  trackBandwidth('streamSampling', sampledBytes, `Sampling 20 frame stream URL (~${(sampledBytes / (1024 * 1024)).toFixed(2)} MB)`);

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
  let floatingTextCount = 0;
  let blackFrameCount = 0;
  let humanFaceSkinCount = 0;

  // Inspect frames using fast FFmpeg rawvideo pixel stream (grayscale & RGB)
  // Area 9:16 tengah adalah x=iw*0.25 s/d x=iw*0.75 (lebar 50% tengah).
  // 1. Bottom subtitle zone: y=ih*0.75 s/d y=ih*1.0 (tinggi 25% bawah).
  // 2. Middle & upper floating text zone: y=ih*0.12 s/d y=ih*0.72 (tinggi 60% tengah/atas tempat teks promo/stiker melayang).
  // 3. Upper & middle face/person zone: y=ih*0.05 s/d y=ih*0.50 (tinggi 45% atas tempat vlogger/wajah muncul).
  for (const f of frames) {
    if (!f.filePath || !fs.existsSync(f.filePath)) continue;

    // ── 1. PEMERIKSAAN SUBTITLE BAWAH (BOTTOM 25% AREA 9:16) ──
    const subRes = spawnSync(ffmpeg, [
      '-y',
      '-i', f.filePath,
      '-vf', 'crop=w=iw*0.5:h=ih*0.25:x=iw*0.25:y=ih*0.75,scale=100:50',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-'
    ]);

    if (subRes.status === 0 && subRes.stdout && subRes.stdout.length > 0) {
      const buf = subRes.stdout;
      let sum = 0;
      let whitePixels = 0;

      for (let i = 0; i < buf.length; i++) {
        sum += buf[i];
        if (buf[i] > 220) whitePixels++; // Piksel teks putih/terang berkontras tinggi
      }

      const avg = sum / buf.length;
      const whiteRatio = whitePixels / buf.length;

      if (avg < 8) {
        blackFrameCount++;
      }

      // Jika area bawah memuat teks subtitle berkontras tinggi
      if (whiteRatio > 0.05 && avg > 25) {
        subtitleBandCount++;
      }
    }

    // ── 2. PEMERIKSAAN TEKS MENGAMBANG & STIKER EDITAN (MIDDLE & UPPER 60% AREA 9:16) ──
    const floatTextRes = spawnSync(ffmpeg, [
      '-y',
      '-i', f.filePath,
      '-vf', 'crop=w=iw*0.5:h=ih*0.60:x=iw*0.25:y=ih*0.12,scale=100:60',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      '-'
    ]);

    if (floatTextRes.status === 0 && floatTextRes.stdout && floatTextRes.stdout.length > 0) {
      const fBuf = floatTextRes.stdout;
      let fWhitePixels = 0;
      let fHighContrastEdges = 0;

      for (let i = 1; i < fBuf.length; i++) {
        if (fBuf[i] > 225) fWhitePixels++;
        // Deteksi tepi tajam teks digital (perbedaan kontras ekstrem antar piksel tetangga)
        if (Math.abs(fBuf[i] - fBuf[i - 1]) > 130) {
          fHighContrastEdges++;
        }
      }

      const fWhiteRatio = fWhitePixels / fBuf.length;
      const fEdgeRatio = fHighContrastEdges / fBuf.length;

      // Jika area tengah/atas mengandung teks promo mengambang atau stiker teks digital bertuliskan fitur/harga
      if (fWhiteRatio > 0.06 && fEdgeRatio > 0.05) {
        floatingTextCount++;
      }
    }

    // ── 3. PEMERIKSAAN WAJAH & VLOGGER MANUSIA (UPPER 45% AREA 9:16) ──
    const faceRes = spawnSync(ffmpeg, [
      '-y',
      '-i', f.filePath,
      '-vf', 'crop=w=iw*0.5:h=ih*0.45:x=iw*0.25:y=ih*0.05,scale=64:48',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-'
    ]);

    if (faceRes.status === 0 && faceRes.stdout && faceRes.stdout.length >= 3) {
      const rgbBuf = faceRes.stdout;
      const numPixels = Math.floor(rgbBuf.length / 3);
      let skinPixels = 0;

      for (let i = 0; i < rgbBuf.length; i += 3) {
        const r = rgbBuf[i];
        const g = rgbBuf[i + 1];
        const b = rgbBuf[i + 2];

        // Skin-tone detection presisi (wajah manusia di pencahayaan studio/kamera)
        const isSkin = (r > 75 && g > 40 && b > 20 &&
          (r - g >= 10) && (r - b >= 10) &&
          (Math.max(r, g, b) - Math.min(r, g, b) >= 15));

        if (isSkin) skinPixels++;
      }

      const skinRatio = skinPixels / numPixels;
      // Di area atas 45%, peragaan produk faceless di atas meja seharusnya hampir 0% skin ratio
      if (skinRatio > 0.20) {
        humanFaceSkinCount++;
      }
    }
  }

  // ── STRICT ZERO-TOLERANCE THRESHOLDS (MAKSIMAL 1 FRAME TOLERANSI UNTUK GLITCH) ──

  // 1. Tolak jika ada teks subtitle bawaan (>= 2 frame terdeteksi)
  if (subtitleBandCount >= 2) {
    return {
      eligible: false,
      reason: `Analisa visual lokal mendeteksi teks subtitle ucapan bawaan pada area bawah 9:16 (${subtitleBandCount} frame). Wajib video bersih tanpa subtitle!`
    };
  }

  // 2. Tolak jika ada teks mengambang / stiker teks editan (>= 2 frame terdeteksi)
  if (floatingTextCount >= 2) {
    return {
      eligible: false,
      reason: `Analisa visual lokal mendeteksi teks mengambang / stiker teks promo editan pada area tengah 9:16 (${floatingTextCount} frame). Wajib video bersih tanpa teks mengambang!`
    };
  }

  // 3. Tolak jika ada wajah / vlogger manusia (>= 2 frame terdeteksi)
  if (humanFaceSkinCount >= 2) {
    return {
      eligible: false,
      reason: `Analisa visual lokal mendeteksi keberadaan wajah atau manusia di area atas frame (${humanFaceSkinCount} frame). Wajib 100% faceless tabletop peragaan tangan!`
    };
  }

  // 4. Tolak jika mayoritas frame blank / hitam
  const blackRatio = blackFrameCount / frames.length;
  if (blackRatio > 0.35) {
    return {
      eligible: false,
      reason: `Analisa visual lokal mendeteksi terlalu banyak frame hitam / kosong (${Math.round(blackRatio * 100)}% frame).`
    };
  }

  return { eligible: true };
}

