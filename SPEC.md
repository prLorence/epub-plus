# EPUB++ — Product Requirements Document

**The most Obsidian-native EPUB annotation & viewing tool ever.**

---

## 1. Vision

EPUB++ brings the same tight, bidirectional integration between EPUBs and markdown that PDF++ achieved for PDFs. The core philosophy: **annotations are backlinks, backlinks are annotations.** Your highlights exist as standard Obsidian links in markdown files — if the plugin dies, your notes survive. The EPUB viewer renders those backlinks as visible highlights, creating a seamless loop between reading and note-taking.

---

## 2. Problem Statement

The EPUB annotation ecosystem in Obsidian is fragmented and inadequate:

- **No deep linking standard exists.** Unlike PDFs (which have `#page=N&selection=...`), no open-source EPUB reader exposes position-level URIs. The W3C EPUB CFI spec defines the addressing scheme, but no reader implements it as an external link target.
- **Existing plugins are either buggy or shallow.** `obsidian-annotator` is Hypothesis-based and widely reported as unstable. `obsidian-epub-annotator` offers basic highlighting but lacks the bidirectional backlink integration that makes PDF++ powerful.
- **EPUB readers treat Obsidian as an export target, not a native environment.** Tools like Readest, Foliate, and Calibre require external sync pipelines. None offer the "select text → copy link → paste in note → click link → jump back" loop inside Obsidian.

EPUB++ solves this by making Obsidian itself the EPUB reader, with the same annotation-by-backlink paradigm that PDF++ pioneered.

---

## 3. Design Principles

### 3.1 Complement, Don't Replace
EPUB++ extends Obsidian's capabilities rather than replacing core functionality. It should feel like a natural part of Obsidian, not a separate app embedded in it.

### 3.2 Annotations as Backlinks
Highlights in the EPUB viewer are derived from markdown links in your vault. No proprietary annotation database. No JSON blobs. Just standard `[[wikilinks]]` with EPUB-specific subpaths.

### 3.3 Graceful Degradation
If EPUB++ is uninstalled, your markdown notes remain fully readable and navigable. The links still contain human-readable metadata (book title, chapter, quoted text). Only the visual highlight rendering and jump-to-position behavior is lost.

### 3.4 Every Feature Is Optional
Following PDF++'s approach, every feature should have a toggle in settings. Users can adopt incrementally.

---

## 4. Link Syntax

### 4.1 EPUB CFI-Based Deep Links

EPUB++ introduces an EPUB-specific subpath syntax for Obsidian links, analogous to PDF++'s `#page=N&selection=...`:

```
[[book.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&color=yellow]]
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `cfi` | Yes | EPUB Canonical Fragment Identifier for start position |
| `end` | No | End CFI for range selections (omit for point references) |
| `color` | No | Highlight color name (maps to configurable palette) |
| `chapter` | No | Human-readable chapter title (assertion, not navigation) |
| `text` | No | URL-encoded snippet of selected text (assertion for robustness) |

**Simplified syntax for chapter-level links:**

```
[[book.epub#chapter=3]]
[[book.epub#chapter=Introduction]]
```

### 4.2 Display Text Templates

Configurable templates for copied link text, using variables:

| Variable | Description |
|----------|-------------|
| `{{fileName}}` | EPUB filename without extension |
| `{{title}}` | Book title from EPUB metadata |
| `{{author}}` | Author from EPUB metadata |
| `{{chapter}}` | Current chapter title |
| `{{page}}` | Estimated page number (based on reading system pagination) |
| `{{selection}}` | Selected/highlighted text |
| `{{link}}` | The raw wikilink |
| `{{linkWithDisplay}}` | Wikilink with display text |
| `{{color}}` | Highlight color name |
| `{{callout}}` | Formatted as Obsidian callout block |

**Default template:**

```
> [!quote|{{color}}] {{chapter}}
> {{selection}}
> — [[{{fileName}}#cfi=...{{linkSuffix}}|{{title}}, {{chapter}}]]
```

---

## 5. Core Features

### 5.1 EPUB Viewer

**Rendering engine:** EPUB.js (same library used by Calibre-Web, Readest, and most web-based EPUB readers). Renders EPUB content as reflowable HTML within an Obsidian leaf view.

**Reader capabilities:**
- Paginated and scrolling modes
- Configurable font family, size, line height, margins
- Light/dark/sepia themes that respect Obsidian's current theme
- Table of contents sidebar
- Full-text search within book
- Reading progress persistence (stored in vault as `.epub-progress.json` or frontmatter)
- Keyboard navigation (arrow keys, vim bindings as optional)

**File handling:**
- Opens `.epub` files from the vault natively (registers as a view for `.epub` extension)
- Supports files referenced by path outside the vault (via settings, for large libraries)
- OPDS catalog browser for pulling books from Calibre-Web / Calibre content server

### 5.2 Backlink Highlighting

The signature feature. Any `[[book.epub#cfi=...]]` link in your vault becomes a visible highlight in the EPUB viewer.

**Behavior:**
- On opening an EPUB, scan vault for all backlinks targeting this file
- Render each backlinked text range as a colored highlight overlay
- Highlight colors determined by `&color=` parameter in the link
- Highlights update in real-time as you add/remove links in markdown files
- Multiple overlapping highlights from different notes render as layered colors

### 5.3 Bidirectional Navigation

**EPUB → Markdown (hover/click on highlight):**
- Hovering over a highlight shows a popover preview of the linking markdown note
- Ctrl/Cmd + click opens the source note
- If multiple notes link to the same selection, show a list

**Markdown → EPUB (click link):**
- Clicking a `[[book.epub#cfi=...]]` link opens the EPUB and scrolls to the exact CFI position
- If the EPUB is already open in another pane, scroll that pane instead of opening a new one
- Popover preview on hover (shows the highlighted text in reading context)

### 5.4 Color Palette & Copy Link

A toolbar in the EPUB viewer with a color palette (identical UX to PDF++):

1. Select text in the EPUB viewer
2. Click a color in the palette (or use hotkey)
3. A formatted link is copied to clipboard using the active template
4. Paste into any markdown note
5. The EPUB viewer immediately renders the new highlight

**Context menu integration:**
- Right-click selected text → "Copy link to selection" submenu with color options
- "Copy link to annotation" for existing highlights
- "Add highlight to [active note]" — appends directly without clipboard

### 5.5 Hover Sync

**EPUB viewer → Backlinks pane:**
Hovering over a highlight in the EPUB also highlights the corresponding entry in Obsidian's backlinks pane.

**Backlinks pane → EPUB viewer:**
Hovering over a backlink item in the sidebar highlights the corresponding text in the EPUB viewer and scrolls to it.

### 5.6 Filter Backlinks by Chapter

In the backlinks pane, show only backlinks pointing to the chapter currently visible in the EPUB viewer. Analogous to PDF++'s "filter backlinks by page."

### 5.7 EPUB Embeds

Embed EPUB selections directly in markdown notes:

```markdown
![[book.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42]]
```

Renders as a styled blockquote with the selected text, chapter attribution, and a clickable link back to the source location. Respects the EPUB's stylesheet for faithful rendering of formatted content (tables, code, etc.).

### 5.8 Annotation Sidebar

An optional sidebar panel (similar to Hypothesis) that lists all annotations/highlights for the current book, grouped by chapter. Each entry shows:
- Highlighted text snippet
- Your note/comment (editable inline)
- Color
- Link to the source markdown note
- Timestamp

### 5.9 Reading Progress & Bookmarks

- Automatically save reading position per book
- Bookmarks as special links: `[[book.epub#cfi=...&bookmark=true]]`
- Progress bar in the EPUB viewer showing % complete
- "Continue reading" command that opens your last-read book at the saved position

---

## 6. OPDS Integration

### 6.1 Catalog Browser

Built-in OPDS client for browsing Calibre-Web or any OPDS-compatible server:

- Add OPDS feed URLs in settings (with optional authentication)
- Browse catalog within Obsidian (search, filter by author/tag/series)
- Download EPUBs directly into a configurable vault folder
- Auto-create a metadata note for each downloaded book (using a configurable template with frontmatter: title, author, ISBN, cover image, OPDS source URL)

### 6.2 Library Sync

- Periodically check OPDS feed for new additions
- Optional auto-download of new books matching configured filters
- Track which books in your vault came from which OPDS source

---

## 7. Data Model

### 7.1 No Proprietary Storage

All annotation data lives in standard markdown files as backlinks. No `.json` sidecar files, no database, no hidden metadata.

### 7.2 Reading State

Reading progress is stored in one of two ways (configurable):

**Option A — Frontmatter (default):**
```yaml
---
epub-progress:
  file: "Books/Example.epub"
  cfi: "epubcfi(/6/14!/4/2/1:0)"
  percent: 42
  updated: 2025-03-27T10:30:00Z
---
```

**Option B — Central file:**
A single `.epub-reading-state.json` in the vault root, mapping book paths to reading positions.

### 7.3 Highlight Persistence

Highlights exist only as links in markdown. The "truth" is always in your notes. The EPUB file is never modified.

Optionally, EPUB++ can write highlights into the EPUB file's `META-INF/calibre_bookmarks.txt` (Calibre's format) for cross-reader visibility, but this is secondary and opt-in.

---

## 8. Technical Architecture

### 8.1 Stack

| Component | Technology |
|-----------|------------|
| EPUB parsing & rendering | EPUB.js (v0.3.x+) |
| CFI generation & resolution | EPUB.js built-in CFI support |
| Plugin framework | Obsidian Plugin API (TypeScript) |
| View registration | `ViewPlugin` for `.epub` file extension |
| Backlink scanning | Obsidian `MetadataCache` API |
| Settings | Standard Obsidian settings tab |
| OPDS client | Custom fetch-based client (OPDS 1.x and 2.0) |

### 8.2 View Architecture

```
┌─────────────────────────────────────────────┐
│ Obsidian Workspace                          │
│  ┌──────────────────┐ ┌──────────────────┐  │
│  │ EPUB View (Leaf) │ │ Markdown Editor  │  │
│  │                  │ │                  │  │
│  │  ┌────────────┐  │ │  Your notes with │  │
│  │  │ EPUB.js    │  │ │  [[book.epub#    │  │
│  │  │ Renderer   │  │ │  cfi=...]] links │  │
│  │  │            │  │ │                  │  │
│  │  │ + Highlight│  │ │                  │  │
│  │  │   Overlay  │  │ │                  │  │
│  │  └────────────┘  │ │                  │  │
│  │  ┌────────────┐  │ │                  │  │
│  │  │ Toolbar    │  │ │                  │  │
│  │  │ (palette)  │  │ │                  │  │
│  │  └────────────┘  │ │                  │  │
│  └──────────────────┘ └──────────────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │ Backlinks Pane (filtered by chapter) │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 8.3 Highlight Rendering Pipeline

```
1. EPUB file opened in viewer
2. Query MetadataCache for all links matching [[filename.epub#...]]
3. Parse CFI ranges from each link's subpath
4. For each CFI range:
   a. Resolve to DOM range via EPUB.js rendition.getRange(cfi)
   b. Create highlight overlay element with color from &color= param
   c. Attach click/hover handlers for bidirectional navigation
5. Watch MetadataCache for changes → update highlights in real-time
```

### 8.4 CFI Robustness

EPUB CFIs can break when book content changes between editions. To mitigate:

- Store `&text=` parameter with a snippet of the highlighted text
- On CFI resolution failure, fall back to text search within the chapter
- Warn user when a highlight can't be resolved
- Provide a "re-anchor highlights" command that recalculates CFIs based on stored text snippets

---

## 9. Settings

All settings should be toggleable. Organized into sections:

### General
- Default highlight color
- Reading mode (paginated / scroll)
- Auto-save reading progress
- Progress storage method (frontmatter / central file)

### Appearance
- EPUB reader font family, size, line height
- Theme (follow Obsidian / light / dark / sepia)
- Margin width
- Show/hide toolbar
- Show/hide TOC sidebar

### Backlink Highlighting
- Enable/disable backlink highlighting
- Highlight opacity
- Color palette configuration (name → hex color mapping)
- Filter backlinks by chapter in backlinks pane

### Copy & Template
- Link copy format templates (multiple named templates)
- Default template selection
- Auto-copy on highlight (vs. manual copy)
- "Add to current note" behavior (append / insert at cursor)

### Hover & Navigation
- Hover action (popover preview / open note / disabled)
- Modifier key for hover action (Ctrl/Cmd/none)
- Hover sync (EPUB→backlinks / backlinks→EPUB / both / disabled)
- Open behavior when EPUB already in another tab

### OPDS
- Feed URLs (list with auth credentials)
- Download folder path
- Auto-create metadata notes
- Metadata note template
- Sync interval

### Keyboard & Vim
- Enable vim keybindings
- Customizable hotkeys for: next/prev page, copy link, toggle TOC, toggle annotation sidebar

---

## 10. Development Phases

### Phase 1 — Core Reader & Deep Linking (MVP)
- EPUB.js viewer registered as `.epub` file handler
- Basic reader: paginated mode, TOC, font settings, theme
- CFI-based link syntax: `[[book.epub#cfi=...]]`
- Copy link to selection (single color)
- Click link → jump to position in EPUB
- Reading progress persistence

### Phase 2 — Backlink Highlighting
- Scan vault for backlinks → render as highlights
- Color palette with multiple colors
- Real-time highlight updates on note edits
- Hover sync (both directions)
- Filter backlinks by chapter
- Configurable copy templates

### Phase 3 — OPDS & Library
- OPDS catalog browser
- Download into vault
- Metadata note generation
- Calibre-Web authentication support

### Phase 4 — Polish & Power Features
- EPUB embeds in markdown
- Annotation sidebar
- Vim keybindings
- "Re-anchor highlights" recovery
- Export highlights to Calibre bookmark format
- Keyboard-driven annotation workflow
- Mobile support (Obsidian mobile)

---

## 11. Compatibility & Constraints

### Obsidian API
- EPUB++ will need to use some non-public Obsidian APIs (like PDF++ does) for deep view integration. This creates fragility risk on Obsidian updates.
- Where possible, prefer public API surfaces. Document all private API dependencies.

### EPUB Format Support
- EPUB 2.0 and 3.x reflowable content (primary target)
- Fixed-layout EPUBs (best-effort, no guarantee of pixel-perfect rendering)
- DRM-protected files are explicitly unsupported

### Performance
- Lazy-load EPUB content (EPUB.js handles this natively)
- Backlink scanning should be debounced and cached
- Books > 50MB should display a warning
- Highlight overlay rendering must not block page turns

### File Size Considerations
- EPUBs in the vault increase vault size. Provide guidance on using symlinks or external file references for large libraries.
- OPDS integration should default to downloading on-demand, not syncing entire catalogs.

---

## 12. Success Metrics

- **Deep link round-trip works**: Select text → copy link → paste in note → click link → lands on exact text. Must work reliably for 95%+ of EPUB files.
- **Backlink highlights render correctly**: Highlights appear at the right positions, with correct colors, within 500ms of opening an EPUB.
- **No data loss**: Uninstalling the plugin leaves all markdown notes intact and human-readable.
- **Community adoption**: Target feature parity with PDF++ for EPUBs within 6 months of initial release.

---

## 13. Prior Art & References

| Project | What to Learn | What to Avoid |
|---------|--------------|---------------|
| [PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus) | Backlink-as-annotation paradigm, template system, hover sync, settings granularity | Heavy reliance on private Obsidian APIs |
| [obsidian-epub-annotator](https://github.com/asfalots/obsidian-epub-annotator) | CFI-based positioning, `obsidian://` URI scheme | Limited to in-plugin notes, no backlink integration |
| [obsidian-annotator](https://github.com/elias-sundqvist/obsidian-annotator) | Hypothesis-based annotation UX | Instability, external dependency on Hypothesis |
| [EPUB.js](https://github.com/futurepress/epub.js) | Core rendering engine, CFI support | Performance with very large EPUBs |
| [Foliate](https://github.com/johnfactotum/foliate) | JSON-based annotation storage, clean reader UX | Linux-only, no Obsidian integration |
| [Readest](https://github.com/readest/readest) | Modern Tauri-based reader, OPDS support | No deep link URI scheme |
| [W3C EPUB CFI Spec](https://w3c.github.io/epub-specs/epub33/epubcfi/) | Canonical addressing standard | Complexity of full spec compliance |

---

## 14. Open Questions

1. **Private API risk**: How much of Obsidian's internal API will we need? Can we achieve the same integration depth as PDF++ while relying more on public APIs?

2. **Mobile support**: EPUB.js renders in a webview. Obsidian mobile has webview constraints. How much of the reader experience can we preserve on mobile?

3. **Collaboration with PDF++**: Should EPUB++ share infrastructure with PDF++ (common settings UI, template engine, hover sync system)? Or remain fully independent?

4. **EPUB modification**: Should EPUB++ ever write annotations into the EPUB file itself (for cross-reader portability), or strictly keep annotations in markdown?

5. **Calibre annotation interop**: Calibre stores highlights in `META-INF/calibre_bookmarks.txt` as base64 JSON with CFI positions. Should EPUB++ import/export this format for bidirectional sync with Calibre's viewer?

6. **KOReader sidecar import**: Given many users read on KOReader devices, should EPUB++ be able to import `.sdr` sidecar annotations and convert them to backlinks?
