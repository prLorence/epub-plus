# Zotero Reader Engine — Implementation Plan

## Goal

Embed the actual Zotero reader as a third engine option (`engineType: "zotero"`), giving users the same polished reading experience as the obsidian-zotero-reader-plugin.

## Reference Implementation

Plugin: https://github.com/duanxianpi/obsidian-zotero-reader-plugin
Reader: https://github.com/zotero/reader (submodule at duanxianpi/obsidian-zotero-reader)

## How the Reference Plugin Works

1. **Build-time**: Zotero reader is built for Obsidian target (`reader/reader/build/obsidian/`). All assets (HTML, JS, CSS, fonts, WASM) are gzip+base64 encoded and bundled into the plugin JS.

2. **Runtime**: Assets are decompressed and served as blob URLs. The reader loads in a sandboxed iframe (`allow-scripts allow-same-origin allow-forms`) pointing to the blob URL of `reader.html`.

3. **Communication**: Uses `penpal` library for parent↔child iframe RPC. Parent exposes `ParentAPI`, child exposes `ChildAPI`.

4. **EPUB loading**: Parent reads EPUB from vault as ArrayBuffer, converts to blob URL, passes to child which loads it in the Zotero reader.

## Implementation Steps

### Step 1: Build the Zotero Reader

- Fork/clone https://github.com/duanxianpi/obsidian-zotero-reader (their Zotero reader fork)
- Build for Obsidian target
- Extract build artifacts from `build/obsidian/`

### Step 2: Bundle Assets

- Create `src/engine/zotero-assets/` directory
- Gzip + base64 encode the build artifacts (same approach as reference plugin)
- Create `inline-assets.ts` that exports the encoded assets
- At runtime: decode → blob URL

### Step 3: Install Dependencies

- `npm install penpal` — for parent↔child iframe communication

### Step 4: Create Zotero Engine (`src/engine/zotero-engine.ts`)

```typescript
export class ZoteroEngine implements IBookEngine {
  // Manages the Zotero reader iframe lifecycle
  // Decompresses and serves reader assets as blob URLs
  // Implements IBookEngine by proxying to the child API
}

class ZoteroRendition implements IRendition {
  // Proxies all methods through penpal to the Zotero reader child
  // Maps Zotero events to our ReaderLocation/SelectionInfo types
  // Handles annotation bridging
}
```

### Step 5: Bridge API

Map our `IRendition` interface to Zotero's child API:

| Our method | Zotero child API |
|---|---|
| `display(cfi)` | `navigateToCFI(cfi)` |
| `next()` | `navigateToNextPage()` |
| `prev()` | `navigateToPreviousPage()` |
| `setTheme(theme)` | `setColorScheme()` + `setAppearance()` |
| `addHighlight(cfi, ...)` | `createAnnotation(...)` |
| `getCurrentLocation()` | Subscribe to `onChangeViewState` |
| Events | Map Zotero events to our event types |

### Step 6: Annotation Bridging

Zotero uses its own annotation format. We need to convert between:
- Our backlink-based annotations (`[[book.epub#cfi=...&color=yellow]]`)
- Zotero's annotation objects (`{ type: "highlight", color: "#ffd400", position: { ... } }`)

## Trade-offs

- **License**: Zotero reader is AGPL-3.0. If we bundle it, our plugin must also be AGPL (or we keep it as an optional download).
- **Bundle size**: ~6-10MB added to the plugin.
- **Alternative**: Instead of bundling, we could have users install the Zotero reader separately and reference it. This avoids the license issue but adds setup friction.

## Open Questions

1. Can we use the Zotero reader build from the reference plugin directly, or do we need to build from source?
2. Should we make the Zotero engine a separate optional plugin to avoid license contamination?
3. How do we handle Zotero reader updates?
