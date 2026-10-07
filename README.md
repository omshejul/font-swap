# Font Swap

Private Chrome extension. Click text, choose a Google Font or another font on the page, and swap it instantly. A native side panel keeps the controls beside the website.

## Install locally

1. Open `chrome://extensions` in desktop Chrome.
2. Turn on Developer mode.
3. Click **Load unpacked** and select this repository's `extension` folder.
4. Open a website and click the Font Swap toolbar icon. Pin the icon for easier access.
5. **Pick 1**. Click text whose font you want to change. Hovering shows its font name.
6. **Pick 2**. Search Google Fonts and choose one, or use **Pick from page**. The font changes immediately.
7. Use **Another font** to add more pairs. Select a pair to change its destination, remove one pair, or **Undo all**.

The packaged ZIP contains the same extension files. Unzip it first, then load the extracted folder. Reload the extension from `chrome://extensions` after code updates.

## What works

| Case | Behavior |
| --- | --- |
| Normal HTML, forms and SPA text | Swaps visible text and updates for new or changed content. Password inputs are excluded. |
| Inline `font-family: ... !important` | Extension USER CSS overrides it. Undo removes only the extension's rules. |
| Open and closed shadow roots | Reversible inline overrides. Website changes made during preview survive Undo. |
| Strict website CSP, including `font-src 'none'` | Worker downloads font bytes; the page loads an in-memory FontFace. No remote JavaScript. |
| Embedded frames | Only accessible frames can be picked. Swaps affect the selected document. Several swaps can remain active across accessible frames. Undo all restores them together. |
| Destination picked from page | Reuses a family from the origin's document, including CSS generic families. |
| Offline | The bundled font list works. Previously cached font faces can load; uncached fonts show an error and keep the current preview. |

## Boundaries

Chrome desktop is the supported first target. The manifest requires Chrome 116 or later; automated testing uses Chrome for Testing 152. Dia has also been checked manually. The Codex in-app browser blocks the extension-management URL through its available controls, so extension installation and end-to-end behavior there are unverified. Safari, Firefox, Edge and mobile browsers have not been validated.

The source is the first computed CSS family. Canvas comparison, inspired by WhatFont's public core, adds an estimate when possible. It cannot prove the font used for every glyph. Matching uses that exact primary family, so a fallback mention or a similar family name does not replace unrelated text.

Images, canvas text, PDFs, SVG text, browser pages and protected Chrome Web Store pages are excluded. Known icon fonts and private-use characters are protected. Native browser controls, generated pseudo-element text, unusual font aliases and sites that continuously rewrite styles may need manual inspection. Scanning stops after 30,000 elements. A single font download is limited to 32 MB.

Font size, requested weight, style and fallback stack remain in place. Different metrics can change wrapping and layout. A destination may lack a requested weight or language's glyphs; Chrome can synthesize a style or use a fallback. Missing weights produce a warning. Google Fonts does not guarantee script coverage.

Several font pairs can be active in the current page session. Pairs match the original CSS family, so swaps do not cascade into each other. Reloading the page clears them; saved site rules are not part of this version. A picked element replaced by a website must be picked again. Shadow roots attached later to an existing host may also need a fresh pick. Cross-origin frames require their own permission and are left unchanged when inaccessible. Picking a destination is limited to the origin's document.

## Privacy and permissions

No account, API key, backend, analytics or remote code. The extension requests access when its toolbar icon is clicked. Permanent host access is limited to Google's font stylesheet and font-file hosts. Font requests reveal the selected family and normal connection information to Google. Page text is used locally for the picker and canvas estimate; it is not sent to a font API. Font search reads the bundled catalog locally.

Font bytes are cached in extension storage, bounded to 160 cache entries. The catalog is bundled from Google's metadata at build time; the metadata endpoint is undocumented and is not needed during normal use. Font files retain their upstream licenses.

The icon uses the supplied `icon-iOS-Default-1024x1024@2x.png`, resized to Chrome's 16, 32, 48 and 128px sizes.

## Develop and verify

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run package
```

Set `CHROME_PATH` to a Chrome for Testing executable to test that browser. On this Mac, the test detects the installed Chrome for Testing automatically. `HEADED=1 npm run test:e2e` shows the test browser. Every run closes its browser, temporary profile and fixture server in `finally`.

The fixture tests use a temporary extension copy with loopback permissions so permitted cross-origin frames can be exercised. A second browser uses the exact production manifest and triggers the real toolbar action through CDP. It tests native side-panel controls against `iana.org`, activeTab grants, inaccessible frames, 320px layout, light and dark themes, navigation and Escape. Google Font loading is real, and CDP verifies the actual rendered font for the fixture heading.

Results and screenshots are written to `test-results/`. The last verified run is documented in [docs/verification.md](docs/verification.md).

To refresh the bundled font catalog, run `npm run catalog`. Validate the changed snapshot before committing.

## Implementation

- `worker.js` handles access, frame routing, font downloads and USER CSS.
- `content.js` owns the picker, original styles, dynamic matching and reversible swaps.
- `font-utils.js` parses CSS families and estimates detection confidence.
- `fonts.js` loads Google font faces and caches downloads.
- `sidepanel.html`, `.css` and `.js` contain the UI. Claude simplified the panel against `UI-CONTRACT.md`.

Shadow-root text uses inline overrides because testing in Chrome 152 found stale computed styles after removing USER stylesheets that matched shadow elements. Shadow elements are excluded from those stylesheets. This is an observed browser behavior, not a claim about every Chrome version.

Chrome API references: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [dom](https://developer.chrome.com/docs/extensions/reference/api/dom). Font loading uses the [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2).
