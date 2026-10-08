# Verification

Verified 2026-10-08T04:04:26.783Z on macOS arm64, Node 24, Chrome for Testing 152.0.7977.75.

Manifest and syntax checks passed. Five unit tests passed. All 37 end-to-end browser checks passed. Font downloads were real, and Chrome's CSS protocol confirmed Lora glyphs in the rendered heading.

The fixture browser used loopback-only permissions in a temporary manifest copy to exercise permitted frames. The native-panel browser used the exact production manifest and a real toolbar action. Test browsers, fixture servers and temporary profiles were closed.

- source hover shows hand cursor, subtle highlight and font name; picking restores website styles
- both pickers show on-page instructions; Escape restores cursors and cancels frames, including shadow text
- picker detects primary CSS family and selected text
- real Google Font downloads and renders actual Lora glyphs over inline important
- fallback-only matches, similar names and private-use icons stay unchanged
- open and closed shadow DOM text swaps
- dynamic page text joins current font mapping
- continuous DOM updates do not starve matching
- two different origin fonts stay applied together and hover shows replacement name
- removing one swap preserves the other
- page picking a replaced Google font survives removal of its original swap
- editing a swap replaces its destination without duplicating the pair
- instant application needs no Apply and internal comparison remains reversible
- Undo preserves website styling changes including shadow inline changes
- fallback detection is labelled CSS identity rather than confirmed rendered font
- absent source produces zero matches and no misleading success
- selected element scope only changes selected element
- destination can be picked from existing page text
- page-picked CSS generic font keeps generic semantics
- destination failure retains previous preview
- offline uncached font fails safely and cached font still previews
- strict website CSP with font-src none supports worker-loaded FontFace
- destination picker stays in origin document
- moving origin to another frame preserves previous swaps
- Undo all restores simultaneous swaps across permitted frames
- restricted browser page reports unsupported action
- production manifest toolbar gesture opens native panel and grants activeTab
- saved pair opens and closes inline without removing the pair or changing the applied font
- native panel searches, applies instantly, edits by keyboard and undoes on public iana.org
- adding a font opens a blinking dashed source placeholder that wraps at 240px with picking controls inside its accordion; Cancel preserves swaps
- pending row opens, closes and discards without affecting an applied swap
- native panel adds simultaneous pairs while production permissions protect cross-origin frames
- switching accordion rows keeps both swaps applied and expands one editor at a time
- expanded two-pair accordion fits 320px and renders light and dark themes
- native panel removes one pair independently and Undo all restores the rest
- native panel page-picked destination applies immediately and collapses to pair
- native panel reconnects after navigation and Escape cancels picker

## Manual Dia checks

Checked the installed unpacked v0.2.0 extension through Dia's native UI on 8 October 2026, using https://ai-nativeservices.com/blog/integral-ai-native-accounting.

- Reloaded the installed extension, then refreshed the article.
- Toolbar opened the minimal two-pick panel with the supplied icon.
- Hover showed Gelasio for the heading and Figtree for body text.
- Picked Gelasio, searched Lora, and pressed Enter. Heading and site brand changed immediately, with no Apply control.
- Added Figtree to Roboto Mono. Both pairs stayed active, with visible serif heading and monospace body.
- Removed only Figtree to Roboto Mono. Body restored while the Lora heading remained.
- Edited the remaining pair, picked Figtree from the article as destination, and saw heading and site brand change immediately.
- Undo all restored original fonts. Escape cancelled the picker. Reload cleared the session and reconnected to the two-pick starting state.

The user's existing extensions stayed installed and enabled. The manual test used the user's Dia profile; automated tests used isolated profiles.

## Manual Dia checks for v0.2.1

Reloaded the installed extension to v0.2.1 and tested https://www.iana.org/domains/reserved through Dia's native UI on 8 October 2026.

- Picked Noto, searched Lora, and clicked the result. The page changed immediately.
- Opened and closed the saved row. Its editor expanded inside the row, and the Lora rendering and saved pair remained.
- Reopened the row, searched Inter, and pressed Enter. The same pair changed to Inter.
- Added IBM Plex Mono to Roboto Mono. Switching accordion rows kept both swaps active and showed one editor at a time.
- Used the eyedropper page picker to change the second destination to Inter from the heading.
- Removed only the second pair, leaving Noto to Inter. Undo all restored the test page. Closed the test tab and restored the user's original Poppins source selection on their AICamp page.
- Visually confirmed the search icon, Search Google Fonts field, down arrow between picks, and eyedropper to the left of Pick from page.

## In-app browser limitation

The Codex in-app browser's control policy rejected chrome://extensions because only HTTP and HTTPS navigation is allowed. Extension installation and native side-panel end-to-end testing there could not be completed. No workaround was attempted. Dia and Chrome test success does not establish in-app compatibility.

## Panel at 320px

![Light panel](panel-light.png)

![Dark panel](panel-dark.png)

These results cover the listed cases on the tested browsers. They do not establish exact glyph detection or universal browser compatibility. See README boundaries.

## Search and accordion in v0.2.1

The second pick uses a search icon, Search Google Fonts label and placeholder, a filled background, and native search input. Clicking the row focuses the field. The actual native Chrome panel was visually checked at 320px in light and dark themes. All 34 browser checks and five unit tests passed again. Saved pairs expand the two-pick editor inside their row, with one row open at a time. Opening, closing and switching rows preserves the applied fonts. A down arrow connects the two picks. The × button removes a pair independently. Pick from page has a decorative eyedropper icon to its left. The v0.2.1 changes also passed the manual Dia checks recorded above.

![Search field in dark theme](search-dark.png)

![Search field in light theme](search-light.png)

## Compact picker in v0.2.2

The panel follows the supplied three-state reference. A pending source row opens one replacement picker containing search, Pick from page and results. Applied swaps become compact rows with muted source names, bold destinations, chevrons and separate remove buttons. Numbered cards and the repeated source box are gone. Row and Notes chevrons are SVG icons. Notes retains native mouse and keyboard disclosure behavior. The updated drawing.svg supplies all icon sizes, and the extension is named SwapFont.

Manifest and syntax checks, five unit tests and all 37 browser checks passed. The new pending-row check confirms closing, reopening and discarding a choice preserves an existing swap. Visually checked the native Chrome panel at 320px in light and dark themes.

![Compact picker in dark theme](compact-search-dark.png)

![Compact picker in light theme](compact-search-light.png)

![Expanded compact accordion](compact-panel-dark.png)

## Picking feedback in v0.2.2

Starting another source pick opens a pending accordion with a blinking dashed Pick from page label, eyedropper icon, instructions and Cancel inside it. Loading and errors appear in the active row. A temporary on-page eyedropper badge says Pick a font or Pick replacement font. Both pickers use a hand cursor, thin blue outline, translucent fill and font-name tooltip on text. Picking or Escape restores the site's cursor, outline and background. Escape also cancels other permitted frames.

Browser checks cover custom important cursors, restoration on picking and Escape, shadow text, frame cancellation, badge removal, and cancelling a pending accordion without opening or changing an existing swap. Visually checked picking feedback on light and dark blue page backgrounds.

![Waiting accordion](waiting-dark.png)

![On-page picking feedback](page-picking.png)

![Narrow waiting accordion with stacked labels](waiting-240-dark.png)
