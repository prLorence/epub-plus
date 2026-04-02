# Renderer Abstraction Plan (Strategy Pattern)

Updated: 2026-04-02 — Incorporating Zotero reader research

## Goal

Abstract all EPUB.js dependencies behind interfaces so the rendering engine can be swapped. Two engines planned:

1. **`epubjs`** (current) — uses EPUB.js's full rendering pipeline. Simple, working, but has quirks (resize page jumps, JS-based pagination, iframe-per-section).
2. **`native`** (new, Zotero-inspired) — uses EPUB.js only for parsing/unpacking, renders sections as direct DOM nodes in a single iframe with CSS multi-column pagination. Preserves book CSS with scoped selectors, uses `rem`-based font scaling.

## Architecture

```
src/
  engine/
    types.ts              # Shared interfaces (IBookEngine, IRendition, etc.)
    epubjs-engine.ts      # epub.js full-pipeline implementation (current behavior)
    native-engine.ts      # Custom renderer: epub.js parse + direct DOM + CSS columns
    engine-factory.ts     # Factory: settings → engine instance
```

All consumer code (`epub-view.ts`, `highlight-manager.ts`, `vim-bindings.ts`, etc.) uses only the interfaces from `engine/types.ts`, never importing from `epubjs` directly.

## Interfaces

### `IBookEngine` — replaces direct `ePub()` + `Book` usage

```ts
interface IBookEngine {
  open(data: ArrayBuffer): Promise<void>;
  renderTo(el: HTMLElement, options: RenderOptions): IRendition;
  getToc(): Promise<TocItem[]>;
  getMetadata(): Promise<BookMetadata>;
  getRange(cfiRange: string): Promise<Range | null>;
  destroy(): void;
}

interface RenderOptions {
  width: number;
  height: number;
  spread: "none" | "auto";
  flow: "paginated" | "scrolled";
}

interface TocItem {
  id: string;
  href: string;
  label: string;
  children: TocItem[];
}

interface BookMetadata {
  title: string;
  author: string;
  language?: string;
}
```

### `IRendition` — replaces `Rendition`

```ts
interface IRendition {
  display(target?: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  resize(width: number, height: number): void;
  destroy(): void;

  // Themes & styling
  setBodyStyles(styles: Record<string, string>): void;
  injectStylesheet(css: string, key: string): void;

  // Annotations
  addHighlight(cfiRange: string, data: unknown, color: string, opacity: number, onClick?: (e: MouseEvent) => void): void;
  removeHighlight(cfiRange: string): void;
  clearHighlights(): void;

  // State
  getCurrentLocation(): ReaderLocation | null;
  getContents(): ContentAccessor[];

  // Locations
  generateLocations(chars: number): Promise<void>;
  areLocationsReady(): boolean;
  percentageFromCfi(cfi: string): number | null;
  cfiFromPercentage(pct: number): string | null;

  // Events
  on(event: "relocated", cb: (location: ReaderLocation) => void): void;
  on(event: "selected", cb: (cfiRange: string, selection: SelectionInfo) => void): void;
  on(event: "rendered", cb: () => void): void;
  on(event: "keydown", cb: (e: KeyboardEvent) => void): void;
  on(event: "click", cb: () => void): void;
  off(event: string, cb: unknown): void;
}

interface ReaderLocation {
  cfi: string;
  href: string;
  percentage: number;        // 0-1 from locations API
  displayed?: { page: number; total: number };
}

interface SelectionInfo {
  text: string;
  window: Window;
  document: Document;
  clearSelection(): void;
}

interface ContentAccessor {
  document: Document;
  window: Window;
}
```

### `ITextResolver` — for embed text extraction

```ts
interface ITextResolver {
  resolve(data: ArrayBuffer, cfiRange: string): Promise<string | null>;
}
```

## Implementation Steps

### Step 1: Create interfaces (`engine/types.ts`) ✅
### Step 2: Create epub.js adapter (`engine/epubjs-engine.ts`) ✅
### Step 3: Create factory (`engine/engine-factory.ts`) ✅
### Step 4: Update consumers ✅
- `epub-renderer.ts` — fully migrated to `IBookEngine` + `IRendition`
- `highlight-manager.ts` — uses `IRendition.addHighlight/removeHighlight`
- `epub-view.ts` — uses `ReaderLocation`, `SelectionInfo`, `TocItem`
- `toc-panel.ts` — uses `TocItem` instead of `NavItem`
- `vim-bindings.ts` — uses `IRendition` via renderer
- `hover-sync.ts` — removed direct `EpubRenderer` dependency
- **No file imports from `epubjs` except `engine/epubjs-engine.ts`**
### Step 5: Add settings toggle ✅
- Added `engineType: "epubjs" | "native"` to settings interface + defaults
- Added dropdown in Reader settings section
- Requires reopening the book to take effect

### Step 6: Implement native engine (`engine/native-engine.ts`) ✅
- Uses EPUB.js only for parsing (Book, Section, EpubCFI, archive)
- Renders sections as direct DOM nodes in a single iframe
- CSS multi-column layout for pagination (`column-width`, `column-fill`)
- Scoped CSS: rewrites book selectors with `.__scope_N` prefix
- Translates `-epub-*` CSS properties to standard equivalents
- Handles section XHTML parsing, style extraction, and DOM insertion
- CFI generation via `section.cfiFromRange()`/`section.cfiFromElement()`
- Highlight support via `<mark>` wrapper elements
- Event forwarding (keyboard, click, selection) from iframe to parent

## Native Engine Design (Zotero-Inspired)

### Key techniques from Zotero:
1. **Single iframe, direct DOM** — all sections rendered as DOM nodes, not separate iframes
2. **CSS multi-column pagination** — `column-width: 800px; column-fill: auto; column-gap: 60px`
3. **CSSRewriter** — scope book CSS selectors, convert absolute sizes to `rem`, translate `-epub-*` properties
4. **Virtual section mounting** — only mount current section in paginated mode
5. **Shadow DOM annotations** — SVG highlights in Shadow DOM, isolated from book CSS
6. **Smart dark mode** — force text to `inherit`, backgrounds to `transparent`

### Pagination via CSS columns:
```css
.sections-container {
  column-fill: auto;
  column-width: var(--page-width);
  column-gap: 60px;
  height: 100%;
  overflow: hidden;
}
```
Page turns = scroll `scrollLeft` by `spreadWidth` increments.

### Font scaling via rem:
Convert all absolute font sizes in book CSS to `rem`:
- `12px` → `0.923rem` (based on 13pt base)
- User's font size setting changes `html { font-size: Xpx }` on the iframe
- All relative sizes scale uniformly

## Files That Need Changes

| File                   | Current EPUB.js Dependency        | After Abstraction                      |
| ---------------------- | --------------------------------- | -------------------------------------- |
| `epub-renderer.ts`     | Heavy (all APIs)                  | Uses `IBookEngine` + `IRendition`      |
| `highlight-manager.ts` | `Rendition` type, annotations API | Uses `IRendition`                      |
| `epub-view.ts`         | `Location`, `Contents` types      | Uses `ReaderLocation`, `SelectionInfo` |
| `toc-panel.ts`         | `NavItem` type                    | Uses `TocItem`                         |
| `vim-bindings.ts`      | `Rendition` via renderer          | Uses `IRendition`                      |
| `epub-text-cache.ts`   | `ePub()`, `book.getRange()`       | Uses `ITextResolver`                   |
| `epub-link-parser.ts`  | None (string utils only)          | No change                              |
| `link-copy.ts`         | None                              | No change                              |
| `backlink-scanner.ts`  | None                              | No change                              |
| `settings.ts`          | None                              | Add `engineType` setting               |
