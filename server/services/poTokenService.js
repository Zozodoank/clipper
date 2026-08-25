import { generate } from 'youtube-po-token-generator';

let cachedPoTokenData = null;
let lastGeneratedTime = 0;
const CACHE_TTL_MS = 3600 * 1000; // 1 hour cache

/**
 * Generates Proof of Origin (PO-Token) and Visitor Data for YouTube.
 * This permanently bypasses the datacenter bot check on GitHub Codespaces / Azure / Linux VPS.
 */
export async function getYouTubePoTokenArgs() {
  const now = Date.now();
  if (cachedPoTokenData && (now - lastGeneratedTime < CACHE_TTL_MS)) {
    return cachedPoTokenData;
  }

  try {
    console.log('[PoTokenService] Generating fresh YouTube PO-Token & VisitorData for Datacenter bypass...');
    const result = await generate();
    if (result && result.poToken && result.visitorData) {
      cachedPoTokenData = [
        '--extractor-args',
        `youtube:player_client=web;po_token=web+${result.poToken};visitor_data=${result.visitorData}`
      ];
      lastGeneratedTime = now;
      console.log('[PoTokenService] Successfully generated YouTube PO-Token.');
      return cachedPoTokenData;
    }
  } catch (err) {
    console.warn('[PoTokenService] Could not generate PO-Token automatically:', err.message);
  }

  // Fallback to android client if generator is unavailable
  return [
    '--extractor-args',
    'youtube:player_client=android'
  ];
}
