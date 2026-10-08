# Chrome Web Store draft

SwapFont v0.4.1. Category Art & Design. Language English.

- Homepage: https://omshejul.com/app/swapfont
- Privacy: https://omshejul.com/app/swapfont/privacy
- Terms: https://omshejul.com/app/swapfont/terms
- Support: https://omshejul.com/app/swapfont/support
- Contact: swapfont@omshejul.com

## Assets

The five 1280x800 RGB PNG screenshots show the actual packaged extension on `website/demo.html`, captured with `node scripts/store-screenshots.mjs` in a disposable Chrome profile. The capture command closes its browser and local server on completion. `assets/capture.json` records the browser and capture date.

The promotional tiles are vector typography compositions. Their source SVGs are included. They use the actual extension icon, installed Georgia and Inter fonts. Export with Inkscape using `--export-png-color-mode=RGB_8`. The small tile is 440x280 and the marquee is 1400x560.

## Reviewer instructions

No account, payment, credentials or license key is required. Use Chrome desktop 116 or later with an internet connection for Google Fonts downloads.

1. Open https://omshejul.com/swapfont/demo.html and click the SwapFont toolbar icon.
2. Hover the article heading. The picker shows Georgia with a highlight and hand pointer. Click it.
3. Search Inter and click its result. The heading changes immediately and the pair collapses. No Apply button is needed.
4. Choose Pick another font. Click the body paragraph, then search Lora and select it. Both swaps remain applied.
5. Open the first pair's accordion and change its replacement. Opening and closing a row does not remove the swap.
6. Try Pick from page for a replacement, select text on the page, and check that it applies immediately. Escape cancels picking and restores the normal cursor.
7. Use the mode control to switch between floating and side panels. Active swaps remain. The floating panel can be dragged by its header or moved using its focused grip and arrow keys.
8. Remove one pair, use Undo all, or reload. Original fonts return.

Protected Chrome pages and the Chrome Web Store cannot run the picker. Text drawn into images, canvas or PDFs and inaccessible frames is unsupported.

## Privacy disclosures

Processing happens locally for website text/styles, picker mouse positions/clicks, and current tab/frame URLs/navigation. The extension has no analytics, account or developer backend. Google Fonts requests expose the connecting IP address and normal connection information to Google, and request the chosen family/style. The public privacy policy describes all handling, local storage and retention.

The store draft conservatively declares Website content, User activity, Web history and Location because of that local URL handling and the IP address used by Google Fonts. No browsing-history archive or precise location tracking is implemented. No remote executable code is used.

Optional YouTube video and Search Console verified official URL are left blank because neither exists. The extension remains a draft until the publisher submits it for review.
