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

## Low Impact — TODO

### 7. Progress Store — Full State Serialization
**File:** `src/progress/progress-store.ts`
- Writes entire state file on every save even if only one book's progress changed
- No pruning of entries for deleted books; unbounded growth
- **Fix:** Add GC for books no longer in vault; consider per-book files or differential writes

### 8. Color Palette — Inline Style Manipulation
**File:** `src/reader/color-palette.ts`
- Uses `setAttribute("style", ...)` with string `.replace()` on hover instead of CSS class toggles
- Multiple attribute mutations per interaction
- **Fix:** Use `classList.toggle()` with CSS classes for hover states

### 9. Link Copy — Regex in Loop
**File:** `src/links/link-copy.ts`
- `applyTemplate()` creates new `RegExp` for each template variable in a loop
- **Fix:** Compile regex patterns once during plugin load or template creation
