import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import https from 'https';
import { searchYouTubeVideos, extractVideoId } from './downloader.js';

export const DEFAULT_AUTO_KEYWORDS = [
  // =========================================================================
  // 1. ALAT DAPUR, PEMOTONG & FOOD PREP (Kitchen Prep & Choppers)
  // =========================================================================
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
  'alat pemotong nanas spiral stainless',
  'alat pengiris daging beku manual slicer',
  'alat perajang bawang manual putar praktis',
  'alat pencacah daging manual serbaguna',
  'alat pelubang kelapa muda praktis stainless',
  'parutan wortel kentang 6 in 1 multifungsi',
  'alat pencabut bulu ayam ikan stainless',
  'alat pemotong alpukat 3 in 1 praktis',
  'alat pengiris telur rebus praktis stainless',
  'alat pemotong jagung serut stainless',
  'alat pengupas sisik ikan stainless praktis',
  'alat pemecah cangkang kepiting walnut',
  'blender kapsul serbaguna mini cutter',
  'alat pelumat kentang potato masher stainless',
  'alat pengiris mentega keju butter slicer',
  'alat pemeras santan kelapa manual mini',
  'alat penusuk daging tenderizer empuk',
  'gunting daging tulang unggas heavy duty',
  'alat pemotong pizza roda stainless bulat',
  'alat pembuka kaleng putar praktis aman',
  'alat pembuka tutup botol toples serbaguna',
  'parutan serbaguna wadah penampung baskom',

  // =========================================================================
  // 2. PENYIMPANAN, WADAH & ORGANIZER DAPUR (Kitchen Storage & Organizers)
  // =========================================================================
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
  'tempat pisau dapur magnetic strip dinding',
  'wadah penyimpanan sayur kulkas drain basket',
  'kotak bumbu dapur putar 360 derajat',
  'dispenser minyak goreng kaca otomatis tuang',
  'rak sudut dapur susun serbaguna stainless',
  'wadah kantong teh kopi gula kedap udara',
  'kotak penyimpanan bawang cabai mini kulkas',
  'rak bawah wastafel dapur expandable adjustable',
  'rak piring stainless susun 2 tingkat tirisan',
  'organizer kulkas laci gantung slide drawer',
  'wadah bumbu dapur kaca label estetik',
  'dispenser air galon meja mini keran',
  'rak gantung spons cuci piring kran wastafel',
  'tatakan sendok spatula silikon anti kotor meja',
  'rak penyimpanan talenan nampan dapur standing',
  'toples kaca kedap udara tutup bambu estetik',
  'dispenser sereal biji-bijian putar otomatis',
  'tempat tisu gulung dapur magnetik kulkas',
  'rak gantung gelas wine cangkir bawah lemari',
  'wadah minyak bekas jelantah saringan stainless',
  'kotak organizer bumbu sachet kulkas dapur',
  'rak bumbu dapur tingkat tangga akrilik estetik',
  'penutup makanan payung tudung saji lipat',

  // =========================================================================
  // 3. PERALATAN MASAK MINI & BAKING (Mini Cooking & Baking Gadgets)
  // =========================================================================
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
  'alat pembuat crepes mini elektrik anti lengket',
  'panci kukus mini elektrik serbaguna',
  'cetakan takoyaki mini anti lengket teflon',
  'wajan grill pan mini anti lengket pemanggang',
  'mixer tangan mini elektrik portable usb',
  'frother pengocok susu kopi mini elektrik',
  'kertas baking parchment paper air fryer bulat',
  'silikon pot air fryer reusable anti lengket',
  'cetakan es loli popsicle silikon bpa free',
  'dispenser adonan kue pencet pancake batter',
  'spatula silikon tahan panas food grade set',
  'kuas minyak silikon baking tahan panas',
  'cetakan donat manual praktis adonan',
  'rolling pin kayu silikon penggiling adonan',
  'cetakan puding silikon bentuk bunga estetik',
  'sendok takar bumbu dapur digital lcd',
  'saringan tepung stainless putar manual praktis',
  'pemanggang sandwich toaster mini elektrik',
  'cetakan sushi roll manual praktis bazooka',
  'cetakan onigiri nasi bento segitiga praktis',
  'alat tusuk sate praktis pembuat sate cepat',
  'cetakan martabak mini 7 lubang anti lengket',
  'panci rebus mie telur mini stainless gagang',
  'penutup silikon microwave anti cipratan',
  'tatakan kompor gas pelindung api hemat gas',
  'pematik api kompor gas elektrik usb recharge',

  // =========================================================================
  // 4. ALAT KEBERSIHAN RUMAH & DAPUR (Cleaning Gadgets)
  // =========================================================================
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
  'lap microfiber cuci piring serap air tebal',
  'alat pembersih debu kolong kasur fleksibel panjang',
  'sikat pembersih celah ubin keramik kawat baja',
  'alat penyedot debu mini vacuum meja usb',
  'pembersih bulu hewan baju karpet lint remover',
  'sikat pembersih kawat sarang nyamuk jendela',
  'alat pel lantai mikrofiber jepit otomatis peras',
  'sikat pembersih dispenser galon air elektrik',
  'spons kawat cuci piring sabut stainless anti gores',
  'kain lap nano berserat pembersih minyak dapur',
  'alat pembersih kerak wajan panci serbaguna',
  'pembersih jamur kaca jendela kamar mandi',
  'sikat sudut kamar mandi bentuk segitiga putar',
  'penghisap debu wireless vacuum cleaner portable',
  'pembersih lantai robot otomatis sweep vacuum',
  'sikat pembersih blender mata pisau dapur',
  'wiper pembersih lantai silikon pengeruk air',
  'sikat pembersih rantai motor sepeda multifungsi',
  'alat semprot cuci mobil busa salju manual',

  // =========================================================================
  // 5. ORGANIZER & GADGET RUMAH TANGGA (Home Gadgets & Organizers)
  // =========================================================================
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
  'kantong vakum pakaian kompres hemat lemari',
  'kotak penyimpanan selimut baju serbaguna zipper',
  'gantungan baju ajaib 9 lubang magic hanger',
  'lampu tidur proyektor bintang galaksi led',
  'rak gantung celana jins 5 tingkat hemat tempat',
  'lampu meja belajar led lipat touch sensor',
  'gantungan tas jilbab lemari susun hanger',
  'penjepit sprei kasur elastis anti geser lepas',
  'stop kontak putar anti petir usb fast charge',
  'kotak obat p3k mini organizer susun sekat',
  'tempat sampah pintar sensor gerak otomatis',
  'rak gantung pintu organizer sepatu serbaguna',
  'diffuser lilin elektrik aroma terapi ruangan',
  'penjepit kantong sampah gantungan wastafel',
  'gembok koper kombinasi angka tsa anti maling',
  'perangkap nyamuk elektrik led uv suction',
  'rak susun meja kantor atk organizer laci',
  'kotak tisu serbaguna holder handphone meja',
  'jam weker digital led temperatur suhu meja',
  'rak pajangan dinding heksagonal minimalis',
  'gantungan kunci tempel magnetik dinding estetik',
  'pengganjal pintu karet silikon stopper lantai',

  // =========================================================================
  // 6. KAMAR MANDI, SANITASI & LAUNDRY (Bathroom & Laundry Gadgets)
  // =========================================================================
  'keset kaki diatomite menyerap air cepat kering',
  'kepala shower turbo propeller hemat air bertekanan',
  'dispenser sabun cair otomatis sensor sentuh',
  'gantungan handuk tempel dinding lipat stainless',
  'tempat sikat gigi sterilizer uv anti bakteri',
  'tutup saluran floor drain anti bau dan serangga',
  'spons mandi pengangkat sel kulit mati daki',
  'pemberat tirai kamar mandi magnetik anti air',
  'gantungan shower head tempel dinding adjustable',
  'tempat sabun batang tirisan bentuk daun unik',
  'kantong cuci baju jaring mesin cuci bra laundry net',
  'jepitan jemuran baju stainless steel anti karat',
  'sikat punggung mandi silikon gagang panjang',
  'papan gilasan baju silikon mini wastafel',
  'rak gantung pengering sepatu gantungan balkon',
  'sarung tangan cuci piring silikon bergerigi',
  'dispenser plastik pembungkus sepatu otomatis',
  'alat pencuci kuas makeup elektrik cleaner dryer',
  'rak gantung pengering pakaian jemuran lipat dinding',
  'penyaring rambut kotoran mesin cuci laundry filter',

  // =========================================================================
  // 7. GADGET MEJA KERJA, ELEKTRONIK & GAYA HIDUP (Desk, Tech & Lifestyle)
  // =========================================================================
  'stand holder handphone lipat meja aluminium',
  'stand laptop portable lipat pendingin aluminium',
  'kipas angin mini portable leher neck fan usb',
  'kipas angin meja portable baterai rechargeable',
  'mouse pad extended meja kerja kulit pu anti air',
  'lampu led strip rgb kamar tv usb sensor suara',
  'alat pembersih layar handphone semprot microfiber',
  'kabel data 3 in 1 magnetik fast charging',
  'holder handphone mobil magnetik ac dashboard',
  'vacuum cleaner mobil wireless portable mini',
  'tempat sampah mini mobil cup holder praktis',
  'charger mobil fast charging usb type c led',
  'alat pijat leher pundak elektrik ems massage',
  'alat pijat mata elektrik kompres hangat relaksasi',
  'gunting kuku elektrik bayi dewasa aman otomatis',
  'alat cukur bulu hidung telinga elektrik portable',
  'alat pembersih komedo pori wajah vakum cleaner',
  'face roller guasha pijat wajah elektrik getar',
  'catokan rambut mini portable travel anti rusak',
  'pelipat baju praktis lipat pakaian instan',
  'botol minum motivasi 2 liter penanda waktu',
  'payung lipat otomatis buka tutup tombol anti uv',
  'bantal leher memory foam travel portable empuk',
  'timbangan koper digital gantung mini praktis',
  'kacamata anti radiasi sinar biru blueray komputer',
  'alat pengering sepatu elektrik timer otomatis',
  'pelindung kabel charger spiral silikon kartun',
  'pouch kabel organizer travel waterproof gadget bag',
  'ring light mini selfie clip on handphone led',
  'mikrofon wireless clip on type c podcast rekaman',

  // =========================================================================
  // 8. ALAT PERTUKANGAN MINI & PERBAIKAN RUMAH (Mini Tools & DIY)
  // =========================================================================
  'obeng elektrik mini set presisi rechargeable usb',
  'meteran laser digital ukur jarak presisi portable',
  'lem perekat serbaguna super glue serbaguna kuat',
  'lakban tambal bocor atap pipa anti air aluminium',
  'stiker tambal kasur sofa kulit jok mobil sofa patch',
  'alat pelubang sabuk kulit ikat pinggang putar',
  'palu mini serbaguna multifungsi multi tools',
  'tang lipat multifungsi stainless pisau obeng camping',
  'lem bakar tembak glue gun mini praktis diy',
  'klem penjepit sudut siku kayu 90 derajat diy',
  'alat pengangkat barang berat perabot roda ganjal',
  'lakban nano bening double tape serbaguna kuat cuci',
  'senter led super terang usb rechargeable zoom',
  'gantungan kunci perkakas 18 in 1 snowflake tool',
  'gergaji tangan lipat serbaguna kayu dahan pohon',
  'kunci pas universal multifungsi serbaguna baut',
  'alat pendeteksi kabel dinding wall scanner led',
  'karet pelindung kaki meja kursi silikon peredam',
  'stiker wallpaper dinding 3d bata busa foam kedap',
  'alat semprot tanaman busa manual bertekanan'
];

/**
 * Returns a randomized, expansive array of 1000+ unique product keywords
 * by combining our curated base keywords with high-intent e-commerce product modifiers.
 */
export function getAutoKeywords(limit = 1000) {
  const combinedSet = new Set(DEFAULT_AUTO_KEYWORDS);

  const productNouns = [
    'chopper', 'blender', 'parutan', 'slicer', 'pisau', 'gunting', 'pengupas',
    'botol minyak', 'rak bumbu', 'dispenser beras', 'kotak telur', 'sealer plastik',
    'wajan mini', 'panci listrik', 'sutil silikon', 'timbangan digital', 'cetakan es',
    'sikat elektrik', 'dispenser sabun', 'spray mop', 'pel putar', 'pel mini',
    'kemoceng microfiber', 'sikat botol', 'wiper kaca', 'sikat kloset', 'lint roller',
    'magic sponge', 'pembersih wastafel', 'lampu sensor', 'pompa galon', 'humidifier',
    'dispenser odol', 'organizer pakaian', 'gantungan baju', 'rak sepatu', 'vacuum cleaner',
    'stand hp', 'stand laptop', 'kipas mini', 'alat pijat', 'catokan mini', 'botol minum',
    'payung lipat', 'bantal leher', 'obeng elektrik', 'lem serbaguna', 'lakban nano',
    'shower turbo', 'sikat punggung mandi', 'tutup saluran silikon', 'lampu tidur proyektor',
    'alat pembuat dumpling', 'pemeras jeruk lemon', 'pemotong kentang spiral', 'cetakan bakso',
    'alat pengasah pisau', 'termometer makanan', 'frother pengocok susu', 'silikon air fryer',
    'kotak organizer kabel', 'stop kontak usb', 'jam weker digital', 'keset diatomite',
    'alat pembersih komedo', 'gunting kuku elektrik', 'alat pengering sepatu', 'meteran laser'
  ];

  const modifiers = [
    'mini portable viral',
    'multifungsi serbaguna',
    'praktis anti tumpah',
    'otomatis rechargeable usb',
    'stainless anti karat',
    'silikon food grade',
    'tempel dinding tanpa paku',
    'lipat hemat tempat',
    'hemat listrik estetik',
    'rekomendasi racun shopee',
    'kualitas premium awet',
    'unik berfaedah murah',
    'praktis untuk dapur',
    'solusi rumah tangga rapi',
    'review produk viral tiktok',
    'alat rumah tangga modern'
  ];

  for (const noun of productNouns) {
    for (const mod of modifiers) {
      combinedSet.add(`${noun} ${mod}`);
      if (combinedSet.size >= limit) break;
    }
    if (combinedSet.size >= limit) break;
  }

  const allKeywords = Array.from(combinedSet);
  // Shuffle array thoroughly
  for (let i = allKeywords.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allKeywords[i], allKeywords[j]] = [allKeywords[j], allKeywords[i]];
  }

  return allKeywords.slice(0, limit);
}

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

let cachedDdgIp = '20.43.161.105'; // Known Azure IP for DuckDuckGo
let lastDdgIpLookup = 0;

async function resolveDdgIp() {
  const now = Date.now();
  if (cachedDdgIp && now - lastDdgIpLookup < 3600000) {
    return cachedDdgIp;
  }
  try {
    const res = await fetch('https://dns.google/resolve?name=html.duckduckgo.com&type=A', {
      agent: insecureTlsAgent,
      timeout: 3000,
    });
    if (res.ok) {
      const json = await res.json();
      const ip = json?.Answer?.find((a) => a.type === 1)?.data;
      if (ip) {
        cachedDdgIp = ip;
        lastDdgIpLookup = now;
        return ip;
      }
    }
  } catch {
    // Keep fallback IP
  }
  return cachedDdgIp;
}

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

        const rawTitle = pageMeta.title || result.title || '';
        let titleCandidate = cleanTitle(rawTitle, result.url);
        if (!titleCandidate || isGenericShopeeTitle(titleCandidate)) {
          titleCandidate = formatKeywordToProductTitle(keyword);
        }
        const descCandidate = cleanDescription(pageMeta.description || result.snippet || '') || `Produk praktis viral: ${titleCandidate}.`;

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
  excludeVideoIds = new Set(),
  searchIteration = 0,
  onProgress = () => {},
} = {}) {
  const excludeSet = excludeVideoIds instanceof Set ? excludeVideoIds : new Set(excludeVideoIds || []);
  const productInfo = extractCoreProductInfo(productTitle, productDescription);
  const coreNoun = productInfo.coreProductNoun || cleanTitle(productTitle) || 'Produk';
  const coreWords = productInfo.coreWords || [];

  // Dynamic search query candidate sets from productInfo (high-intent, zero promo-spam)
  const baseQueryCandidates = productInfo.searchQueries;

  // Rotate query order based on searchIteration so consecutive auto retry attempts hit fresh queries first
  const offset = searchIteration % baseQueryCandidates.length;
  const queryCandidates = [...baseQueryCandidates.slice(offset), ...baseQueryCandidates.slice(0, offset)];

  let candidates = [];
  let usedQuery = queryCandidates[0];

  for (const query of queryCandidates) {
    const rawResults = await searchYouTubeVideos(query, { limit, onProgress });
    if (rawResults && rawResults.length) {
      // 1. Filter out videos that have already been processed in past or current jobs
      const freshResults = rawResults.filter((c) => {
        const vid = c.id || extractVideoId(c.url);
        return vid && !excludeSet.has(vid);
      });

      // 2. Only accept if the query produced compliant candidate(s) (5-15 min, faceless, multi-word matching)
      const cleanResults = freshResults.filter((c) => isLikelyCleanYouTubeCandidate(c, coreWords));

      if (cleanResults.length > 0) {
        candidates = cleanResults;
        usedQuery = query;
        break;
      }
    }
    await delayWithJitter(300, 600);
  }

  // Fallback: If all results were previously used or cleanResults was empty, search exact core noun
  if (!candidates.length) {
    const fallbackResults = await searchYouTubeVideos(`${coreNoun} review`, { limit, onProgress });
    const nonExcluded = (fallbackResults || []).filter((c) => {
      const vid = c.id || extractVideoId(c.url);
      return vid && !excludeSet.has(vid) && isLikelyCleanYouTubeCandidate(c, coreWords);
    });
    candidates = nonExcluded;
  }

  const cleanCandidates = candidates
    .filter((candidate) => isLikelyCleanYouTubeCandidate(candidate, coreWords))
    .map((candidate) => ({
      ...candidate,
      searchQuery: usedQuery,
      coreProductNoun: coreNoun,
      matchScore: scoreCandidateMatch(candidate, coreWords, productDescription),
    }))
    .filter((candidate) => candidate.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore);

  // Return strictly vetted, compliant candidates (5-15 min, clean content); NEVER leak disqualified raw candidates
  return cleanCandidates;
}

export function delayWithJitter(minMs, maxMs) {
  const min = Number(minMs) || 0;
  const max = Math.max(min, Number(maxMs) || min);
  const duration = min + Math.floor(Math.random() * (max - min + 1));
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function searchDuckDuckGoShopee(keyword) {
  const cleanKeyword = String(keyword || '').replace(/\s+/g, ' ').trim();
  // Include "produk rumah tangga" as requested to target real household Shopee products
  const searchQueries = [
    `"${cleanKeyword}" produk rumah tangga site:shopee.co.id`,
    `${cleanKeyword} produk rumah tangga site:shopee.co.id`,
    `"${cleanKeyword}" site:shopee.co.id`,
  ];

  const ddgIp = await resolveDdgIp();
  const ddgAgent = new https.Agent({
    rejectUnauthorized: false,
    servername: 'html.duckduckgo.com',
  });

  for (const searchQuery of searchQueries) {
    try {
      const url = `https://${ddgIp}/html/?q=${encodeURIComponent(searchQuery)}`;
      const response = await fetch(url, {
        agent: ddgAgent,
        timeout: 4500,
        headers: {
          'Host': 'html.duckduckgo.com',
          'user-agent': USER_AGENT,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      if (!response || !response.ok) continue;

      const html = await response.text();
      if (html.includes('internetbaik.telkomsel.com') || html.includes('blocked')) continue;

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

      if (results.length > 0) {
        return dedupeByUrl(results);
      }
    } catch {
      // Continue to next query / search engine
    }
  }

  return searchBraveShopee(keyword);
}

async function searchBraveShopee(keyword) {
  for (const searchQuery of buildShopeeSearchQueries(keyword).slice(0, 1)) {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(searchQuery)}`;
    try {
      const response = await fetchWithTlsFallback(url, {
        timeoutMs: 2500,
        headers: {
          'user-agent': USER_AGENT,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      if (!response || !response.ok) {
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
    } catch {
      continue;
    }
  }

  return searchBingShopee(keyword);
}

async function searchBingShopee(keyword) {
  for (const searchQuery of buildShopeeSearchQueries(keyword).slice(0, 1)) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;
    try {
      const response = await fetchWithTlsFallback(url, {
        timeoutMs: 2500,
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });

      if (!response || !response.ok) {
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

      const deduped = dedupeByUrl(results);
      if (deduped.length) return deduped;
    } catch {
      continue;
    }
  }

  return [];
}

async function fetchShopeePageMeta(url) {
  try {
    const response = await fetchWithTlsFallback(url, {
      timeoutMs: 3000,
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    if (!response || !response.ok) return {};

    const html = await response.text();
    const $ = cheerio.load(html);
    return {
      title: $('meta[property="og:title"]').attr('content') || $('title').text(),
      description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'),
    };
  } catch {
    return {};
  }
}

async function fetchWithTlsFallback(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const cleanOptions = { ...options };
    delete cleanOptions.timeoutMs;
    const response = await fetch(url, {
      agent: insecureTlsAgent,
      ...cleanOptions,
      signal: cleanOptions.signal || controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
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

export function isLikelyCleanYouTubeCandidate(candidate, productWords = []) {
  if (!candidate.url || !candidate.id) return false;
  // If duration is known, reject if too short (< 5 min / 300s) or too long (> 15 min / 900s)
  if (candidate.duration > 0 && (candidate.duration < 300 || candidate.duration > 900)) return false;

  const titleText = normalizeText(candidate.title || '');
  if (isBulkyOrUnsuitableProduct(titleText)) return false;

  const excludedTitleWords = [
    'podcast', 'reaction', 'kompilasi', 'compilation', 'kumpulan', 'full album', 'playlist',
    'vlog', 'daily vlog', 'a day in my life', 'cerita', 'bincang', 'talkshow', 'ngobrol',
    'cara belanja', 'cara checkout', 'daftar akun', 'tutorial aplikasi', 'cara jualan', 'cara live',
    'shopee affiliate tutorial', 'aplikasi shopee',
    // Creator/face-centric and person-focused videos
    'muka', 'wajah', 'facecam', 'webcam', 'selfie', 'grwm', 'get ready with me',
    'try on haul', 'try on', 'outfit', 'ootd', 'mukbang', 'skincare routine', 'makeup tutorial',
    // Subtitle & lyric indicators (wajib dihindari agar tidak tabrakan subtitle)
    'sub indo', 'subtitle', 'subtitles', 'sub english', 'eng sub', 'terjemahan', 'lirik',
    // Social media re-uploads & watermark indicators (wajib bersih tanpa logo sosmed/watermark)
    'tiktok', 'douyin', 'kuaishou', 'capcut', 'repost', 'watermark', 'shorts tiktok', 'video tiktok', 'vt tiktok',
    // Compilation / multi-product videos (cause mismatch with single Shopee link)
    'top 10', 'top 5', 'top 7', 'top 3', '5 alat', '10 alat', '7 alat', 'rekomendasi barang',
    'racun shopee haul', 'haul shopee', 'haul tiktok', 'unboxing haul', 'berbagai alat', 'kumpulan gadget',
    // Filter AI-generated, synthetic, and cartoon/3D animation
    'ai generated', 'ai video', 'generative ai', 'sora', 'runway', 'kling', 'hailuo', 'pika',
    'animation', 'animasi', '3d animation', 'cgi', 'cartoon', 'kartun', 'anime'
  ];
  if (excludedTitleWords.some((keyword) => titleText.includes(keyword))) return false;

  // Strict check: Candidate title MUST match core product keywords with multi-word intersection & cross-category exclusion
  if (Array.isArray(productWords) && productWords.length > 0) {
    if (!isTitleMatchingProduct(candidate.title, productWords)) {
      return false;
    }
  }

  return true;
}

export function scoreCandidateMatch(candidate, productWords, productDescription) {
  const titleText = normalizeText(candidate.title || '');
  const descText = normalizeText(candidate.description || '');
  const fullText = `${titleText} ${descText}`;

  // Prioritize title hits over description to guarantee exact product alignment
  const titleHits = productWords.filter((word) => titleText.includes(word)).length;
  const fullHits = productWords.filter((word) => fullText.includes(word)).length;

  const desc = normalizeText(productDescription);
  const descHits = desc
    .split(' ')
    .filter((word) => word.length >= 5)
    .filter((word) => fullText.includes(word))
    .slice(0, 5).length;

  return (titleHits * 3) + fullHits + (descHits * 0.5);
}

function dedupeByUrl(results) {
  const seen = new Set();
  return results.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export function isGenericShopeeTitle(title = '') {
  const norm = normalizeText(title);
  if (!norm || norm.length < 4) return true;
  const genericPatterns = [
    'shopee indonesia',
    'situs belanja online',
    'terlengkap terpercaya',
    'jual beli online',
    'pusat perbelanjaan',
    'online shopping',
    'shopee co id',
    'marketplace',
  ];
  return genericPatterns.some((pattern) => norm.includes(pattern));
}

export function cleanTitle(value = '', productUrl = '') {
  let cleaned = String(value || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(?:cod|promo|murah|diskon|ori|import|garansi)[^)]*\)/gi, ' ')
    .replace(/[【】〔〕〖〗（）]/g, ' ')
    .replace(/(?:🛒|🔥|⭐|💥|⚡|✨|🏆|🎉|👍|✅|📢|🔴|▶️)/gu, ' ')
    .replace(/\s*\|\s*Shopee.*$/i, '')
    .replace(/\s*-\s*Shopee.*$/i, '')
    .replace(/^Shopee\s*(Indonesia)?\s*[:|–-]?\s*/i, '')
    .replace(/\b(?:cod|bisa cod|bayar di tempat|ready stock|ready|promo|diskon|murah|termurah|terlaris|terbaru|terlengkap|original|ori|asli|import|impor|100% original|official store|hot sale|flash sale|best seller|viral|viral tiktok|gratis ongkir|free ongkir|hemat|garansi resmi|garansi \d+ tahun)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  if (cleaned && !isGenericShopeeTitle(cleaned)) return cleaned;
  
  const fromUrl = titleFromShopeeUrl(productUrl);
  if (fromUrl && !isGenericShopeeTitle(fromUrl)) return fromUrl;

  return '';
}

export const PRODUCT_ANCHORS = [
  // 1. Kitchen Prep & Choppers
  { pattern: /\b(?:chopper\s+(?:mini|elektrik|portable|tarik|wireless)|food\s+chopper|blender\s+mini|blender\s+kapsul|mini\s+cutter)\b/i, noun: 'Chopper Mini Elektrik', category: 'kitchen_prep', core: ['chopper', 'mini'] },
  { pattern: /\b(?:gunting\s+dapur|gunting\s+sk5|gunting\s+tulang|kitchen\s+shears)\b/i, noun: 'Gunting Dapur SK5', category: 'kitchen_prep', core: ['gunting', 'dapur'] },
  { pattern: /\b(?:mandoline\s+slicer|pemotong\s+sayur|parutan\s+multifungsi|parutan\s+serbaguna|parutan\s+6\s*in\s*1)\b/i, noun: 'Pemotong Sayur Multifungsi', category: 'kitchen_prep', core: ['pemotong', 'sayur'] },
  { pattern: /\b(?:pengupas\s+buah|peeler\s+buah|pengupas\s+kulit|pisau\s+peeler)\b/i, noun: 'Alat Pengupas Buah Praktis', category: 'kitchen_prep', core: ['pengupas', 'buah'] },
  { pattern: /\b(?:pemeras\s+jeruk|pemeras\s+lemon|citrus\s+squeezer|perasan\s+jeruk)\b/i, noun: 'Alat Pemeras Jeruk Manual', category: 'kitchen_prep', core: ['pemeras', 'jeruk'] },
  { pattern: /\b(?:pemotong\s+semangka|pemotong\s+melon|watermelon\s+slicer)\b/i, noun: 'Pemotong Semangka Praktis', category: 'kitchen_prep', core: ['pemotong', 'semangka'] },
  { pattern: /\b(?:pelumat\s+bawang|press\s+garlic|penghancur\s+bawang|garlic\s+press)\b/i, noun: 'Alat Pelumat Bawang Putih', category: 'kitchen_prep', core: ['bawang', 'garlic'] },
  { pattern: /\b(?:cetakan\s+bakso|pembuat\s+bakso|meatball\s+maker)\b/i, noun: 'Cetakan Bakso Manual Praktis', category: 'kitchen_prep', core: ['cetakan', 'bakso'] },
  { pattern: /\b(?:pemotong\s+daging\s+beku|meat\s+slicer\s+manual|pengiris\s+daging)\b/i, noun: 'Alat Pengiris Daging Manual', category: 'kitchen_prep', core: ['pengiris', 'daging'] },
  { pattern: /\b(?:pembuat\s+dumpling|cetakan\s+pastel|dumpling\s+maker)\b/i, noun: 'Alat Pembuat Dumpling Pastel', category: 'kitchen_prep', core: ['dumpling', 'pastel'] },
  { pattern: /\b(?:sealer\s+plastik|perekat\s+plastik|heat\s+sealer|mini\s+sealer)\b/i, noun: 'Sealer Plastik Mini Portable', category: 'kitchen_prep', core: ['sealer', 'plastik'] },
  { pattern: /\b(?:pengasah\s+pisau|knife\s+sharpener|asah\s+pisau)\b/i, noun: 'Alat Pengasah Pisau Praktis', category: 'kitchen_prep', core: ['pengasah', 'pisau'] },
  { pattern: /\b(?:timbangan\s+digital|kitchen\s+scale|timbangan\s+dapur)\b/i, noun: 'Timbangan Dapur Digital', category: 'kitchen_prep', core: ['timbangan', 'digital'] },
  { pattern: /\b(?:timer\s+dapur|kitchen\s+timer)\b/i, noun: 'Timer Dapur Digital Magnetik', category: 'kitchen_prep', core: ['timer', 'dapur'] },
  { pattern: /\b(?:frother|pengocok\s+susu|pengocok\s+telur\s+mini|milk\s+frother)\b/i, noun: 'Frother Pengocok Susu Mini', category: 'kitchen_prep', core: ['frother', 'pengocok'] },
  { pattern: /\b(?:hand\s+mixer|mixer\s+tangan\s+mini|mixer\s+portable)\b/i, noun: 'Mixer Tangan Mini Portable', category: 'kitchen_prep', core: ['mixer', 'mini'] },

  // 2. Cookware & Pots
  { pattern: /\b(?:panci\s+listrik|panci\s+elektrik|electric\s+(?:pot|cooker|pan|skillet)|multi\s+cooker\s+mini)\b/i, noun: 'Panci Listrik Mini Serbaguna', category: 'cooking_pot', core: ['panci', 'listrik'] },
  { pattern: /\b(?:wajan\s+telur\s+4|wajan\s+mini|frypan\s+mini|pan\s+4\s+lubang)\b/i, noun: 'Wajan Mini Telur 4 Lubang', category: 'cooking_pot', core: ['wajan', 'telur'] },
  { pattern: /\b(?:pembuat\s+waffle|waffle\s+maker|cetakan\s+waffle)\b/i, noun: 'Alat Pembuat Waffle Mini', category: 'cooking_pot', core: ['waffle', 'maker'] },
  { pattern: /\b(?:sutil\s+silikon|spatula\s+silikon|spatula\s+set|silicone\s+spatula)\b/i, noun: 'Sutil Silikon Set Tahan Panas', category: 'cooking_pot', core: ['sutil', 'silikon'] },
  { pattern: /\b(?:cetakan\s+es\s+batu|ice\s+cube\s+tray|cetakan\s+es\s+silikon)\b/i, noun: 'Cetakan Es Batu Silikon', category: 'cooking_pot', core: ['cetakan', 'batu'] },
  { pattern: /\b(?:pemanggang\s+sandwich|sandwich\s+maker|toaster\s+mini)\b/i, noun: 'Pemanggang Sandwich Mini Elektrik', category: 'cooking_pot', core: ['sandwich', 'pemanggang'] },
  { pattern: /\b(?:cetakan\s+takoyaki|takoyaki\s+pan)\b/i, noun: 'Cetakan Takoyaki Mini', category: 'cooking_pot', core: ['cetakan', 'takoyaki'] },
  { pattern: /\b(?:pot\s+air\s+fryer|silikon\s+air\s+fryer|wadah\s+air\s+fryer)\b/i, noun: 'Wadah Silikon Air Fryer', category: 'cooking_pot', core: ['silikon', 'fryer'] },
  { pattern: /\b(?:termometer\s+makanan|cooking\s+thermometer)\b/i, noun: 'Termometer Makanan Digital', category: 'cooking_pot', core: ['termometer', 'makanan'] },

  // 3. Storage, Bottles & Organizers
  { pattern: /\b(?:botol\s+minum\s+motivasi|botol\s+motivasi|botol\s+minum\s+2\s*l(?:iter)?)\b/i, noun: 'Botol Minum Motivasi 2 Liter', category: 'storage_organizer', core: ['botol', 'minum'] },
  { pattern: /\b(?:botol\s+minyak\s+kuas|botol\s+minyak|oil\s+dispenser|spray\s+minyak)\b/i, noun: 'Botol Minyak Kuas Silikon', category: 'storage_organizer', core: ['botol', 'minyak'] },
  { pattern: /\b(?:tempat\s+bumbu\s+putar|rak\s+bumbu\s+putar|kotak\s+bumbu\s+putar)\b/i, noun: 'Tempat Bumbu Putar Dapur', category: 'storage_organizer', core: ['bumbu', 'putar'] },
  { pattern: /\b(?:dispenser\s+beras|tempat\s+beras|rice\s+dispenser|kotak\s+beras)\b/i, noun: 'Dispenser Beras Otomatis', category: 'storage_organizer', core: ['dispenser', 'beras'] },
  { pattern: /\b(?:wadah\s+telur|kotak\s+telur|rolling\s+egg|rak\s+telur\s+kulkas)\b/i, noun: 'Wadah Telur Kulkas Otomatis', category: 'storage_organizer', core: ['wadah', 'telur'] },
  { pattern: /\b(?:tutup\s+makanan\s+silikon|silicone\s+stretch\s+lid)\b/i, noun: 'Tutup Makanan Silikon Stretch', category: 'storage_organizer', core: ['tutup', 'silikon'] },
  { pattern: /\b(?:rak\s+bumbu|rak\s+dapur\s+stainless|rak\s+gantung\s+dapur)\b/i, noun: 'Rak Bumbu Dapur Serbaguna', category: 'storage_organizer', core: ['rak', 'bumbu'] },
  { pattern: /\b(?:rak\s+tirisan|rak\s+piring\s+wastafel|dish\s+drainer)\b/i, noun: 'Rak Tirisan Piring Wastafel', category: 'storage_organizer', core: ['rak', 'tirisan'] },
  { pattern: /\b(?:dispenser\s+sabun\s+cuci\s+piring|soap\s+pump\s+sponge)\b/i, noun: 'Dispenser Sabun Cuci Piring Sponge', category: 'storage_organizer', core: ['dispenser', 'sabun'] },

  // 4. Cleaning Gadgets
  { pattern: /\b(?:alat\s+pel\s+spray|spray\s+mop|pel\s+semprot)\b/i, noun: 'Alat Pel Semprot Spray Mop', category: 'cleaning', core: ['pel', 'spray'] },
  { pattern: /\b(?:pel\s+putar|spin\s+mop|pel\s+peras\s+otomatis)\b/i, noun: 'Alat Pel Peras Putar Otomatis', category: 'cleaning', core: ['pel', 'putar'] },
  { pattern: /\b(?:pel\s+mini|sponge\s+mop\s+mini|alat\s+pel\s+meja)\b/i, noun: 'Alat Pel Mini Meja Portable', category: 'cleaning', core: ['pel', 'mini'] },
  { pattern: /\b(?:sikat\s+pembersih\s+elektrik|electric\s+cleaning\s+brush|spin\s+scrubber)\b/i, noun: 'Sikat Pembersih Elektrik Mini', category: 'cleaning', core: ['sikat', 'elektrik'] },
  { pattern: /\b(?:kemoceng\s+microfiber|duster\s+microfiber)\b/i, noun: 'Kemoceng Microfiber Tarik Fleksibel', category: 'cleaning', core: ['kemoceng', 'microfiber'] },
  { pattern: /\b(?:wiper\s+kaca|pengeruk\s+pembersih\s+kaca|glass\s+wiper)\b/i, noun: 'Pengeruk Pembersih Kaca Wiper', category: 'cleaning', core: ['pembersih', 'kaca'] },
  { pattern: /\b(?:sikat\s+kloset\s+silikon|toilet\s+brush\s+silicone)\b/i, noun: 'Sikat Kloset Silikon Praktis', category: 'cleaning', core: ['sikat', 'kloset'] },
  { pattern: /\b(?:lint\s+roller|pembersih\s+bulu|lint\s+remover)\b/i, noun: 'Pembersih Bulu Lint Roller', category: 'cleaning', core: ['pembersih', 'bulu'] },
  { pattern: /\b(?:nano\s+magic\s+sponge|spons\s+nano|spons\s+cuci\s+piring)\b/i, noun: 'Spons Nano Cuci Piring Magic', category: 'cleaning', core: ['spons', 'nano'] },
  { pattern: /\b(?:vacuum\s+cleaner|penyedot\s+debu\s+mini|vacuum\s+portable)\b/i, noun: 'Penyedot Debu Mini Portable', category: 'cleaning', core: ['vacuum', 'debu'] },

  // 5. Home Gadgets & Living
  { pattern: /\b(?:pompa\s+galon|water\s+pump\s+dispenser)\b/i, noun: 'Pompa Galon Elektrik Otomatis', category: 'home_gadget', core: ['pompa', 'galon'] },
  { pattern: /\b(?:humidifier|diffuser\s+aroma|air\s+humidifier)\b/i, noun: 'Humidifier Mini Diffuser Ruangan', category: 'home_gadget', core: ['humidifier', 'diffuser'] },
  { pattern: /\b(?:lampu\s+sensor\s+gerak|motion\s+sensor\s+light)\b/i, noun: 'Lampu Sensor Gerak Otomatis', category: 'home_gadget', core: ['lampu', 'sensor'] },
  { pattern: /\b(?:dispenser\s+odol|tempat\s+pasta\s+gigi)\b/i, noun: 'Dispenser Odol Otomatis Tempel', category: 'home_gadget', core: ['dispenser', 'odol'] },
  { pattern: /\b(?:perangkap\s+nyamuk|mosquito\s+trap|lampu\s+nyamuk)\b/i, noun: 'Perangkap Nyamuk Elektrik UV', category: 'home_gadget', core: ['perangkap', 'nyamuk'] },
  { pattern: /\b(?:tempat\s+sampah\s+sensor|smart\s+trash\s+can)\b/i, noun: 'Tempat Sampah Sensor Otomatis', category: 'home_gadget', core: ['tempat', 'sampah'] },
  { pattern: /\b(?:timbangan\s+badan\s+digital|body\s+scale)\b/i, noun: 'Timbangan Badan Digital LED', category: 'home_gadget', core: ['timbangan', 'badan'] },
  { pattern: /\b(?:lampu\s+tidur\s+proyektor|star\s+projector)\b/i, noun: 'Lampu Tidur Proyektor Bintang', category: 'home_gadget', core: ['lampu', 'proyektor'] },
];

export function extractCoreProductInfo(rawTitle = '', rawDesc = '', rawUrl = '') {
  const cleaned = cleanTitle(rawTitle, rawUrl) || String(rawTitle || '').trim();
  const normalized = normalizeText(cleaned);

  for (const anchor of PRODUCT_ANCHORS) {
    if (anchor.pattern.test(normalized)) {
      return {
        cleanTitle: cleaned,
        coreProductNoun: anchor.noun,
        category: anchor.category,
        coreWords: anchor.core,
        searchQueries: [
          `${anchor.noun} review cara pakai`,
          `${anchor.noun} demo peragaan`,
          `${anchor.noun} review pemakaian`,
          `${anchor.noun} unboxing review`,
          `${anchor.noun} tes fungsi`,
          anchor.noun,
        ]
      };
    }
  }

  // Fallback: Smart token extraction from title
  const stopWords = [
    'dan', 'yang', 'untuk', 'dengan', 'dari', 'bisa', 'anti', 'super', 'termurah',
    'viral', 'original', 'promo', 'murah', 'ready', 'stock', 'import', 'impor',
    'terlaris', 'terbaru', 'terpercaya', 'kualitas', 'garansi', 'resmi', 'official',
    'bisa', 'cod', 'gratis', 'ongkir', 'diskon', 'terlengkap', 'store', 'shop', 'indonesia'
  ];
  const words = normalized.split(/\s+/).filter(w => w.length >= 3 && !stopWords.includes(w));
  const fallbackNoun = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || cleaned.slice(0, 30) || 'Produk Praktis';
  const fallbackWords = words.slice(0, 2);

  return {
    cleanTitle: cleaned,
    coreProductNoun: fallbackNoun,
    category: 'general_gadget',
    coreWords: fallbackWords.length > 0 ? fallbackWords : ['produk'],
    searchQueries: [
      `${fallbackNoun} review cara pakai`,
      `${fallbackNoun} demo peragaan`,
      `${fallbackNoun} review pemakaian`,
      `${fallbackNoun} unboxing`,
      fallbackNoun,
    ]
  };
}

export function isTitleMatchingProduct(candidateTitle, productWords = []) {
  let normTitle = normalizeText(candidateTitle || '');
  
  // Cross-category exclusion for household / gadget products
  const crossCategoryExclusions = [
    'las', 'pagar', 'bengkel', 'servis hp', 'servis motor', 'knalpot', 'mobil', 'motor', 'sepeda',
    'gameplay', 'game', 'manga', 'anime', 'vlog', 'skincare', 'makeup', 'gamis', 'hijab', 'outfit'
  ];

  if (crossCategoryExclusions.some(badWord => normTitle.includes(badWord))) {
    return false;
  }

  if (!Array.isArray(productWords) || productWords.length === 0) return true;

  const significant = productWords.filter(w => w.length >= 3);
  if (significant.length === 0) return true;

  // Normalize common Indonesian/English affiliate product synonyms
  const synonymMap = {
    'elektrik': 'listrik',
    'electric': 'listrik',
    'peeler': 'pengupas',
    'slicer': 'pemotong',
    'mop': 'pel',
    'blender': 'chopper',
    'penggiling': 'chopper',
  };

  for (const [syn, base] of Object.entries(synonymMap)) {
    if (normTitle.includes(syn)) {
      normTitle += ` ${base}`;
    }
  }

  const matched = significant.filter(w => normTitle.includes(w.toLowerCase()));
  const minRequired = Math.min(2, significant.length);
  return matched.length >= minRequired;
}

function titleFromShopeeUrl(productUrl = '') {
  try {
    const parsed = new URL(productUrl);
    const decodedPath = decodeURIComponent(parsed.pathname);
    const slug = decodedPath.split('/').filter(Boolean).pop() || '';
    const titleSlug = slug.replace(/-i\.\d+\.\d+.*$/i, '').replace(/\.\d+\.\d+.*$/i, '');
    const formatted = titleSlug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    return formatted;
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

/**
 * Searches and returns the best exact Shopee product URL matching the video's detected product.
 * Uses DoH-powered DuckDuckGo and household product keywords.
 */
export async function findMatchingShopeeProductUrl(productTitle, detectedBrand = '') {
  if (!productTitle || typeof productTitle !== 'string') return '';
  const cleanTitleStr = cleanTitle(productTitle) || productTitle.trim();
  const brand = (detectedBrand && detectedBrand !== 'none' && !detectedBrand.includes('Terdeteksi')) ? detectedBrand.trim() : '';
  const searchPhrase = `${brand ? `${brand} ` : ''}${cleanTitleStr}`.trim();

  console.log(`[Discovery] Mencari link Shopee yang cocok untuk produk video: "${searchPhrase}"...`);
  try {
    const results = await searchDuckDuckGoShopee(searchPhrase);
    if (results && results.length > 0) {
      const match = results.find(r => isShopeeProductUrl(r.url));
      if (match) {
        console.log(`[Discovery] ✅ Menemukan link Shopee cocok: "${match.title}" -> ${match.url}`);
        return match.url;
      }
    }
  } catch (err) {
    console.warn(`[Discovery] Gagal mencari link Shopee via DuckDuckGo:`, err.message);
  }

  // Fallback: direct search page URL with refined household keyword
  const fallbackUrl = `https://shopee.co.id/search?keyword=${encodeURIComponent(`${searchPhrase} produk rumah tangga`)}`;
  console.log(`[Discovery] Menggunakan fallback link Shopee: ${fallbackUrl}`);
  return fallbackUrl;
}

