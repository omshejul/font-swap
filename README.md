# SwapFont

Private Chrome extension. Click text, choose a Google Font or another font on the page, and swap it instantly.

One extension includes a native side panel and a draggable floating panel. Use the header icon to **Float on page** or **Dock to side panel**. Switching cancels picking, preserves active font swaps and remembers your preferred mode. New installs start in the side panel.

The floating panel starts in the top-right and preserves the website's width. Closing cancels picking and keeps current swaps; the toolbar reopens it. Drag the header, or focus its grip and use arrow keys to move it. Notes and the repeated CSS-family explanation are removed from both modes.

Each applied swap has an optional **Apply to tags** funnel. Open it to search and select HTML tags such as `h1`, `h2` and `p`. Changes apply immediately to matching text inside those tags, including nested text. **All tags** restores normal coverage. Each swap keeps its own choices, including when changing the replacement font or remembering the site.

The header's feedback icon opens an editable email draft to chromewebstore@omshejul.com with the extension version, browser, layout, site origin, active swaps and any error. It includes no page text or URL paths. Nothing is sent until you send the email.

## Install locally

1. Open `chrome://extensions` in desktop Chrome.
2. Turn on Developer mode.
3. Click **Load unpacked** and select this repository's `extension` folder.
4. Open a website and click the SwapFont toolbar icon. Pin the icon for easier access.
5. Click text whose font you want to change. The blinking dashed Pick from page row and on-page badge show picking is active. Hovering text shows its font name, hand cursor and a subtle highlight. Picking or Escape restores the website cursor.
6. Search Google Fonts beneath the picked font and choose one, or use **Pick from page**. The font changes immediately and the row closes.
7. Use **Pick another font** to add more pairs. Click a pair to expand its editor in place. Click it again to collapse. Use × to remove one pair, or **Undo all**.

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

Font size, requested weight, style and fallback stack remain in place. Different metrics can change wrapping and layout. A destination may lack a requested weight or language's glyphs; Chrome can synthesize a style or use a fallback. Missing weights are recorded internally. Google Fonts does not guarantee script coverage.

Several font pairs can be active in the current page session. Pairs match the original CSS family, so swaps do not cascade into each other. Enable **Remember for this site** to save main-page font pairs locally and restore them on future visits, reloads and browser restarts. Chrome asks for access to that site. Settings match the exact origin (scheme, hostname and port), across all its paths. Edits update the saved pairs; removing the last pair or Undo all deletes them. Turning remembering off deletes the saved pairs while keeping the current preview until reload. Embedded-frame and single-element swaps stay temporary. Page-picked fonts must be available on the page; Google Fonts can load from the cache or network. Without remembering, reload clears the pairs. A picked element replaced by a website must be picked again. Shadow roots attached later to an existing host may also need a fresh pick. Cross-origin frames require their own permission and are left unchanged when inaccessible. Picking a destination is limited to the origin's document.

## Privacy and permissions

No account, API key, backend, analytics or remote code. The extension requests access when its toolbar icon is clicked. Required permanent host access is limited to Google's font hosts. Optional website access is requested only when remembering that site; disabling remembering deletes its saved configuration. Chrome's extension settings can revoke the site permission. Saved configurations contain the exact site origin and source/replacement font names, never picked text or DOM references, and do not sync to other devices. Font requests reveal the selected family and normal connection information to Google. Page text is used locally for the picker and canvas estimate; it is not sent to a font API. Font search reads the bundled catalog locally.

Font bytes are cached in extension storage, bounded to 160 cache entries. The catalog is bundled from Google's metadata at build time; the metadata endpoint is undocumented and is not needed during normal use. Font files retain their upstream licenses.

The icon uses the supplied `drawing.svg`, kept in `assets/icon.svg` and rendered with Inkscape at 16, 32, 48 and 128px.

UI controls use inline SVGs. The feedback symbol is Google's [Material Symbols Outlined feedback icon](https://github.com/google/material-design-icons/blob/master/symbols/web/feedback/materialsymbolsoutlined/feedback_24px.svg), bundled with its Apache 2.0 license.

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
- `floating.js` mounts those same controls in a closed shadow root. Constructed stylesheets isolate their appearance without an iframe, and the picker excludes the entire panel. The same manifest and ZIP include both modes.

Shadow-root text uses inline overrides because testing in Chrome 152 found stale computed styles after removing USER stylesheets that matched shadow elements. Shadow elements are excluded from those stylesheets. This is an observed browser behavior, not a claim about every Chrome version.

Chrome API references: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [dom](https://developer.chrome.com/docs/extensions/reference/api/dom). Font loading uses the [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2).
