// Saved pairs contain font names only, never picked text or DOM references.
export function siteOrigin(url) {
  try { const parsed=new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.origin : ''; } catch { return ''; }
}
export function sitePattern(origin) {
  const url=new URL(origin);
  // Chrome host permissions cover every port; saved settings still match exact origins.
  return `${url.protocol}//${url.hostname}/*`;
}
export const siteKey = origin => `site:${origin}`;
export function savedPairs(rules) {
  return rules.filter(rule=>rule.frameId===0 && rule.scope!=='element').map(({source,destination})=>({source,destination:{kind:destination.kind,family:destination.family}}));
}
