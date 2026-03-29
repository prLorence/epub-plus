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

## Medium Impact — TODO

### 4. Highlight Manager — Unoptimized Hover Toggle
**File:** `src/backlinks/highlight-manager.ts`
- `toggleHoverClass()` queries all `.epubjs-hl` elements and iterates all of them to toggle one
- `Array.from()` conversion on every hover event
- `forEachDocument()` re-queries DOM every hover event
- **Fix:** Maintain `Map<cfi, HTMLElement>` cache; target specific element instead of querying all

### 5. TOC Panel — Inefficient Active State Updates
**File:** `src/reader/toc-panel.ts`
- `updateActiveState()` queries all TOC items on every page turn to toggle active class
- No caching of element references; no early exit if href unchanged
- **Fix:** Cache `Map<href, HTMLElement>`; track last active href and skip if unchanged; only toggle old + new elements

### 6. Renderer — Redundant Metadata Fetches & Style Injection
**File:** `src/reader/epub-renderer.ts`
- `getBookTitle()` and `getBookAuthor()` each await `book.loaded.metadata` separately
- `updateSettings()` re-injects styles into all contents without checking if already applied
- Location generation guard exists but could be tighter
- **Fix:** Cache metadata result; track applied style version to avoid re-injection

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
