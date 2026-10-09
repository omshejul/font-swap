# Chrome Web Store listing

Prepared release: SwapFont v0.6.3. Category Art & Design. Language English. Submission is handled separately; this document does not confirm it.

- Homepage: https://omshejul.com/app/swapfont
- Privacy: https://omshejul.com/app/swapfont/privacy
- Terms: https://omshejul.com/app/swapfont/terms
- Support: https://omshejul.com/app/swapfont/support
- Contact: swapfont@omshejul.com

## Assets

The five 1280x800 RGB PNG screenshots show the actual packaged extension on `website/demo.html`, captured with `node scripts/store-screenshots.mjs` in a disposable Chrome profile. The capture command closes its browser and local server on completion. `assets/capture.json` records the browser and capture date.

The promotional tiles are vector typography compositions. Their source SVGs are included. They use the actual extension icon, installed Georgia and Inter fonts. Export with Inkscape using `--export-png-color-mode=RGB_8`. The small tile is 440x280 and the marquee is 1400x560.

## Reviewer instructions

No account, payment, credentials, client API key or license key is required. Use Chrome desktop 116 or later with an internet connection for new Google Fonts downloads and catalog updates. The existing catalog stays usable offline.

1. Open https://omshejul.com/swapfont/demo.html and click the SwapFont toolbar icon.
2. Hover the article heading. The picker shows Georgia with a highlight and hand pointer. Click it.
3. Search Inter and click its result. The heading changes immediately and the pair collapses. No Apply button is needed.
4. Open the first swap's Apply to tags funnel. Search tags, choose Clear, then select `h1`. Only heading text using the original family keeps the replacement. All tags restores full coverage; return to only `h1` for the next step.
5. Choose Pick another font. Click the left Georgia "Aa" in the artwork, outside the first swap's `h1` filter, then search Lora and select it. Two rows now share Georgia as their source, with separate tag scopes and replacements.
6. Open either pair's accordion and change its replacement. Its tag choices remain, and the other row stays applied. Remove one pair and confirm the other stays. Opening and closing a row does not remove its swap. You can also add the body paragraph as another source.
7. Try Pick from page for a replacement, select text on the page, and check that it applies immediately. Escape cancels picking and restores the normal cursor.
8. Use the mode control to switch between floating and side panels. Active swaps and tag choices remain. The floating panel can be dragged by its header or moved using its focused grip and arrow keys.
9. Enable Remember for this site and approve Chrome's site permission. Reload or open another page on the same origin: saved main-page pairs and their tag choices return without opening SwapFont. Edits update them. Uncheck to forget them while retaining the current preview until reload. Undo all clears saved pairs too. Without remembering, reload restores original fonts. Embedded-frame and single-element swaps remain temporary.
10. On a fresh install, opening either panel starts a silent catalog refresh from `https://omshejul.com/api/swapfont/catalog` while the bundled list remains available. Search and pick immediately; there is no catalog spinner or permission prompt. After a successful refresh, reopening or switching panels makes no further catalog request for seven days. If offline or the request fails, the current list remains usable and a later opening can retry after a one-hour cooldown. Worker network inspection shows a fixed request without a client API key, cookies or referrer. Hovering, typing, navigation and restoring remembered fonts do not trigger catalog refreshes, and nothing is scheduled while the extension is unused.

Protected Chrome pages and the Chrome Web Store cannot run the picker. Text drawn into images, canvas or PDFs and inaccessible frames is unsupported.

## Privacy disclosures

SwapFont processes website text/styles, picker mouse positions/clicks, and current tab/frame URLs/navigation locally. It has no account or behavioral analytics. When opened, it uses its saved or bundled font catalog immediately and refreshes public catalog metadata from `https://omshejul.com/api/swapfont/catalog` if seven days have passed since the last successful refresh, or none exists. Failed or interrupted attempts have a one-hour cooldown; there are no scheduled requests while unused. Catalog metadata and refresh/attempt timestamps are stored locally. The fixed request omits cookies, authentication credentials and referrer, and sends no visited website URL, page text, font search, chosen font, saved setting or installation identifier. Vercel processes the connecting IP and ordinary HTTP metadata and may derive approximate location or retain operational/security records. Authorized project administrators can access hosting logs for troubleshooting and security. Google Fonts downloads reveal the requested family/style and normal connection information to Google. See the [public privacy policy](https://omshejul.com/app/swapfont/privacy) for handling, local storage and retention.

Keep Website content, User activity, Web history and Location declared conservatively. Website content, picker activity and visited URLs are handled locally. Location covers the connecting IP processed by Google Fonts and Vercel, including Vercel's possible approximate location derivation. No browsing-history archive or precise location tracking is implemented. Do not claim zero collection just because the catalog has no application-level user-data payload.

Remote code remains **No**. All executable JavaScript is bundled with the extension. The endpoint supplies validated JSON font metadata; Google Fonts supplies stylesheet/font data. There is no remote script execution or evaluation. No additional permissions are needed for the catalog request. The existing storage permission also covers the local catalog and refresh/attempt timestamps.

Storage permission justification: Stores the panel preference, cached fonts, validated catalog metadata and refresh timestamps locally, plus optional remembered-site font pairs and tag choices. There is no cloud sync.

Keep the existing Limited Use certifications. Data is used for font identification, catalog updates, previews and service operation/security, without sale, advertising, profiling or credit/lending use. Feedback email is optional, opens an editable diagnostic draft and sends nothing automatically.

## Previous publication and promo status

Version 0.5.5 is the previously published public release. The store previously held a 0.5.6 draft, and its promo review was cancelled. Version 0.6.3 is prepared for the next submission; a later release report should record the actual submission result.

Promo video: https://www.youtube.com/watch?v=GQ9ZjuzLIzw. The unlisted video is titled "SwapFont | Preview fonts on live web pages" and was uploaded on October 9, 2026. YouTube copyright and Community Guidelines checks found no issues. The cancelled review is not pending and does not confirm publication of the promo update.
