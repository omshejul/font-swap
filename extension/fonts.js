const inFlight = new Map();
const CATALOG_URL = 'https://omshejul.com/api/swapfont/catalog';
const WEEK = 7 * 24 * 60 * 60 * 1000, COOLDOWN = 60 * 60 * 1000;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const CATALOG_KEYS = ['googleFontCatalog','googleFontCatalogFetchedAt','googleFontCatalogLastAttemptAt'];
const categories = new Set(['sans-serif','serif','display','handwriting','monospace']);
let catalog, bundled, refreshing;
function getBundledCatalog() {
  bundled ||= fetch(chrome.runtime.getURL('catalog.json')).then(r => r.json()).then(d => d.families);
  return bundled;
}
function validCatalog(data, minimum) {
  if (!data || data.source !== 'https://www.googleapis.com/webfonts/v1/webfonts' || typeof data.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) return false;
  const date = new Date(data.updated);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== data.updated) return false;
  if (!Array.isArray(data.families) || data.families.length < Math.ceil(minimum * 0.9) || data.families.length > 10000) return false;
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_CATALOG_BYTES) return false;
  const names = new Set();
  return data.families.every(font => {
    if (!font || typeof font.family !== 'string' || !font.family.trim() || font.family !== font.family.trim() || font.family.length > 200 || /[\u0000-\u001f\u007f]/.test(font.family) || names.has(font.family)) return false;
    names.add(font.family);
    return categories.has(font.category) && Number.isSafeInteger(font.popularity) && font.popularity >= 0 && Array.isArray(font.variants) && font.variants.length > 0 && font.variants.length <= 100 && font.variants.every(variant => typeof variant === 'string' && (/^(regular|italic)$/.test(variant) || /^(?:[1-9]\d{0,2}|1000)(?:italic)?$/.test(variant)));
  });
}
function recent(timestamp, now, interval) {
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= now && now - timestamp < interval;
}
export async function getCatalog() {
  catalog ||= (async () => {
    const [fallback, stored] = await Promise.all([getBundledCatalog(), chrome.storage.local.get(CATALOG_KEYS).catch(() => ({}))]);
    return validCatalog(stored.googleFontCatalog, fallback.length) ? stored.googleFontCatalog.families : fallback;
  })();
  return catalog;
}
async function readCatalog(response) {
  if (Number(response.headers.get('content-length')) > MAX_CATALOG_BYTES) throw new Error('Catalog too large.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CATALOG_BYTES) { await reader.cancel(); throw new Error('Catalog too large.'); }
      text += decoder.decode(value, {stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
export function refreshCatalog() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const [fallback, stored] = await Promise.all([getBundledCatalog(), chrome.storage.local.get(CATALOG_KEYS)]);
    const valid = validCatalog(stored.googleFontCatalog, fallback.length), now = Date.now();
    if (valid && recent(stored.googleFontCatalogFetchedAt, now, WEEK)) return null;
    if (recent(stored.googleFontCatalogLastAttemptAt, now, COOLDOWN)) return null;
    await chrome.storage.local.set({googleFontCatalogLastAttemptAt:now});
    const response = await fetch(CATALOG_URL, {credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(20000)});
    if (!response.ok) return null;
    const data = await readCatalog(response);
    if (!validCatalog(data, Math.max(fallback.length, valid ? stored.googleFontCatalog.families.length : 0))) return null;
    await chrome.storage.local.set({googleFontCatalog:data, googleFontCatalogFetchedAt:Date.now()});
    catalog = Promise.resolve(data.families);
    return data.families;
  })().catch(() => null).finally(() => { refreshing = null; });
  return refreshing;
}
function base64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function cachedFetch(url) {
  const cache = await caches.open('font-swap-fonts-v1');
  const saved = await cache.match(url);
  if (saved) return saved;
  const response = await fetch(url, {signal: AbortSignal.timeout(20000), credentials:'omit'});
  if (!response.ok) throw new Error('Could not download this font. Check your connection and try again.');
  await cache.put(url, response.clone());
  // Bounded persistent cache. A cached face can still be used while offline.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - 160))) await cache.delete(key);
  return response;
}
export async function loadGoogleFont(family, styles = [{weight:'400',style:'normal'}], sample = false) {
  const item = (await getCatalog()).find(f => f.family === family) || (await getBundledCatalog()).find(f => f.family === family);
  if (!item) throw new Error('Choose a font from the Google Fonts list.');
  const available = item.variants.map(v => ({italic:v.includes('italic') ? 1 : 0, weight:parseInt(v) || 400}));
  const warnings = [];
  const pairs = styles.map(s => {
    const italic = s.style === 'italic' || s.style === 'oblique' ? 1 : 0;
    const candidates = available.filter(v => v.italic === italic);
    const pool = candidates.length ? candidates : available.filter(v => !v.italic);
    const requested = Number(s.weight) || 400;
    const chosen = [...pool].sort((a,b) => Math.abs(a.weight-requested)-Math.abs(b.weight-requested))[0];
    if (!chosen) throw new Error('This font has no usable style.');
    if (chosen.weight !== requested || chosen.italic !== italic) warnings.push(`${family} does not offer every requested weight or style. The browser will use the closest available face.`);
    return `${chosen.italic},${chosen.weight}`;
  });
  const tuples = [...new Set(pairs)].sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replaceAll('%20','+')}:ital,wght@${tuples.join(';')}&display=swap${sample ? '&text='+encodeURIComponent('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?') : ''}`;
  if (inFlight.has(url)) return inFlight.get(url);
  const pending = (async () => {
    const css = await (await cachedFetch(url)).text();
    const faces = []; const binaries = {}; let total = 0;
    for (const block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
      const read = property => block[1].match(new RegExp(`${property}:\\s*([^;]+)`))?.[1].trim();
      const fontURL = block[1].match(/src:\s*url\(([^)]+)\)/)?.[1].replace(/["']/g,'');
      if (!fontURL || new URL(fontURL).origin !== 'https://fonts.gstatic.com') continue;
      if (!binaries[fontURL]) {
        const buffer = await (await cachedFetch(fontURL)).arrayBuffer(); total += buffer.byteLength;
        if (total > 32 * 1024 * 1024) throw new Error('This font is too large to preview safely. Try a different family.');
        binaries[fontURL] = base64(buffer);
      }
      faces.push({id:fontURL, descriptors:{weight:read('font-weight') || '400',style:read('font-style') || 'normal',unicodeRange:read('unicode-range') || 'U+0-10FFFF'}});
    }
    if (!faces.length) throw new Error('Google Fonts returned no usable font faces.');
    return {family, faces, binaries, warnings:[...new Set(warnings)]};
  })();
  inFlight.set(url,pending);
  try { return await pending; } finally { inFlight.delete(url); }
}
