import fs from 'node:fs/promises';
const response = await fetch('https://fonts.google.com/metadata/fonts', {signal: AbortSignal.timeout(30000)});
if (!response.ok) throw new Error(`Catalog download failed (${response.status})`);
const raw = await response.text();
const metadata = JSON.parse(raw.slice(raw.indexOf('{')));
const catalog = metadata.familyMetadataList.filter(f => f.isOpenSource !== false).map(f => ({
  family: f.family, category: f.category.toLowerCase().replaceAll(' ', '-'),
  variants: Object.keys(f.fonts).map(v => v === '400' ? 'regular' : v === '400i' ? 'italic' : v.replace('i', 'italic')),
  popularity: f.popularity
})).sort((a, b) => a.popularity - b.popularity);
if (catalog.length < 1000 || !catalog.some(f => f.family === 'Inter')) throw new Error('Unexpected catalog format; retained existing catalog.');
await fs.writeFile(new URL('../extension/catalog.json', import.meta.url), JSON.stringify({source:'https://fonts.google.com/metadata/fonts', updated:new Date().toISOString().slice(0,10), families:catalog}));
console.log(`Bundled ${catalog.length} Google Fonts families.`);
