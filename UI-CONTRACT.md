# Side panel contract

Plain HTML/CSS/JavaScript. No inline scripts, remote JavaScript, or framework. UI files are extension/sidepanel.html, .css and .js.

Send {type:'PANEL',action,tabId,...payload} through chrome.runtime.sendMessage. Response is {ok:true,state?,catalog?} or {ok:false,error}. Commands return confirmed state. Never show success before confirmation.

- connect, state: return current state. Get tab with chrome.tabs.query({active:true,currentWindow:true}).
- catalog: bundled array of {family,category,variants}. Search locally. Choose a result to swap, typing alone does nothing.
- pick {mode:'source'|'destination'}: source picker in accessible frames; destination picker in origin document only. Hover shows visible font name. cancel exits.
- preview {destination:{kind:'google'|'page',family},scope:'all'}: loads and immediately applies. No Apply step.
- select {ruleId,frameId}: select existing pair for editing.
- remove {ruleId,frameId}: remove one pair and preserve the others.
- undo: restore all pairs in all accessible frames.

State includes {tabId,frameId,url,source,destination,selection,count,pageFonts,active,applied,picking,status,error,warnings,rules:[{id,frameId,source,destination:{kind,family},count}]}. Source is the original CSS family. Destination is null for a new source. Existing pairs persist when picking another source. Choosing a destination for the same source replaces that pair. Rules aggregate accessible frames.

Listen for STATE_CHANGED {tabId,state}. Reconnect on tabs.onActivated and tabs.onUpdated complete. Ignore stale responses and updates for other tabs. Show state.error and command failures; preserve current swaps on failure. Loading blocks duplicate choices. Use textContent for dynamic text.

The initial view asks the user to click text on the page and explains hover font detection. After picking, show a compact source → Choose font row. Its open editor contains Search Google Fonts, an eyedropper Pick from page action, and the results separated by a divider. These belong to the row, with no numbered cards or repeated source box. Choosing a result applies immediately and collapses the row. Only one row opens at a time. Opening, closing and switching rows preserves all applied swaps. A separate × removes a pair. One unfinished row can be closed, reopened or discarded without affecting existing swaps. Pick another font and Undo all remain available. No Apply, Compare, scope radios, category filters, snippets, or metadata. Short picker hint with Cancel. Warnings may use a small disclosure. Keep 320px layout, light/dark themes, focus styles and keyboard search navigation. Arrow keys browse; Enter or click commits. Focus returns to the changed row after choosing. No all-caps subtitles or em dashes.

The source, apply, compare, element scope and sample actions remain internal compatibility APIs. They are not part of this simplified UI.
