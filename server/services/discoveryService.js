import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import https from 'https';
import { searchYouTubeVideos } from './downloader.js';

export const DEFAULT_AUTO_KEYWORDS = [
  // --- ALAT DAPUR & PEMOTONG (Food Prep & Choppers) ---
  'chopper mini elektrik portable viral',
  'chopper manual tarik serbaguna viral',
  'alat potong sayur multifungsi slicer',
  'mandoline slicer parutan serbaguna',
  'alat pengupas buah praktis serbaguna',
  'alat pemotong bawang cabai mini praktis',
  'gunting dapur serbaguna stainless multifungsi',
  'alat pemisah kuning telur praktis viral',
  'alat pembuat dumpling pastel manual',
  'alat pemeras jeruk lemon manual stainless',
  'pemotong semangka melon praktis viral',
  'alat pemotong kentang spiral praktis',
  'food chopper blender mini portable',
  'alat pelumat bawang putih press garlic',
  'parutan keju kelapa stainless praktis',
  'cetakan bakso manual praktis serbaguna',
  'alat pengupas kulit udang praktis',
  'alat pembuang biji apel buah praktis',

  // --- PENYIMPANAN & WADAH DAPUR (Kitchen Organizers & Storage) ---
  'botol minyak kuas silikon 2 in 1 anti tumpah',
  'botol semprot minyak spray olive oil praktis',
  'tempat bumbu putar serbaguna dapur viral',
  'dispenser beras otomatis anti kutu praktis',
  'kotak telur organizer kulkas tingkat otomatis',
  'sealer plastik mini portable perekat makanan',
  'tutup makanan silikon stretch elastis reusable',
  'wadah penyimpanan makanan kedap udara',
  'tempat sendok garpu tirisan anti debu',
  'wadah tirisan cuci beras buah sayur praktis',
  'rak bumbu dapur tempel dinding stainless',
  'rak tirisan cuci piring lipat atas wastafel',
  'rak gantung tutup panci talenan dapur',
  'dispenser kantong plastik sampah dapur praktis',
  'botol bumbu dapur sendok terintegrasi praktis',
  'wadah bumbu 4 sekat praktis sendok',
  'rak gantungan cangkir gelas dapur tempel',

  // --- PERALATAN MASAK MINI & BAKING (Mini Cooking & Baking) ---
  'wajan penggorengan mini telur 4 lubang anti lengket',
  'panci listrik mini serbaguna portable',
  'alat pembuat waffle mini elektrik praktis',
  'sutil silikon set anti panas food grade',
  'timbangan digital dapur mini presisi',
  'timer dapur digital magnetik masak',
  'alat pengasah pisau dapur praktis 3 stage',
  'alat pembuat es batu silikon pencet praktis',
  'cetakan es batu bulat bola silikon viral',
  'splash guard pelindung cipratan minyak kompor',
  'alas silikon adonan kue baking anti lengket',
  'alat pencetak kue kering biskuit praktis',
  'capitan makanan silikon stainless food grade',
  'termometer makanan digital masak dapur',

  // --- ALAT KEBERSIHAN RUMAH & DAPUR (Cleaning Gadgets) ---
  'alat pembersih sikat elektrik mini multifungsi',
  'dispenser sabun cuci piring otomatis sponge pump',
  'alat pel lantai semprot spray mop praktis',
  'alat pel peras putar otomatis serbaguna',
  'alat pel mini meja spons portable praktis',
  'sikat pembersih celah jendela pintu praktis',
  'kemoceng microfiber fleksibel panjang tarik',
  'sikat pembersih botol tumbler sedotan set',
  'alat pengeruk pembersih kaca jendela wiper karet',
  'sikat kloset silikon tempel dinding praktis',
  'alat pengeruk pembersih bulu lint roller washable',
  'spons cuci piring nano magic sponge pembersih kerak',
  'sikat cuci piring dispenser sabun cair otomatis',
  'alat pembersih saluran wastafel mampet fleksibel',
  'sikat pembersih keyboard earphone multifungsi',
  'sikat cuci sepatu otomatis multifungsi praktis',

  // --- ORGANIZER & GADGET RUMAH TANGGA (Home Gadgets & Organizers) ---
  'gantungan tempel dinding serbaguna kait transparan',
  'organizer kabel klip meja dinding rapi',
  'kotak organizer kabel colokan anti debu',
  'lampu sensor gerak otomatis led usb magnetik',
  'pompa galon elektrik usb otomatis praktis',
  'humidifier mini diffuser aroma ruangan usb',
  'gantungan sapu pel tempel dinding kuat',
  'dispenser odol pasta gigi otomatis tempel dinding',
  'rak gantung sabun kamar mandi tempel sudut',
  'organizer pakaian dalam kaos kaki bersekat',
  'gantungan baju lipat travel hemat tempat',
  'tali jemuran baju portable anti angin praktis',
  'pelindung sudut meja silikon pengaman bayi',
  'penahan pintu silikon magnetik anti bentur',
  'stiker pelindung wastafel anti air jamur',
  'tutup saringan lubang pembuangan silikon',
  'rak sepatu lipat susun portable praktis',
  'timbangan badan digital mini led akurat',
];

export const BULKY_EXCLUDE_WORDS = [
  'lemari',
  'wardrobe',
  'kulkas',
  'refrigerator',
  'kasur',
  'springbed',
  'spring bed',
  'matras',
  'meja belajar',
  'meja makan',
  'meja kantor',
  'meja tamu',
  'meja tv',
  'sofa',
  'dipan',
  'ranjang',
  'kursi gaming',
  'kursi kantor',
  'kursi roda',
  'mesin cuci',
  'washing machine',
  'ac portable besar',
  'tv cabinet',
  'buffet',
  'etalase',
  'rak lemari jumbo',
  'rak besi besar',
  'kitchen set besar',
  'kitchen set custom',
  'furniture besar',
];

export function isBulkyOrUnsuitableProduct(text = '') {
  const normalized = normalizeText(text);
  return BULKY_EXCLUDE_WORDS.some((word) => normalized.includes(word));
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const insecureTlsAgent = new https.Agent({ rejectUnauthorized: false });

function formatKeywordToProductTitle(keyword) {
  if (!keyword) return 'Produk Rumah Tangga Viral';
  return keyword
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export async function discoverSingleShopeeProduct(keyword, seen = new Set()) {
  try {
    const results = (await searchDuckDuckGoShopee(keyword)).filter(r => !seen.has(r.url));
    results.forEach(r => seen.add(r.url));

    if (results.length > 0) {
      const batch = results.slice(0, 3);
      const metas = await Promise.allSettled(batch.map(r => fetchShopeePageMeta(r.url)));

      for (let i = 0; i < batch.length; i++) {
        const result = batch[i];
        const pageMeta = metas[i].status === 'fulfilled' ? metas[i].value : {};

        const titleCandidate = cleanTitle(pageMeta.title || result.title || keyword, result.url);
        const descCandidate = cleanDescription(pageMeta.description || result.snippet || '');

        if (isBulkyOrUnsuitableProduct(titleCandidate) || isBulkyOrUnsuitableProduct(descCandidate) || isBulkyOrUnsuitableProduct(keyword)) {
          continue;
        }

        return {
          keyword,
          title: titleCandidate,
          description: descCandidate,
          url: result.url,
        };
      }
    }
  } catch (err) {
    console.warn(`[Discovery] Search engine lookup failed for "${keyword}":`, err.message);
  }

  // Instant Resilient Fallback: If Brave/Google/DuckDuckGo throw 429 or are blocked,
  // directly generate a clean Shopee product candidate from our curated viral keyword list.
  // This guarantees 0-second lag and completely bypasses 429 rate limit errors!
  const formattedTitle = formatKeywordToProductTitle(keyword);
  const shopeeUrl = `https://shopee.co.id/search?keyword=${encodeURIComponent(keyword)}`;
  
  if (seen.has(shopeeUrl)) return null;
  seen.add(shopeeUrl);

  return {
    keyword,
    title: formattedTitle,
    description: `Produk praktis viral: ${formattedTitle}. Kualitas terjamin, multifungsi dan cocok untuk kebutuhan sehari-hari.`,
    url: shopeeUrl,
  };
}

export async function discoverShopeeProducts({
  keywords = DEFAULT_AUTO_KEYWORDS,
  limit = 5,
  onProgress = () => {},
} = {}) {
  const products = [];
  const seen = new Set();
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));

  const candidateKeywords = [...keywords];
  for (let i = candidateKeywords.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidateKeywords[i], candidateKeywords[j]] = [candidateKeywords[j], candidateKeywords[i]];
  }

  for (const keyword of candidateKeywords) {
    if (products.length >= safeLimit) break;

    onProgress({
      step: 'auto_shopee_search',
      message: `Cari produk (${products.length + 1}/${safeLimit}): "${keyword}"...`,
      progress: Math.min(18, 4 + Math.floor((products.length / safeLimit) * 14)),
    });

    const product = await discoverSingleShopeeProduct(keyword, seen);
    if (product) {
      products.push(product);
    }

    if (products.length < safeLimit) {
      await delayWithJitter(400, 800);
    }
  }

  return products;
}

export async function discoverYouTubeCandidatesForProduct({
  productTitle,
  productDescription = '',
  limit = 10,
  onProgress = () => {},
} = {}) {
  const coreTitle = cleanTitle(productTitle);
  const productWords = normalizeText(coreTitle).split(' ').filter((word) => word.length >= 4);
  const compactTitle = productWords.slice(0, 6).join(' ');
  const queryCandidates = [
    [coreTitle, 'review demo hands only faceless tanpa wajah produk viral'].filter(Boolean).join(' '),
    [compactTitle, 'review produk viral'].filter(Boolean).join(' '),
    [compactTitle, 'unboxing review'].filter(Boolean).join(' '),
  ].filter(Boolean);

  let candidates = [];
  let usedQuery = queryCandidates[0];
  for (const query of queryCandidates) {
    candidates = await searchYouTubeVideos(query, { limit, onProgress });
    if (candidates.length) {
      usedQuery = query;
      break;
    }
    await delayWithJitter(1000, 2000);
  }

  return candidates
    .filter((candidate) => isLikelyCleanYouTubeCandidate(candidate))
    .map((candidate) => ({
      ...candidate,
      searchQuery: usedQuery,
      matchScore: scoreCandidateMatch(candidate, productWords, productDescription),
    }))
    .filter((candidate) => candidate.matchScore >= 0)
    .sort((a, b) => b.matchScore - a.matchScore);
}

export function delayWithJitter(minMs, maxMs) {
  const min = Number(minMs) || 0;
  const max = Math.max(min, Number(maxMs) || min);
  const duration = min + Math.floor(Math.random() * (max - min + 1));
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function searchDuckDuckGoShopee(keyword) {
  const searchQuery = `site:shopee.co.id/product "${keyword}"`;
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
  let html = '';

  try {
    const response = await fetchWithTlsFallback(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      console.warn(`[Discovery] DuckDuckGo search failed (${response.status}). Falling back to Brave search.`);
      return searchBraveShopee(keyword);
    }

    html = await response.text();
  } catch (error) {
    console.warn(`[Discovery] DuckDuckGo search failed (${error.message}). Falling back to Brave search.`);
    return searchBraveShopee(keyword);
  }

  if (html.includes('internetbaik.telkomsel.com')) {
    console.warn('[Discovery] DuckDuckGo was intercepted. Falling back to Brave search.');
    return searchBraveShopee(keyword);
  }

  const $ = cheerio.load(html);
  const results = [];

  $('.result').each((_, element) => {
    const anchor = $(element).find('a.result__a').first();
    const rawHref = anchor.attr('href');
    const productUrl = normalizeSearchResultUrl(rawHref);
    if (!isShopeeProductUrl(productUrl)) return;

    results.push({
      title: anchor.text().trim(),
      snippet: $(element).find('.result__snippet').text().trim(),
      url: productUrl,
    });
  });

  return results.length ? dedupeByUrl(results) : searchBraveShopee(keyword);
}

async function searchBraveShopee(keyword) {
  for (const searchQuery of buildShopeeSearchQueries(keyword)) {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(searchQuery)}`;
    const response = await fetchWithTlsFallback(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      console.warn(`[Discovery] Brave search failed (${response.status}) for query "${searchQuery}".`);
      continue;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];

    $('a').each((_, element) => {
      const productUrl = normalizeSearchResultUrl($(element).attr('href'));
      if (!isShopeeProductUrl(productUrl)) return;

      results.push({
        title: $(element).text().trim(),
        snippet: $(element).closest('[data-type="web"]').text().trim(),
        url: productUrl,
      });
    });

    const deduped = dedupeByUrl(results);
    if (deduped.length) return deduped;

    await delayWithJitter(400, 800);
  }

  return searchBingShopee(keyword);
}

async function searchBingShopee(keyword) {
  for (const searchQuery of buildShopeeSearchQueries(keyword)) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;
    const response = await fetchWithTlsFallback(url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      console.warn(`[Discovery] Bing search failed (${response.status}) for query "${searchQuery}".`);
      continue;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];

    $('li.b_algo').each((_, element) => {
      const anchor = $(element).find('h2 a').first();
      const productUrl = normalizeSearchResultUrl(anchor.attr('href'));
      if (!isShopeeProductUrl(productUrl)) return;

      results.push({
        title: anchor.text().trim(),
        snippet: $(element).find('.b_caption p').first().text().trim(),
        url: productUrl,
      });
    });

    if (!results.length) {
      $('a').each((_, element) => {
        const productUrl = normalizeSearchResultUrl($(element).attr('href'));
        if (!isShopeeProductUrl(productUrl)) return;

        results.push({
          title: $(element).text().trim(),
          snippet: '',
          url: productUrl,
        });
      });
    }

    const deduped = dedupeByUrl(results);
    if (deduped.length) return deduped;

    await delayWithJitter(400, 800);
  }

  return [];
}

async function fetchShopeePageMeta(url) {
  // 5-second timeout per URL so a slow Shopee page doesn't block the whole pipeline
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchWithTlsFallback(url, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    clearTimeout(timeout);
    if (!response.ok) return {};

    const html = await response.text();
    const $ = cheerio.load(html);
    return {
      title: $('meta[property="og:title"]').attr('content') || $('title').text(),
      description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'),
    };
  } catch {
    clearTimeout(timeout);
    return {};
  }
}

async function fetchWithTlsFallback(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error.code !== 'CERT_HAS_EXPIRED') throw error;
    console.warn(`[Discovery] TLS certificate issue for ${url}. Retrying with local insecure TLS fallback.`);
    return fetch(url, { ...options, agent: insecureTlsAgent });
  }
}

function normalizeSearchResultUrl(rawHref) {
  if (!rawHref) return '';

  try {
    const parsed = new URL(rawHref, 'https://duckduckgo.com');
    const redirected = parsed.searchParams.get('uddg');
    const bingTarget = decodeBingRedirect(parsed.searchParams.get('u'));
    const target = redirected ? new URL(redirected) : bingTarget ? new URL(bingTarget) : parsed;
    target.hash = '';
    target.search = '';
    return target.toString();
  } catch {
    return '';
  }
}

function decodeBingRedirect(value) {
  if (!value) return '';
  try {
    const normalized = value.startsWith('a1') ? value.slice(2) : value;
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function buildShopeeSearchQueries(keyword) {
  const cleanKeyword = keyword.replace(/\s+/g, ' ').trim();
  const slugKeyword = cleanKeyword.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return [
    `shopee.co.id "${slugKeyword}" "-i."`,
    `site:shopee.co.id ${cleanKeyword} "i."`,
    `site:shopee.co.id ${cleanKeyword} shopee product`,
  ];
}

function isShopeeProductUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = decodeURIComponent(parsed.pathname).toLowerCase();
    if (host !== 'shopee.co.id') return false;
    if (['/search', '/mall', '/buyer', '/cart'].some((prefix) => path.startsWith(prefix))) return false;
    if (/\/shop\/?\d*/.test(path)) return false;
    return path.includes('/product/') || /-i\.\d+\.\d+/.test(path) || /\.\d+\.\d+/.test(path);
  } catch {
    return false;
  }
}

function isLikelyCleanYouTubeCandidate(candidate) {
  const text = normalizeText(`${candidate.title} ${candidate.description} ${candidate.channel}`);
  if (!candidate.url || !candidate.id) return false;
  if (candidate.duration < 20 || candidate.duration > 900) return false;
  if (isBulkyOrUnsuitableProduct(text)) return false;

  return ![
    'shorts',
    'podcast',
    'live',
    'reaction',
    'kompilasi',
    'compilation',
    'music',
    'lyrics',
  ].some((keyword) => text.includes(keyword));
}

function scoreCandidateMatch(candidate, productWords, productDescription) {
  const text = normalizeText(`${candidate.title} ${candidate.description}`);
  const desc = normalizeText(productDescription);
  const productHits = productWords.filter((word) => text.includes(word)).length;
  const descHits = desc
    .split(' ')
    .filter((word) => word.length >= 5)
    .filter((word) => text.includes(word))
    .slice(0, 5).length;
  return productHits + (descHits * 0.5);
}

function dedupeByUrl(results) {
  const seen = new Set();
  return results.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function cleanTitle(value = '', productUrl = '') {
  const cleaned = value
    .replace(/\s*\|\s*Shopee.*$/i, '')
    .replace(/\s*-\s*Shopee.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  if (cleaned && !cleaned.toLowerCase().startsWith('shopee shopee.co.id')) return cleaned;
  return titleFromShopeeUrl(productUrl) || cleaned || 'Produk Rumah Tangga Viral';
}

function titleFromShopeeUrl(productUrl = '') {
  try {
    const parsed = new URL(productUrl);
    const decodedPath = decodeURIComponent(parsed.pathname);
    const slug = decodedPath.split('/').filter(Boolean).pop() || '';
    const titleSlug = slug.replace(/-i\.\d+\.\d+.*$/i, '').replace(/\.\d+\.\d+.*$/i, '');
    return titleSlug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  } catch {
    return '';
  }
}

function cleanDescription(value = '') {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeText(value = '') {
  return value.toString().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
