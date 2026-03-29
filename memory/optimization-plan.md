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
