# EPUB++ Optimization Plan

Last audited: 2026-03-29

## High Impact — DONE

### 1. Backlink Watcher — Excessive Rescans ✅
**File:** `src/backlinks/backlink-scanner.ts`
**What was done:**
- Added dirty-flag approach: `resolved` events only trigger rescan if a relevant `changed` event fired first
- Increased debounce from 300ms to 500ms
- Eliminated redundant full-vault scans from unrelated metadata resolves

### 2. Text Cache — Redundant EPUB Opens ✅
**File:** `src/embeds/epub-text-cache.ts`
**What was done:**
- Added LRU book instance pool (max 3) — avoids re-decompressing the same EPUB for adjacent CFI resolutions
- Added `batchResolve()` API for resolving multiple CFIs from the same book in one call
- Added `destroyPool()` cleanup on plugin unload
- Switched file I/O to `vault.adapter` for reliable dotfile writes

### 3. Backlink Panel — Full DOM Rebuild Per Chapter ✅
**File:** `src/backlinks/backlink-panel.ts`
**What was done:**
- Split into `renderStructure()` (once) + `rebuildList()` (on data change) + `updateVisibility()` (on chapter change)
- Chapter filter now toggles `display: none` instead of rebuilding DOM
- `highlightEntry()` uses `Map<key, HTMLElement>` for O(1) lookup instead of querySelectorAll
- Early exit in `setCurrentChapter()` if href unchanged
- Chapter headers auto-hidden when all their entries are filtered out

---

## Medium Impact — DONE

### 4. Highlight Manager — Unoptimized Hover Toggle ✅
**File:** `src/backlinks/highlight-manager.ts`
**What was done:**
- `toggleHoverClass()` now looks up the annotation's mark element directly via epub.js `_annotations` internals (O(1))
- Removed `forEachDocument()` helper and `Array.from()` — no more full DOM scans on hover
- Added fallback path via view `highlights` map if annotation lookup fails

### 5. TOC Panel — Inefficient Active State Updates ✅
**File:** `src/reader/toc-panel.ts`
**What was done:**
- Built `Map<href, HTMLElement>` during render for O(1) lookup
- `setActiveHref()` early-exits if href unchanged
- `updateActiveState()` only toggles old active + new active element (not all items)
- Removed `querySelectorAll` + `Array.from` iteration

### 6. Renderer — Redundant Metadata Fetches & Style Injection ✅
**File:** `src/reader/epub-renderer.ts`
**What was done:**
- Added `cachedMetadata` — `getBookTitle()` and `getBookAuthor()` share a single cached metadata fetch
- Added `lastStyleHash` — `updateSettings()` skips style re-injection if font size, line height, font family, opacity, and theme haven't changed
- `computeStyleHash()` produces a simple key from style-relevant settings

---

## Low Impact — DONE

### 7. Progress Store — Full State Serialization ✅
**File:** `src/progress/progress-store.ts`
**What was done:**
- Added `pruneDeleted(existingPaths)` method that removes entries for files no longer in vault
- Called on plugin load after vault file list is available
- Logs count of pruned entries for diagnostics

### 8. Color Palette — Inline Style Manipulation ✅
**File:** `src/reader/color-palette.ts`
**What was done:**
- Replaced all `setAttribute("style", ...)` + string `.replace()` with direct `style.*` property assignments
- Hover handlers now toggle only `borderColor` or `background` instead of rewriting the entire style string

### 9. Link Copy — Regex in Loop ✅
**File:** `src/links/link-copy.ts`
**What was done:**
- Pre-compiled all 9 template variable regexes into a module-level `Map<string, RegExp>`
- `applyTemplate()` now looks up pre-compiled regex from the map instead of creating new `RegExp` per call
- Added `lastIndex` reset for safety with global regexes

---

## Round 2 — 2026-03-30

### 10. Page Load — Redundant Display Call ✅
**File:** `src/reader/epub-view.ts`
**What was done:**
- Removed the duplicate `renderer.display()` call from the 500ms `setTimeout` post-load fixup
- Replaced `setTimeout(500)` with `requestAnimationFrame` for the resize fixup — fires as soon as the browser completes layout instead of waiting a fixed 500ms

### 11. Narrow Observer — Redundant DOM Mutations ✅
**File:** `src/reader/epub-view.ts`
**What was done:**
- ResizeObserver now tracks previous breakpoint state (`prevNarrow`, `prevVeryNarrow`)
- `classList.toggle()` only called when the breakpoint actually changes
- Eliminates unnecessary DOM mutations during continuous resize (pane dragging)

### 12. Renderer Resize — Skip Identical Dimensions ✅
**File:** `src/reader/epub-renderer.ts`
**What was done:**
- Cache `lastResizeWidth` and `lastResizeHeight`
- Skip `rendition.resize()` call when dimensions haven't changed
- Avoid EPUB.js re-layout when container size is unchanged

### 13. Renderer — Conditional Style Application ✅
**File:** `src/reader/epub-renderer.ts`
**What was done:**
- `updateSettings()` now only calls `applyTheme()` and `applyFontSettings()` when the style hash has actually changed
- Previously these were called unconditionally on every settings update

### 14. TOC Panel — O(1) Filename Fallback Lookup ✅
**File:** `src/reader/toc-panel.ts`
**What was done:**
- Built secondary `filenameMap` during render for O(1) filename-based fallback
- Replaced O(n) iteration with chained map lookups: `hrefMap.get() ?? filenameMap.get()`
- Eliminates linear scan on every page turn for books with mismatched path prefixes

### 15. Color Palette — Event Listener Leak Fix ✅
**File:** `src/reader/color-palette.ts`
**What was done:**
- Centralized popup dismissal into a `cleanup()` function with a `dismissed` guard
- All dismiss paths (swatch click, add-to-note click, selection clear, outside click) now go through `cleanup()`
- Ensures `selectionchange` and `mousedown` listeners are always removed from the iframe document

### 16. No-op handleRendered Call Removed ✅
**File:** `src/reader/epub-view.ts`
**What was done:**
- Removed call to `highlightManager.reattachHoverListeners()` which was an empty no-op
- EPUB.js annotations API handles re-injection automatically on page turns

### 17. Unload Error Handling ✅
**File:** `src/main.ts`
**What was done:**
- Added `.catch()` error logging to fire-and-forget `progressStore.save()` and `textCache.save()` in `onunload()`
- Errors during unload are now logged instead of silently swallowed

### 18. Very-Narrow Panel Shadows — Reduced Blur ✅
**File:** `styles.css`
**What was done:**
- Reduced `box-shadow` blur radius from 12px to 6px and opacity from 0.15 to 0.1 on overlay panels
- Less expensive paint operations during panel transitions on narrow panes

### 19. handleRelocated — Cached DOM Refs & Deduplicated Calls ✅
**File:** `src/reader/epub-view.ts`
**What was done:**
- Cached `progressFillEl` and `pageInfoEl` during `buildDom()` instead of `querySelector` on every page turn
- Deduplicated `getCurrentChapterTitle()` — was called twice per relocate (toolbar + backlink panel), now called once and result shared

### 20. Vim Bindings — History Suppression ✅
**File:** `src/reader/vim-bindings.ts`
**What was done:**
- Vim j/k/h/l page turns now go through the view's `nextPage()`/`prevPage()` callbacks instead of calling `renderer.next()`/`prev()` directly
- Ensures vim page turns suppress history push (same as arrow keys and toolbar buttons)
- Prevents false back-button appearances when crossing chapters with vim keys

### 21. Backlink Panel — Palette & Visibility ✅
**File:** `src/backlinks/backlink-panel.ts`
**What was done:**
- Replaced hardcoded color map with palette passed from plugin settings via constructor
- Replaced all `style.display` assignments with `toggleClass("epub-plus-hidden")` — satisfies obsidianmd/no-static-styles-assignment lint rule and uses CSS classes for better theming
- Chapter header visibility check now uses `classList.contains` instead of `style.display` comparison
