(function (root) {
  function parseStack(value) {
    const result = []; let part = '', quote = '', escaped = false;
    for (const char of value) {
      if (escaped) { part += char; escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ''; else part += char; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === ',') { if (part.trim()) result.push(part.trim()); part = ''; }
      else part += char;
    }
    if (part.trim()) result.push(part.trim());
    return result;
  }
  const normalize = value => value.trim().toLowerCase();
  const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, ' ') + '"';
  const generics = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
  function matches(stack, family) {
    // Match primary CSS identity, never incidental fallback or substring names.
    return normalize(parseStack(stack)[0] || '') === normalize(family);
  }
  function fallback(stack, source) {
    return parseStack(stack).filter(f => normalize(f) !== normalize(source)).map(f => generics.has(normalize(f)) ? f : quote(f)).join(', ');
  }
  function protectedFont(family, text) {
    return /font\s*awesome|material\s*(icons|symbols)|(^|[-_ ])icon(s|font)?($|[-_ ])/i.test(family) || /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u.test(text);
  }
  // Inspired by WhatFont's canvas comparison. An estimate only, never identity.
  function estimate(element, stack) {
    try {
      const css = getComputedStyle(element), sample = (element.textContent || element.value || 'Aa').trim().slice(0, 64);
      const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 72;
      const context = canvas.getContext('2d', {willReadFrequently: true});
      function draw(font) {
        context.clearRect(0, 0, 1024, 72); context.font = `${css.fontStyle} ${css.fontWeight} 32px ${font}`;
        context.fillText(sample, 0, 44); return context.getImageData(0, 0, 1024, 72).data;
      }
      const baseline = draw(stack);
      const equal = (a, b) => a.every((v, i) => v === b[i]);
      for (const family of parseStack(stack)) {
        const serif = draw(`${quote(family)}, serif`), sans = draw(`${quote(family)}, sans-serif`);
        if (equal(serif, sans) && equal(baseline, serif)) return family;
      }
    } catch { /* Restricted canvas or unusual font syntax: use CSS identity. */ }
    return null;
  }
  const familyCSS = value => generics.has(normalize(value)) ? normalize(value) : quote(value);
  function normalizeTags(tags) {
    if (tags == null) return null; // Existing and unrestricted swaps.
    if (!Array.isArray(tags) || tags.length > 100 || tags.some(tag => typeof tag !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/i.test(tag))) throw new Error('Choose valid HTML tags.');
    return [...new Set(tags.map(tag => tag.toLowerCase()))].sort();
  }
  const textTags = new Set('h1 h2 h3 h4 h5 h6 p a button label li dt dd td th caption figcaption blockquote pre summary input textarea select option legend'.split(' '));
  function* ancestors(element) {
    // Inline formatting follows its text tag, but containers cannot select past it.
    for (let node = element; node; node = node.parentElement || node.getRootNode().host) {
      yield node;
      if (textTags.has(node.localName)) break;
    }
  }
  function matchesTags(element, tags) {
    return tags == null || [...ancestors(element)].some(node => tags.includes(node.localName));
  }
  root.FSFontUtils = {parseStack, normalize, quote, familyCSS, matches, fallback, protectedFont, estimate, normalizeTags, ancestors, matchesTags};
})(globalThis);
