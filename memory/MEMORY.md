# EPUB++ Switch-Over Plan

Last audited: 2026-03-29 | Plugin version: 0.1.0

## Non-Public API Dependencies

This plugin uses 3 non-public Obsidian API patterns. If any break after an Obsidian update, use the migration paths below.

---

### 1. HIGH RISK: `workspace.openLinkText()` Monkey-Patch

**File:** `src/main.ts` — `patchOpenLinkText()` (~line 88)

**Purpose:** Intercepts `[[book.epub#cfi=...]]` link clicks to:
- Reuse an existing EPUB view instead of opening a duplicate
- Open in a new tab instead of replacing the current note

**Breakage symptoms:**
- Clicking epub links in notes stops working or crashes
- `openLinkText` method signature changes

**Migration paths (in order of preference):**
1. If Obsidian adds `registerFileOpenHandler(extension, handler)` → migrate to it
2. Use `workspace.on('file-open')` event → redirect after the fact (brief flash)
3. Use `registerObsidianProtocolHandler` with `obsidian://epub-plus?file=...` URI scheme (changes link format)

**Emergency fix:** Remove `patchOpenLinkText()`, `unpatchOpenLinkText()`, and `originalOpenLinkText` field from `main.ts`. Plugin still works — links just open in current tab.

---

### 2. MEDIUM RISK: `workspace.trigger("hover-link")` Event

**File:** `src/backlinks/hover-popover.ts` — `showHighlightPopover()` (~line 22)

**Purpose:** Shows Obsidian's built-in page preview popover when hovering highlights in the EPUB.

**Breakage symptoms:**
- Hover preview stops appearing
- Console errors about `hover-link` or `HoverPopover`

**Migration paths:**
1. If Obsidian adds `app.workspace.showPreview(file, el)` → migrate to it
2. Build custom popover: read file via `vault.read()`, render with `MarkdownRenderer.render()`, show in positioned div

**Emergency fix:** Already wrapped in try/catch — degrades silently. Highlights remain clickable (Ctrl+click opens note).

**Other plugins using this:** PDF++, Annotator, Excalidraw, Hover Editor — Obsidian unlikely to break without notice.

---

### 3. LOW-MEDIUM RISK: `.internal-embed` DOM Query

**File:** `src/embeds/epub-embed-processor.ts` — line 11

**Purpose:** Finds `![[book.epub#cfi=...]]` embed elements in reading mode and replaces them with styled blockquotes.

**Breakage symptoms:**
- EPUB embeds show as broken/unresolved instead of blockquotes
- Class name changes

**Migration paths:**
1. If Obsidian adds `registerEmbedHandler(extension, handler)` → migrate to it
2. Switch to code block syntax: `` ```epub-quote `` with `registerMarkdownCodeBlockProcessor`

**Emergency fix:** Processor silently does nothing — embeds show as plain links. No crash.

---

## Semi-Public APIs (Low Risk, Monitor)

| API | File | Risk |
|-----|------|------|
| `parseLinktext()` | main.ts, backlink-scanner.ts | Exported utility, stable |
| `metadataCache.on("changed"/"resolved")` | backlink-scanner.ts | Documented events |
| `setEphemeralState({subpath})` | epub-view.ts | Same pattern as PDF viewer |
| `eState: {subpath}` in openFile | main.ts | Semi-documented |

---

## Post-Update Testing Checklist

Run after any major Obsidian update:

- [ ] Click `[[book.epub#cfi=...]]` in a note → opens epub in new tab, navigates to position
- [ ] With epub open, click another link → navigates existing view, doesn't open duplicate
- [ ] Hover highlight in epub → shows source note preview
- [ ] `![[book.epub#cfi=...]]` in reading mode → renders as styled blockquote
- [ ] Open epub with backlinks → highlights appear in text
- [ ] Navigate to chapter 5, close/reopen → resumes at chapter 5
- [ ] Select text, press 1-7 → highlight created, link copied

---

## Renderer Abstraction Plan

See [renderer-abstraction-plan.md](renderer-abstraction-plan.md) for the full strategy pattern design to support multiple rendering engines (epub.js, Readium).

## Optimization Plan

See [optimization-plan.md](optimization-plan.md) for 9 identified optimizations grouped by impact (high/medium/low) with file references and fix strategies.
