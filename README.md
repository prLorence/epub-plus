# EPUB++

Read EPUB files in Obsidian with deep linking, backlink highlights, and CFI-based annotations.

Desktop only. Requires Obsidian 1.12.7+.

## Features

### Reader

- **Paginated or scrolled** reading modes
- **Customizable display**: font size, font family, line height, margins
- **Themes**: match Obsidian, light, dark, or sepia
- **Table of contents** panel with active chapter tracking
- **Vim keybindings** (optional): `j`/`k`, `h`/`l`, `g`/`G` for navigation
- **Reading progress**: auto-saved per book, syncs to disk every N page turns (configurable)
- **Continue reading** command to resume your most recent book

### Deep linking

Select text in the reader and pick a color to create a CFI-based link:

```
[[book.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&color=yellow&chapter=Chapter+1&text=selected+text]]
```

Links can be copied to clipboard or inserted directly into the active note (at cursor or appended).

### Backlink highlights

Links from your notes back to an EPUB are rendered as colored highlights in the reader. The backlink panel groups them by chapter with hover sync between the panel and the reader.

### Embeds

Embed highlighted passages as styled blockquotes in your notes:

```
![[book.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&color=yellow&chapter=Chapter 1]]
```

Text is resolved from the EPUB and cached for fast rendering.

### Copy templates

Customize how links are formatted with template variables:

| Variable | Description |
|---|---|
| `{{fileName}}` | EPUB filename without extension |
| `{{title}}` | Book title from metadata |
| `{{author}}` | Book author from metadata |
| `{{chapter}}` | Current chapter name |
| `{{selection}}` | Selected text |
| `{{linkedSelection}}` | Selected text as a wikilink |
| `{{link}}` | Short display alias link |
| `{{rawLink}}` | Plain wikilink without alias |
| `{{color}}` | Highlight color name |

Default template:

```
> [!quote|{{color}}] {{chapter}}
> {{linkedSelection}}
```

Multiple templates can be saved and switched between.

### Color palette

Seven default colors (yellow, red, green, blue, purple, pink, orange) with full customization: add, rename, change hex values, or delete. Use number keys 1-9 to quickly apply colors to a selection.

## Installation

### From community plugins

Search for **EPUB++** in Obsidian's community plugin browser.

### Manual

Copy `main.js`, `styles.css`, and `manifest.json` into your vault at:

```
<vault>/.obsidian/plugins/epub-plus/
```

## Settings

| Section | Setting | Default |
|---|---|---|
| Reader | Reading mode | Paginated |
| Reader | Font size | 18px |
| Reader | Line height | 1.6 |
| Reader | Margin | 40px |
| Reader | Theme | Match Obsidian |
| Reader | Show TOC on open | Off |
| Backlinks | Enable highlighting | On |
| Backlinks | Highlight opacity | 0.3 |
| Backlinks | Show backlink panel | Off |
| Backlinks | Filter by chapter | Off |
| Copy | Default highlight color | Yellow |
| Copy | Auto-copy on highlight | Off |
| Copy | Add to note mode | Append |
| Hover | Hover action | Show preview |
| Hover | Hover sync | Both directions |
| Keyboard | Vim keybindings | Off |
| Progress | Auto-save progress | On |
| Progress | Sync every n pages | 5 |

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build
npm run lint    # eslint
```

## License

0-BSD
