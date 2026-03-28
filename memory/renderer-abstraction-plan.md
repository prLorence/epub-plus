# Renderer Abstraction Plan (Strategy Pattern)

## Goal

Abstract all EPUB.js dependencies behind interfaces so the rendering engine can be swapped between epub.js and Readium (or any future engine) via a settings toggle.

## Architecture

```
src/
  engine/
    types.ts              # Shared interfaces (IBookEngine, IRendition, etc.)
    epubjs-engine.ts      # epub.js implementation
    readium-engine.ts     # Readium implementation (future)
    engine-factory.ts     # Factory: settings → engine instance
```

All consumer code (`epub-view.ts`, `highlight-manager.ts`, `vim-bindings.ts`, etc.) uses only the interfaces from `engine/types.ts`, never importing from `epubjs` or `@readium/*` directly.

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
  addHighlight(cfiRange: string, data: unknown, color: string, opacity: number,
    onClick?: (e: MouseEvent) => void): void;
  removeHighlight(cfiRange: string): void;
  clearHighlights(): void;

  // State
  getCurrentLocation(): ReaderLocation | null;
  getSpineEnd(): string | null;  // href of last spine item

  // Events
  on(event: "relocated", cb: (location: ReaderLocation) => void): void;
  on(event: "selected", cb: (cfiRange: string, selection: SelectionInfo) => void): void;
  on(event: "rendered", cb: () => void): void;
  on(event: "keydown", cb: (e: KeyboardEvent) => void): void;
  off(event: string, cb: unknown): void;
}

interface ReaderLocation {
  cfi: string;
  href: string;
  percentage: number;
  page: number;
  totalPages: number;
}

interface SelectionInfo {
  text: string;
  window: Window;
  document: Document;
  clearSelection(): void;
}
```

### `ITextResolver` — replaces one-shot `ePub()` + `book.getRange()`

```ts
interface ITextResolver {
  resolve(data: ArrayBuffer, cfiRange: string): Promise<string | null>;
}
```

## Migration Steps

### Step 1: Create interfaces (`engine/types.ts`)
Define all interfaces above. No implementation changes yet.

### Step 2: Create epub.js adapter (`engine/epubjs-engine.ts`)
Wrap existing epub.js code to implement `IBookEngine` and `IRendition`.
Move EPUB.js imports here — this becomes the ONLY file that imports from `epubjs`.

### Step 3: Create factory (`engine/engine-factory.ts`)
```ts
function createEngine(type: "epubjs" | "readium"): IBookEngine {
  if (type === "readium") return new ReadiumEngine();
  return new EpubJsEngine();
}
```

### Step 4: Update consumers
- `epub-renderer.ts` → uses `IBookEngine` + `IRendition` instead of `Book` + `Rendition`
- `highlight-manager.ts` → uses `IRendition.addHighlight/removeHighlight` instead of `rendition.annotations.*`
- `epub-view.ts` → uses `SelectionInfo` instead of `Contents`
- `vim-bindings.ts` → uses `IRendition` instead of `Rendition`
- `toc-panel.ts` → uses `TocItem` instead of `NavItem`
- `epub-text-cache.ts` → uses `ITextResolver` instead of `ePub()` + `book.getRange()`

### Step 5: Add settings toggle
```ts
engineType: "epubjs" | "readium";  // default: "epubjs"
```

### Step 6: Implement Readium adapter (`engine/readium-engine.ts`)
Wrap `@readium/navigator` + `@readium/shared` to implement the same interfaces.

## Files That Need Changes

| File | Current EPUB.js Dependency | After Abstraction |
|------|---------------------------|-------------------|
| `epub-renderer.ts` | Heavy (all APIs) | Uses `IBookEngine` + `IRendition` |
| `highlight-manager.ts` | `Rendition` type, annotations API | Uses `IRendition` |
| `epub-view.ts` | `Location`, `Contents` types | Uses `ReaderLocation`, `SelectionInfo` |
| `toc-panel.ts` | `NavItem` type | Uses `TocItem` |
| `vim-bindings.ts` | `Rendition` via renderer | Uses `IRendition` |
| `epub-text-cache.ts` | `ePub()`, `book.getRange()` | Uses `ITextResolver` |
| `epub-link-parser.ts` | None (string utils only) | No change |
| `link-copy.ts` | None | No change |
| `backlink-scanner.ts` | None | No change |
| `settings.ts` | None | Add `engineType` setting |

## Key Design Decisions

1. **CFI as the universal position format** — both epub.js and Readium understand EPUB CFIs. Our link syntax (`#cfi=...`) stays the same regardless of engine.

2. **Factory pattern, not dependency injection** — simpler for a plugin. The factory is called once at plugin load.

3. **Adapters own all engine-specific imports** — `epubjs-engine.ts` is the ONLY file that imports from `epubjs`. `readium-engine.ts` is the ONLY file that imports from `@readium/*`.

4. **Events normalized** — both engines emit the same event shapes (`ReaderLocation`, `SelectionInfo`). The adapter handles translation.

5. **Highlights abstracted** — `addHighlight(cfi, data, color, opacity)` replaces the complex `rendition.annotations.highlight(cfi, data, cb, class, styles)` API.
