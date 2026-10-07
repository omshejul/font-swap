# Local verification

Verified 2026-10-07T22:15:11.040Z on macOS arm64, Node 24, Chrome for Testing 152.0.7977.75.

Manifest and syntax checks passed. Five unit tests passed. All 25 end-to-end checks passed. Font downloads were real, and Chrome's CSS protocol confirmed Lora glyphs in the rendered heading.

The first browser used loopback-only permissions in a temporary manifest copy to test accessible frames. The native-panel browser used the exact production manifest and a real toolbar action, including activeTab access and inaccessible cross-origin frames. No user browser profile was modified. Test browsers, fixture servers and temporary profiles were closed.

- picker detects primary CSS family and selected text
- real Google Font downloads and renders actual Lora glyphs over inline important
- fallback-only matches, similar names and private-use icons stay unchanged
- open and closed shadow DOM text swaps
- dynamic page text joins current font mapping
- continuous DOM updates do not starve matching
- compare original and Apply preserve live preview
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
- moving origin to another frame restores previous frame
- permitted cross-origin frame selection and frame-local swap
- restricted browser page reports unsupported action
- production manifest toolbar gesture opens native panel and grants activeTab
- native panel search, preview, Apply, Compare and Undo on public iana.org
- native panel fits 320px and renders light and dark themes
- production activeTab grant leaves unpermitted cross-origin frame unchanged and warns
- native panel reconnects after navigation and Escape cancels picker

## Panel at 320px

![Light panel](panel-light.png)

![Dark panel](panel-dark.png)

This verifies the listed cases on the tested browser. It does not promise exact font detection for every glyph or support on every browser. See the README's boundaries.
