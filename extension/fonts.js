const inFlight = new Map();
let catalog;
export async function getCatalog() {
  catalog ||= fetch(chrome.runtime.getURL('catalog.json')).then(r => r.json()).then(d => d.families);
  return catalog;
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
  const item = (await getCatalog()).find(f => f.family === family);
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
