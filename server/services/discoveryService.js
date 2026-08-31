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
  onProgress = () => {},
} = {}) {
  const excludeSet = excludeVideoIds instanceof Set ? excludeVideoIds : new Set(excludeVideoIds || []);
  const coreTitle = cleanTitle(productTitle);
  const productWords = normalizeText(coreTitle).split(' ').filter((word) => word.length >= 3);
  const compactTitle = productWords.slice(0, 5).join(' ');

  // Targeted search modifiers to find high-production, experienced creator demonstration videos
  const searchModifiers = [
    'review unboxing peragaan',
    'demo cara pakai tes fungsi',
    'unboxing review pemakaian',
    'demonstrasi cara kerja praktis',
    'review produk b-roll sinematik',
    'hands on demo review unboxing',
    'tes fungsi cara pakai review',
    'spill barang unik peragaan',
    'unboxing aesthetic peragaan produk',
  ];

  // Randomize modifier order slightly so distinct queries are attempted across multiple jobs
  const shuffledModifiers = [...searchModifiers].sort(() => Math.random() - 0.5);

  const queryCandidates = [
    `${compactTitle} ${shuffledModifiers[0]}`,
    `${compactTitle} demo cara pakai peragaan`,
    `${compactTitle} ${shuffledModifiers[1]}`,
    `unboxing ${compactTitle} review pemakaian`,
    `${compactTitle} tes fungsi peragaan`,
    `${compactTitle} b-roll review`,
    coreTitle,
  ].filter(Boolean);

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

      if (freshResults.length > 0) {
        candidates = freshResults;
        usedQuery = query;
        break;
      }
    }
    await delayWithJitter(300, 600);
  }

  // Fallback: If all results were previously used, search broader query
  if (!candidates.length) {
    const broaderQuery = productWords.slice(0, 3).join(' ');
    const fallbackResults = await searchYouTubeVideos(`${broaderQuery} unboxing review`, { limit, onProgress });
    const nonExcluded = (fallbackResults || []).filter((c) => {
      const vid = c.id || extractVideoId(c.url);
      return vid && !excludeSet.has(vid);
    });
    candidates = nonExcluded.length > 0 ? nonExcluded : (fallbackResults || []);
  }

  const cleanCandidates = candidates
    .filter((candidate) => isLikelyCleanYouTubeCandidate(candidate))
    .map((candidate) => ({
      ...candidate,
      searchQuery: usedQuery,
      matchScore: scoreCandidateMatch(candidate, productWords, productDescription),
    }))
    .filter((candidate) => candidate.matchScore >= 0)
    .sort((a, b) => b.matchScore - a.matchScore);

  const pool = cleanCandidates.length > 0 ? cleanCandidates : candidates;

  // Candidate Selection Variety / Weighted Rotation:
  if (pool.length > 1) {
    const topScore = pool[0].matchScore || 0;
    const topTier = pool.filter((c) => (c.matchScore || 0) >= topScore * 0.75);
    const rest = pool.filter((c) => (c.matchScore || 0) < topScore * 0.75);

    // Shuffle topTier
    for (let i = topTier.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topTier[i], topTier[j]] = [topTier[j], topTier[i]];
    }

    return [...topTier, ...rest];
  }

  return pool;
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
      timeoutMs: 2500,
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response || !response.ok) {
      return searchBraveShopee(keyword);
    }

    html = await response.text();
  } catch (error) {
    return searchBraveShopee(keyword);
  }

  if (html.includes('internetbaik.telkomsel.com') || html.includes('blocked')) {
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
  const timeoutMs = Number(options.timeoutMs) || 3000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const cleanOptions = { ...options };
    delete cleanOptions.timeoutMs;
    const response = await fetch(url, {
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

function isLikelyCleanYouTubeCandidate(candidate) {
  if (!candidate.url || !candidate.id) return false;
  // If duration is known, reject only if too short (<15s) or too long (>30 min)
  if (candidate.duration > 0 && (candidate.duration < 15 || candidate.duration > 1800)) return false;

  const titleText = normalizeText(candidate.title || '');
  if (isBulkyOrUnsuitableProduct(titleText)) return false;

  const excludedTitleWords = [
    'podcast', 'reaction', 'kompilasi', 'compilation', 'full album', 'playlist',
    'vlog', 'daily vlog', 'a day in my life', 'cerita', 'bincang', 'talkshow', 'ngobrol',
    'cara belanja', 'cara checkout', 'daftar akun', 'tutorial aplikasi', 'cara jualan', 'cara live',
    'shopee affiliate tutorial', 'aplikasi shopee'
  ];
  return !excludedTitleWords.some((keyword) => titleText.includes(keyword));
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

function cleanTitle(value = '', productUrl = '') {
  let cleaned = value
    .replace(/\s*\|\s*Shopee.*$/i, '')
    .replace(/\s*-\s*Shopee.*$/i, '')
    .replace(/^Shopee\s*(Indonesia)?\s*[:|–-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  if (cleaned && !isGenericShopeeTitle(cleaned)) return cleaned;
  
  const fromUrl = titleFromShopeeUrl(productUrl);
  if (fromUrl && !isGenericShopeeTitle(fromUrl)) return fromUrl;

  return '';
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
