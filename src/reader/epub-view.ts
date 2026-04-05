import { FileView, TFile, WorkspaceLeaf, Scope, Notice, Modal, Setting, sanitizeHTMLToDom, Platform } from "obsidian";
import type { EventRef } from "obsidian";
import type { ReaderLocation, SelectionInfo, TocItem } from "../engine/types";
import { EPUB_VIEW_TYPE } from "../constants";
import { EpubRenderer } from "./epub-renderer";
import { TocPanel } from "./toc-panel";
import { ReaderToolbar } from "./reader-toolbar";
import { parseEpubSubpath } from "../links/epub-link-parser";
import { VimBindings } from "./vim-bindings";
import {
	copyLinkToSelection,
	appendLinkToActiveNote,
} from "../links/link-copy";
import type { LinkCopyContext } from "../links/link-copy";
import {
	scanBacklinksForEpub,
	watchBacklinks,
} from "../backlinks/backlink-scanner";
import { HighlightManager } from "../backlinks/highlight-manager";
import { BacklinkPanel } from "../backlinks/backlink-panel";
import { AnnotationPanel } from "../backlinks/annotation-panel";
import { HoverSyncBridge } from "../backlinks/hover-sync";
import { navigateToBacklink } from "../backlinks/hover-popover";
import { showColorPalettePopup } from "./color-palette";
import { SearchPanel } from "./search-panel";
import { BookmarkPanel } from "./bookmark-panel";
import type { PaletteColor } from "../types";
import type EpubPlusPlugin from "../main";

export class EpubView extends FileView {
	private plugin: EpubPlusPlugin;
	private renderer: EpubRenderer | null = null;
	private tocPanel: TocPanel | null = null;
	private toolbar: ReaderToolbar | null = null;
	private highlightManager: HighlightManager | null = null;
	private backlinkPanel: BacklinkPanel | null = null;
	private annotationPanel: AnnotationPanel | null = null;
	private searchPanel: SearchPanel | null = null;
	private bookmarkPanel: BookmarkPanel | null = null;
	private hoverSync: HoverSyncBridge | null = null;
	private backlinkWatchRefs: EventRef[] = [];
	private pendingCfi: string | null = null;
	private containerEl_: HTMLElement | null = null;
	private renditionEl: HTMLElement | null = null;
	private loadingEl: HTMLElement | null = null;
	private vimBindings: VimBindings | null = null;
	private pageTurnsSinceSave = 0;
	private narrowObserver: ResizeObserver | null = null;
	private progressFillEl: HTMLElement | null = null;
	private chapterPageEl: HTMLElement | null = null;
	private bookPercentEl: HTMLElement | null = null;
	/** Navigation history stack for back navigation (stores CFIs). */
	private navHistory: string[] = [];
	/** User bookmarks for the current book. */
	private bookmarks: { cfi: string; label: string; created: string }[] = [];
	/** Track document-level dismiss handlers for cleanup. */
	private activeDismissHandlers: Array<() => void> = [];
	/** When true, the next relocate is from a back/sequential navigation — don't push to history. */
	private suppressHistoryPush = false;
	/** The CFI before the most recent non-page-turn navigation. */
	private lastCfi: string | null = null;
	private pendingSelection: {
		cfiRange: string;
		text: string;
		selection: SelectionInfo;
	} | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: EpubPlusPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true;

		this.scope = new Scope(this.app.scope);
		this.scope.register([], "ArrowRight", (e) => {
			if (this.isTyping(e)) return true;
			this.nextPage();
			return false;
		});
		this.scope.register([], "ArrowLeft", (e) => {
			if (this.isTyping(e)) return true;
			this.prevPage();
			return false;
		});
		this.scope.register([], " ", (e) => {
			if (this.isTyping(e)) return true;
			this.nextPage();
			return false;
		});
		this.scope.register(["Shift"], " ", (e) => {
			if (this.isTyping(e)) return true;
			this.prevPage();
			return false;
		});
		this.scope.register([], "Escape", () => {
			this.pendingSelection = null;
			// Don't consume the event — let Obsidian handle Escape too
			return true;
		});

		// Ctrl/Cmd+D — toggle bookmark
		this.scope.register(["Mod"], "d", (e) => {
			if (this.isTyping(e)) return true;
			e.preventDefault();
			this.toggleBookmark();
			return false;
		});

		// Ctrl/Cmd+F — search in book
		this.scope.register(["Mod"], "f", (e) => {
			if (this.isTyping(e)) return true;
			e.preventDefault();
			this.searchPanel?.toggle();
			return false;
		});

		// Alt+Left arrow to go back after clicking a link
		this.scope.register(["Alt"], "ArrowLeft", () => {
			this.goBack();
			return false;
		});

		// Page Up / Page Down
		this.scope.register([], "PageDown", (e) => {
			if (this.isTyping(e)) return true;
			this.nextPage();
			return false;
		});
		this.scope.register([], "PageUp", (e) => {
			if (this.isTyping(e)) return true;
			this.prevPage();
			return false;
		});

		// Home / End — go to beginning / end of book
		this.scope.register([], "Home", (e) => {
			if (this.isTyping(e)) return true;
			void this.renderer?.display();
			return false;
		});
		this.scope.register([], "End", (e) => {
			if (this.isTyping(e)) return true;
			const href = this.renderer?.getRendition()?.getSpineEndHref();
			if (href) void this.renderer?.display(href);
			return false;
		});

		// Number keys 1-9 for quick color selection
		for (let i = 0; i < 9; i++) {
			this.scope.register([], String(i + 1), () => {
				if (!this.pendingSelection) return true;
				const color = this.plugin.settings.colorPalette[i];
				if (!color) return true;
				this.createHighlightAnnotation(
					this.pendingSelection.cfiRange,
					color,
				);
				this.pendingSelection.selection.clearSelection();
				void this.copyWithColor(
					this.pendingSelection.cfiRange,
					this.pendingSelection.text,
					color.name,
				);
				this.pendingSelection = null;
				return false;
			});
		}
	}

	getViewType(): string {
		return EPUB_VIEW_TYPE;
	}

	private currentChapterForTab = "";

	getDisplayText(): string {
		if (this.currentChapterForTab) {
			return `${this.file?.basename ?? "EPUB"} — ${this.currentChapterForTab}`;
		}
		return this.file?.basename ?? "EPUB";
	}

	getIcon(): string {
		return "book-open";
	}

	canAcceptExtension(extension: string): boolean {
		return extension === "epub";
	}

	async onLoadFile(file: TFile): Promise<void> {
		console.debug("[EPUB++] onLoadFile:", file.path);
		try {
		await this.onLoadFileInner(file);
		} catch (e) {
			console.error("[EPUB++] onLoadFile FAILED:", e);
			new Notice(`Failed to open "${file.basename}": ${String(e)}`);
		}
	}

	private async onLoadFileInner(file: TFile): Promise<void> {
		// If another leaf already has this file open, redirect there instead
		const existingLeaf = this.plugin.findExistingEpubLeaf(
			file.path,
			this.leaf,
		);
		if (existingLeaf) {
			console.debug("[EPUB++] Redirecting to existing leaf");
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
			if (this.pendingCfi) {
				existingLeaf.view.setEphemeralState({
					subpath: `#cfi=${this.pendingCfi}`,
				});
				this.pendingCfi = null;
			}
			void this.leaf.setViewState({ type: "empty", state: {} });
			void this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		this.buildDom();

		console.debug("[EPUB++] Reading binary data...");
		const data = await this.app.vault.readBinary(file);
		console.debug("[EPUB++] Binary data size:", data.byteLength);

		this.renderer = new EpubRenderer(
			this.renditionEl!,
			this.plugin.settings,
			{
				onRelocated: (location: ReaderLocation) =>
					this.handleRelocated(location),
				onSelected: (cfiRange: string, selection: SelectionInfo) =>
					this.handleSelected(cfiRange, selection),
				onRendered: () => this.handleRendered(),
				onFocused: () => {
					this.app.workspace.setActiveLeaf(this.leaf, {
						focus: false,
					});
				},
				onBeforeResizeNav: () => {
					this.suppressHistoryPush = true;
				},
				onFootnoteClick: (content, event) => {
					this.showFootnotePopup(content, event);
				},
			},
		);

		await this.renderer.open(data);

		// TOC panel — some EPUBs have missing/broken TOC files
		let toc: TocItem[] = [];
		try {
			toc = await this.renderer.getTocAsync();
		} catch {
			console.debug("[EPUB++] TOC loading failed, using empty TOC");
		}
		this.tocPanel = new TocPanel(
			this.containerEl_!.querySelector(".epub-plus-toc-panel")!,
			toc,
			(href) => {
				this.suppressHistoryPush = true;
				void this.renderer?.display(href);
			},
		);
		if (this.plugin.settings.showTocOnOpen) {
			this.tocPanel.show();
		}

		// Toolbar
		this.toolbar = new ReaderToolbar(
			this.containerEl_!.querySelector(".epub-plus-toolbar")!,
			{
				onPrev: () => this.prevPage(),
				onNext: () => this.nextPage(),
				onTocToggle: () => this.tocPanel?.toggle(),
				onBacklinksToggle: () => this.backlinkPanel?.toggle(),
				onAnnotationsToggle: () => this.annotationPanel?.toggle(),
				onSearchToggle: () => this.searchPanel?.toggle(),
				onBookmark: () => this.bookmarkPanel?.toggle(),
				onFontSizeChange: (delta) => this.changeFontSize(delta),
				onGoBack: () => this.goBack(),
				onLinkNote: () => this.linkCompanionNote(),
			},
		);

		// Display at saved position or pending CFI
		const startCfi = this.pendingCfi ?? await this.getSavedCfi(file);
		this.pendingCfi = null;

		try {
			await this.renderer.display(startCfi ?? undefined);
		} catch {
			// If display fails (e.g., bad saved CFI), display from beginning
			await this.renderer.display();
		}

		// Book is ready — hide loading screen
		this.hideLoading();

		// Fix blank page: EPUB.js needs the container to be fully laid out
		// before it can render correctly. Wait for the layout to settle,
		// then resize and re-display at the saved position.
		setTimeout(() => {
			if (!this.renderer) return;
			this.renderer.forceResize();
			void this.renderer.display(startCfi ?? undefined);
		}, 300);

		// Vim keybindings
		if (this.plugin.settings.enableVimBindings && this.renderer && !Platform.isMobile) {
			this.vimBindings = new VimBindings(this.scope!, this.renderer, {
				onNext: () => this.nextPage(),
				onPrev: () => this.prevPage(),
			});
		}

		// Bookmark panel
		const bmEl = this.containerEl_?.querySelector(
			".epub-plus-bm-panel",
		) as HTMLElement | null;
		if (bmEl) {
			this.bookmarkPanel = new BookmarkPanel(bmEl, {
				onBookmarkClick: (bm) => {
					void this.renderer?.display(bm.cfi);
				},
				onBookmarkDelete: (bm) => {
					this.bookmarks = this.bookmarks.filter(
						(b) => b.cfi !== bm.cfi,
					);
					this.bookmarkPanel?.setBookmarks(this.bookmarks);
					void this.saveBookmarks();
					new Notice("Bookmark removed");
				},
				onBookmarkAdd: () => this.toggleBookmark(),
			});
		}

		// Load bookmarks
		this.loadBookmarks();
		this.bookmarkPanel?.setBookmarks(this.bookmarks);

		// Search panel
		const searchEl = this.containerEl_?.querySelector(
			".epub-plus-search-panel",
		) as HTMLElement | null;
		if (searchEl && this.renderer) {
			this.searchPanel = new SearchPanel(
				searchEl,
				this.renderer.getEngine()!,
				{
					onResultClick: (result) => {
						void this.renderer?.display(result.href);
					},
					onClose: () => { /* panel handles its own visibility */ },
				},
			);
		}

		// Phase 2: Backlink highlighting
		this.setupBacklinkHighlighting(file);
	}

	async onUnloadFile(file: TFile): Promise<void> {
		// Clean up any document-level dismiss handlers
		for (const cleanup of this.activeDismissHandlers) {
			cleanup();
		}
		this.activeDismissHandlers = [];

		await this.plugin.progressStore.save();
		this.teardownBacklinks();
		this.narrowObserver?.disconnect();
		this.narrowObserver = null;
		this.renderer?.destroy();
		this.renderer = null;
		this.tocPanel = null;
		this.toolbar = null;
		this.progressFillEl = null;
		this.chapterPageEl = null;
		this.bookPercentEl = null;
		if (this.loadingEl) {
			this.loadingEl.remove();
			this.loadingEl = null;
		}
		if (this.containerEl_) {
			this.containerEl_.remove();
			this.containerEl_ = null;
		}
	}

	setEphemeralState(state: Record<string, unknown>): void {
		super.setEphemeralState(state);
		const subpath = state?.["subpath"] as string | undefined;
		if (!subpath) return;

		const params = parseEpubSubpath(subpath);
		if (!params) return;

		const target = params.cfi ?? undefined;
		if (!target) return;

		if (this.renderer) {
			void this.renderer.display(target);
		} else {
			this.pendingCfi = target;
		}
	}

	private buildDom(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("epub-plus-root");
		if (Platform.isMobile) {
			contentEl.addClass("is-mobile");
		}

		// Loading screen
		this.loadingEl = contentEl.createDiv({ cls: "epub-plus-loading" });
		this.loadingEl.createDiv({
			cls: "epub-plus-loading-spinner",
		});
		this.loadingEl.createDiv({
			cls: "epub-plus-loading-text",
			text: "Loading book...",
		});

		this.containerEl_ = contentEl.createDiv({
			cls: "epub-plus-container",
		});
		this.containerEl_.createDiv({ cls: "epub-plus-toc-panel" });

		const readerArea = this.containerEl_.createDiv({
			cls: "epub-plus-reader-area",
		});
		readerArea.createDiv({ cls: "epub-plus-toolbar" });
		this.renditionEl = readerArea.createDiv({
			cls: "epub-plus-rendition",
		});

		// Click-to-turn zones on left/right margins
		const prevZone = this.renditionEl.createDiv({ cls: "epub-plus-page-zone epub-plus-page-zone-prev" });
		prevZone.addEventListener("click", () => this.prevPage());
		const nextZone = this.renditionEl.createDiv({ cls: "epub-plus-page-zone epub-plus-page-zone-next" });
		nextZone.addEventListener("click", () => this.nextPage());

		// Swipe navigation on mobile
		if (Platform.isMobile) {
			this.setupSwipeNavigation(this.renditionEl);
		}

		const bottomBar = readerArea.createDiv({ cls: "epub-plus-bottom-bar" });
		this.progressFillEl = bottomBar.createDiv({ cls: "epub-plus-progress-fill" });
		this.chapterPageEl = bottomBar.createDiv({ cls: "epub-plus-bottom-chapter" });
		this.bookPercentEl = bottomBar.createDiv({ cls: "epub-plus-bottom-percent" });

		// Click on progress bar to jump to position
		bottomBar.addEventListener("click", (e) => {
			const rect = bottomBar.getBoundingClientRect();
			const pct = (e.clientX - rect.left) / rect.width;
			this.jumpToPercentage(pct);
		});

		this.containerEl_.createDiv({ cls: "epub-plus-backlink-panel" });
		this.containerEl_.createDiv({ cls: "epub-plus-anno-panel" });
		this.containerEl_.createDiv({ cls: "epub-plus-search-panel" });
		this.containerEl_.createDiv({ cls: "epub-plus-bm-panel" });

		// Observe width changes to toggle narrow/very-narrow modes.
		// Track previous breakpoint to avoid redundant DOM mutations.
		const rootEl = this.contentEl;
		let prevNarrow = false;
		let prevVeryNarrow = false;
		this.narrowObserver = new ResizeObserver(() => {
			const w = rootEl.clientWidth;
			const narrow = w < 500;
			const veryNarrow = w < 350;
			if (narrow !== prevNarrow) {
				rootEl.classList.toggle("is-narrow", narrow);
				prevNarrow = narrow;
			}
			if (veryNarrow !== prevVeryNarrow) {
				rootEl.classList.toggle("is-very-narrow", veryNarrow);
				prevVeryNarrow = veryNarrow;
			}
		});
		this.narrowObserver.observe(rootEl);
	}

	private hideLoading(): void {
		if (this.loadingEl) {
			this.loadingEl.remove();
			this.loadingEl = null;
		}
	}

	// ── Phase 2: Backlink Highlighting ──

	private setupBacklinkHighlighting(file: TFile): void {
		if (!this.plugin.settings.enableBacklinkHighlighting) return;
		if (!this.renderer) return;

		const settings = this.plugin.settings;

		// Highlight manager
		this.highlightManager = new HighlightManager(
			() => this.renderer?.getRendition() ?? null,
			settings.colorPalette,
			settings.highlightOpacity,
			{
				onHighlightClick: (bls, e) =>
					this.handleHighlightClick(bls, e),
				onHighlightHover: (bls, e) =>
					this.handleHighlightHover(bls, e),
				onHighlightContextMenu: (bls, e) =>
					this.handleHighlightContextMenu(bls, e),
			},
		);

		// Backlink panel
		const panelEl = this.containerEl_?.querySelector(
			".epub-plus-backlink-panel",
		) as HTMLElement | null;
		if (panelEl) {
			this.backlinkPanel = new BacklinkPanel(
				this.app,
				panelEl,
				{
					onEntryHover: (bl) =>
						this.hoverSync?.onPanelEntryHover(bl),
					onEntryClick: (bl) => {
						void this.renderer?.display(bl.cfiStart);
					},
				},
				settings.colorPalette,
			);
			if (settings.showBacklinkPanel) {
				this.backlinkPanel.show();
			}
			this.backlinkPanel.setFilterByChapter(
				settings.filterBacklinksByChapter,
			);
		}

		// Hover sync bridge
		this.hoverSync = new HoverSyncBridge(
			this.highlightManager,
			this.backlinkPanel,
			settings.hoverSyncMode,
		);

		// Annotation panel
		const annoEl = this.containerEl_?.querySelector(
			".epub-plus-anno-panel",
		) as HTMLElement | null;
		if (annoEl) {
			this.annotationPanel = new AnnotationPanel(
				annoEl,
				{
					onAnnotationClick: (bl) => {
						void this.renderer?.display(bl.cfiStart);
					},
					onAnnotationHover: (bl) => {
						this.hoverSync?.onPanelEntryHover(bl);
					},
					onColorChange: (_bl, _newColor) => {
						// TODO: update the link color in the source note
					},
				},
				settings.colorPalette,
			);
		}

		// Initial scan
		const backlinks = scanBacklinksForEpub(
			this.app,
			file.path,
			settings.defaultHighlightColor,
		);
		this.highlightManager.applyBacklinks(backlinks);
		this.backlinkPanel?.setBacklinks(backlinks);
		this.annotationPanel?.setBacklinks(backlinks);

		// Watch for changes
		this.backlinkWatchRefs = watchBacklinks(
			this.app,
			file.path,
			settings.defaultHighlightColor,
			(updatedBacklinks) => {
				this.highlightManager?.applyBacklinks(updatedBacklinks);
				this.backlinkPanel?.setBacklinks(updatedBacklinks);
				this.annotationPanel?.setBacklinks(updatedBacklinks);
			},
		);
	}

	private teardownBacklinks(): void {
		for (const ref of this.backlinkWatchRefs) {
			this.app.metadataCache.offref(ref);
		}
		this.backlinkWatchRefs = [];
		this.highlightManager?.clearAll();
		this.highlightManager = null;
		this.backlinkPanel = null;
		this.annotationPanel = null;
		this.hoverSync = null;
	}

	private handleHighlightClick(
		backlinks: import("../types").EpubBacklink[],
		event: MouseEvent,
	): void {
		if (event.ctrlKey || event.metaKey) {
			// Ctrl/Cmd+click → open source note
			if (backlinks.length > 0) {
				navigateToBacklink(this.app, backlinks[0]!);
			}
		} else if (backlinks.length > 0) {
			this.showInlineNoteEditor(backlinks[0]!, event);
		}
	}

	private handleHighlightHover(
		backlinks: import("../types").EpubBacklink[] | null,
		_event: MouseEvent,
	): void {
		this.hoverSync?.onHighlightHover(backlinks);
	}

	private showInlineNoteEditor(
		bl: import("../types").EpubBacklink,
		event: MouseEvent,
	): void {
		// Remove any existing editor
		const existing = this.contentEl.querySelector(".epub-plus-inline-note");
		if (existing) existing.remove();

		const editor = this.contentEl.createDiv({ cls: "epub-plus-inline-note" });

		// Position near the click
		const containerRect = this.contentEl.getBoundingClientRect();
		const renditionRect = this.renditionEl?.getBoundingClientRect();
		const x = event.clientX + (renditionRect?.left ?? 0) - containerRect.left;
		const y = event.clientY + (renditionRect?.top ?? 0) - containerRect.top + 10;

		editor.setCssProps({
			"position": "absolute",
			"left": `${Math.max(20, Math.min(x - 150, containerRect.width - 320))}px`,
			"top": `${y}px`,
			"z-index": "20",
		});

		// Header with highlighted text
		if (bl.text) {
			const quote = editor.createDiv({ cls: "epub-plus-inline-note-quote" });
			const stripe = quote.createEl("span", { cls: "epub-plus-inline-note-stripe" });
			stripe.style.backgroundColor = this.plugin.settings.colorPalette.find(
				(c) => c.name === bl.color,
			)?.hex ?? "#ffd400";
			quote.createEl("span", {
				text: bl.text.length > 120 ? bl.text.slice(0, 120) + "..." : bl.text,
			});
		}

		// Load existing note content from the source file
		const textarea = editor.createEl("textarea", {
			cls: "epub-plus-inline-note-textarea",
			attr: { placeholder: "Add a note...", rows: "3" },
		});

		// Try to load existing note from the line below the link
		void this.loadExistingNote(bl).then((note) => {
			if (note) textarea.value = note;
		});

		// Buttons
		const actions = editor.createDiv({ cls: "epub-plus-inline-note-actions" });

		const sourceBtn = actions.createEl("button", {
			cls: "epub-plus-inline-note-btn",
			text: "Open note",
			title: "Open source note",
		});
		sourceBtn.addEventListener("click", () => {
			navigateToBacklink(this.app, bl);
			editor.remove();
		});

		const saveBtn = actions.createEl("button", {
			cls: "epub-plus-inline-note-btn epub-plus-inline-note-save",
			text: "Save",
		});
		saveBtn.addEventListener("click", () => {
			void this.saveInlineNote(bl, textarea.value);
			editor.remove();
		});

		// On mobile, lock the rendition height before focusing so the
		// virtual keyboard doesn't shrink/reflow the reader content.
		if (Platform.isMobile && this.renditionEl) {
			const lockedHeight = this.renditionEl.clientHeight;
			this.renditionEl.style.minHeight = `${lockedHeight}px`;
			const unlockHeight = () => {
				if (this.renditionEl) {
					this.renditionEl.style.minHeight = "";
				}
			};
			textarea.addEventListener("blur", unlockHeight, { once: true });
			// Also unlock when the editor is removed
			const origRemove = editor.remove.bind(editor);
			editor.remove = () => {
				unlockHeight();
				origRemove();
			};
		}

		// Focus the textarea
		setTimeout(() => textarea.focus(), 50);

		// Dismiss on Escape
		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				editor.remove();
			}
			// Ctrl/Cmd+Enter to save
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				void this.saveInlineNote(bl, textarea.value);
				editor.remove();
			}
			// Stop propagation so epub.js doesn't handle the keypress
			e.stopPropagation();
		});

		// Dismiss on click outside
		const dismiss = (e: Event) => {
			if (!editor.contains(e.target as Node)) {
				editor.remove();
				document.removeEventListener("mousedown", dismiss);
			}
		};
		this.registerDismissHandler("mousedown", dismiss, 100);
	}

	private async loadExistingNote(
		bl: import("../types").EpubBacklink,
	): Promise<string | null> {
		try {
			const file = this.app.vault.getAbstractFileByPath(bl.sourcePath);
			if (!(file instanceof TFile)) return null;

			const content = await this.app.vault.read(file);
			const lines = content.split("\n");
			const linkLine = bl.position.line;

			// Find the end of the callout block
			let blockEnd = linkLine;
			for (let i = linkLine + 1; i < lines.length; i++) {
				if (lines[i]!.startsWith("> ")) {
					blockEnd = i;
				} else {
					break;
				}
			}

			// Extract note lines from inside the block
			// (lines that aren't the callout header, the link, or empty ">")
			const noteParts: string[] = [];
			for (let i = linkLine + 1; i <= blockEnd; i++) {
				const line = lines[i]!;
				if (line.startsWith("> [[") || line.startsWith("> ![[")) continue;
				if (line.startsWith("> [!")) continue; // callout header
				if (line === ">") continue;
				// Strip the "> " prefix
				noteParts.push(line.startsWith("> ") ? line.slice(2) : line);
			}
			return noteParts.length > 0 ? noteParts.join("\n") : null;
		} catch {
			return null;
		}
	}

	private async saveInlineNote(
		bl: import("../types").EpubBacklink,
		note: string,
	): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(bl.sourcePath);
			if (!(file instanceof TFile)) {
				new Notice("Source note not found");
				return;
			}

			const content = await this.app.vault.read(file);
			const lines = content.split("\n");
			const linkLine = bl.position.line;
			const noteText = note.trim();
			if (!noteText) return;

			// Find the end of the callout/quote block containing the link
			let blockEnd = linkLine;
			for (let i = linkLine + 1; i < lines.length; i++) {
				const line = lines[i]!;
				if (line.startsWith("> ")) {
					blockEnd = i;
				} else {
					break;
				}
			}

			// Remove any existing inline note lines (lines starting with "> "
			// that are NOT the callout header or the link itself, after the link line)
			// Then re-add the note as "> " prefixed lines inside the block.
			const noteLines = noteText.split("\n").map((l) => `> ${l}`);

			// Check if there's already a note inside the block (after the link)
			// The link is on linkLine. Lines after it within the block that aren't
			// part of the original callout structure are the note.
			let existingNoteStart = -1;
			let existingNoteEnd = -1;
			for (let i = linkLine + 1; i <= blockEnd; i++) {
				const line = lines[i]!;
				// Skip the link line itself (it's part of the callout)
				if (line.startsWith("> [[") || line.startsWith("> ![[")) continue;
				if (line === ">") continue; // empty callout line
				// This is a note line
				if (existingNoteStart === -1) existingNoteStart = i;
				existingNoteEnd = i;
			}

			if (existingNoteStart !== -1 && existingNoteEnd !== -1) {
				// Replace existing note
				lines.splice(existingNoteStart, existingNoteEnd - existingNoteStart + 1, ...noteLines);
			} else {
				// Append note at the end of the block
				lines.splice(blockEnd + 1, 0, ...noteLines);
			}

			await this.app.vault.modify(file, lines.join("\n"));
			new Notice("Note saved");
		} catch (e) {
			new Notice(`Failed to save note: ${String(e)}`);
		}
	}

	private handleHighlightContextMenu(
		backlinks: import("../types").EpubBacklink[],
		event: MouseEvent,
	): void {
		if (backlinks.length === 0) return;

		// Remove any existing context menu
		const existing = this.contentEl.querySelector(".epub-plus-hl-context-menu");
		if (existing) existing.remove();

		const menu = this.contentEl.createDiv({ cls: "epub-plus-hl-context-menu" });

		// Position near the click
		const containerRect = this.contentEl.getBoundingClientRect();
		// The event coordinates are relative to the iframe, so we need to
		// translate to the parent container. Get the iframe's offset.
		const renditionRect = this.renditionEl?.getBoundingClientRect();
		const x = event.clientX + (renditionRect?.left ?? 0) - containerRect.left;
		const y = event.clientY + (renditionRect?.top ?? 0) - containerRect.top;

		menu.setCssProps({
			"position": "absolute",
			"left": `${x}px`,
			"top": `${y}px`,
			"z-index": "20",
		});

		// Color swatches
		const palette = this.plugin.settings.colorPalette;
		for (const color of palette) {
			const swatch = menu.createDiv({ cls: "epub-plus-anno-swatch" });
			swatch.style.backgroundColor = color.hex;
			swatch.title = color.name;
			swatch.addEventListener("click", (e) => {
				e.stopPropagation();
				// TODO: update the link color in the source note
				// For now, just show a notice
				new Notice(`Color change to "${color.name}" — edit the link in your note to update the color.`);
				menu.remove();
			});
		}

		// Dismiss on click outside
		const dismiss = () => {
			menu.remove();
			document.removeEventListener("click", dismiss);
		};
		this.registerDismissHandler("click", dismiss, 50);
	}

	// ── Event Handlers ──

	private handleRendered(): void {
		// EPUB.js rendered hook — reserved for future use
	}

	private handleRelocated(location: ReaderLocation): void {
		const locationsReady =
			this.renderer?.areLocationsReady() ?? false;
		const bookPercent = locationsReady
			? this.renderer!.getPercentage()
			: 0;

		// Track navigation history for back navigation.
		// Only push to history when an in-book link is clicked (not page
		// turns, not back navigation, not TOC clicks handled by us).
		// Sequential page turns (next/prev) and back navigation set
		// suppressHistoryPush=true before navigating.
		const currentCfi = location.cfi;
		if (this.suppressHistoryPush) {
			this.suppressHistoryPush = false;
		} else if (this.lastCfi && currentCfi !== this.lastCfi) {
			const currentHref = location.href;
			const prevHref = this.renderer?.getLastHref() ?? "";
			// Different file = a link was clicked inside the book
			if (prevHref && prevHref !== currentHref) {
				this.navHistory.push(this.lastCfi);
				if (this.navHistory.length > 50) {
					this.navHistory.shift();
				}
				this.toolbar?.showBackButton(true);
			}
		}
		this.lastCfi = currentCfi;
		this.renderer?.setLastHref(location.href);

		const chapterName = this.renderer?.getCurrentChapterTitle() ?? "";

		const displayed = location.displayed;
		this.toolbar?.updateChapter(chapterName);

		// Update tab title with chapter name
		if (chapterName !== this.currentChapterForTab) {
			this.currentChapterForTab = chapterName;
			// Trigger Obsidian's tab title refresh
			(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
		}

		// Update bottom progress bar
		if (this.progressFillEl) {
			this.progressFillEl.setCssProps({
				"--progress": `${String(bookPercent)}%`,
			});
		}
		if (this.chapterPageEl && displayed) {
			this.chapterPageEl.textContent =
				`${String(displayed.page)} of ${String(displayed.total)}`;
		}
		if (this.bookPercentEl) {
			if (bookPercent > 0) {
				const display = bookPercent % 1 === 0
					? String(bookPercent)
					: bookPercent.toFixed(1);
				const timeLeft = this.estimateReadingTime(bookPercent);
				this.bookPercentEl.textContent = timeLeft
					? `${display}% \u00b7 ${timeLeft}`
					: `${display}%`;
			} else {
				this.bookPercentEl.textContent = "";
			}
		}

		if (this.tocPanel) {
			const contentDoc = this.getContentDocument();
			this.tocPanel.setActiveHref(location.href, contentDoc);
		}

		// Update backlink panel chapter filter
		this.backlinkPanel?.setCurrentChapter(
			location.href,
			chapterName,
		);

		// Save reading progress — skip until locations are generated
		// to avoid overwriting accurate saved data with 0%
		const autoSave = this.plugin.settings.autoSaveProgress ?? true;
		if (
			this.file &&
			autoSave &&
			locationsReady &&
			location.cfi
		) {
			this.plugin.progressStore.set(this.file.path, {
				cfi: location.cfi,
				percent: bookPercent,
				updated: new Date().toISOString(),
			});

			// Only write to disk every N page turns
			this.pageTurnsSinceSave++;
			const syncInterval =
				this.plugin.settings.progressSyncPages ?? 5;
			if (this.pageTurnsSinceSave >= syncInterval) {
				this.pageTurnsSinceSave = 0;
				console.debug(
					"[EPUB++] Syncing progress to disk:",
					bookPercent + "%",
					location.cfi,
				);
				this.plugin.progressStore.scheduleSave();
			}
		}
	}

	private handleSelected(cfiRange: string, selInfo: SelectionInfo): void {
		const text = selInfo.text;
		if (!text || !this.file) return;

		this.pendingSelection = { cfiRange, text, selection: selInfo };

		// Quick-add mode: skip popup, use default color instantly
		if (this.plugin.settings.autoCopyOnHighlight) {
			const defaultColor = this.plugin.settings.colorPalette.find(
				(c) => c.name === this.plugin.settings.defaultHighlightColor,
			) ?? this.plugin.settings.colorPalette[0];
			if (defaultColor) {
				this.createHighlightAnnotation(cfiRange, defaultColor);
				const context = this.extractContextFromSelection(selInfo, text);
				void this.copyWithColor(cfiRange, text, defaultColor.name, context);
				selInfo.clearSelection();
				this.pendingSelection = null;
				return;
			}
		}

		this.showSelectionPopup(selInfo, cfiRange, text);
	}

	private extractContextFromSelection(selInfo: SelectionInfo, text: string): string {
		try {
			const sel = selInfo.window.getSelection();
			if (!sel || sel.rangeCount === 0) return text;
			return this.extractContext(sel.getRangeAt(0), text);
		} catch {
			return text;
		}
	}

	private showSelectionPopup(
		selInfo: SelectionInfo,
		cfiRange: string,
		text: string,
	): void {
		const doc = selInfo.document;
		const winSel = selInfo.window.getSelection();
		if (!winSel || winSel.rangeCount === 0) return;

		const range = winSel.getRangeAt(0);
		const rect = range.getBoundingClientRect();
		const palette = this.plugin.settings.colorPalette;

		// Capture context before the selection gets cleared
		const context = this.extractContext(range, text);

		showColorPalettePopup(doc, rect, palette, {
			onColorSelect: (color: PaletteColor, style) => {
				this.createHighlightAnnotation(cfiRange, color, style);
				selInfo.clearSelection();
				void this.copyWithColor(cfiRange, text, color.name, context);
			},
			onAddToNote: (color: PaletteColor, style) => {
				this.createHighlightAnnotation(cfiRange, color, style);
				selInfo.clearSelection();
				void this.addToActiveNote(cfiRange, text, color.name, context);
			},
		});
	}

	private extractContext(range: Range, text: string): string {
		const container = range.commonAncestorContainer;
		const parentEl = container.nodeType === Node.TEXT_NODE
			? container.parentElement
			: container as Element;
		if (!parentEl) return text;

		const fullText = parentEl.textContent ?? "";
		const idx = fullText.indexOf(text);
		if (idx < 0) return text;

		const before = fullText.slice(Math.max(0, idx - 50), idx).trim();
		const after = fullText.slice(idx + text.length, idx + text.length + 50).trim();
		return (before ? "..." + before + " " : "")
			+ text
			+ (after ? " " + after + "..." : "");
	}

	private createHighlightAnnotation(
		cfiRange: string,
		color: PaletteColor,
		style: "highlight" | "underline" = "highlight",
	): void {
		const rendition = this.renderer?.getRendition();
		if (!rendition) return;

		// Save the current position so we can restore it if applying
		// the highlight causes epub.js to navigate (cross-page selections).
		const currentCfi = rendition.getCurrentLocation()?.cfi ?? null;

		try {
			this.suppressHistoryPush = true;
			rendition.addHighlight(
				cfiRange,
				{},
				color.hex,
				this.plugin.settings.highlightOpacity,
				undefined,
				style,
			);
		} catch {
			// ignore CFI resolution errors
		}

		// Restore position if the highlight application navigated away
		if (currentCfi) {
			const afterCfi = rendition.getCurrentLocation()?.cfi ?? null;
			if (afterCfi && afterCfi !== currentCfi) {
				this.suppressHistoryPush = true;
				void this.renderer?.display(currentCfi);
			}
		}
	}

	private async copyWithColor(
		cfiRange: string,
		text: string,
		color: string,
		context?: string,
	): Promise<void> {
		const ctx = await this.buildLinkContext(cfiRange, text, color, context);
		await copyLinkToSelection(ctx);
		this.showReaderToast("\u2713 Copied to clipboard");
	}

	private async addToActiveNote(
		cfiRange: string,
		text: string,
		color: string,
		context?: string,
	): Promise<void> {
		const ctx = await this.buildLinkContext(cfiRange, text, color, context);

		// Try companion note first (frontmatter storage mode)
		if (this.file && this.plugin.settings.progressStorage === "frontmatter") {
			const added = await this.appendToCompanionNote(ctx);
			if (added) return;
		}

		// Fall back to active markdown note
		const added = appendLinkToActiveNote(
			this.app,
			ctx,
			this.plugin.settings.addToNoteMode,
		);
		if (added) {
			new Notice("Link added to active note");
		} else {
			new Notice("No active note to add link to");
		}
	}

	private async appendToCompanionNote(ctx: LinkCopyContext): Promise<boolean> {
		if (!this.file) return false;

		const companionPath = this.plugin.progressStore
			.getCompanionNotePath(this.file.path);

		// Build the formatted link text
		const { parseCfiRange } = await import("../links/epub-link-parser");
		const { buildEpubSubpath } = await import("../links/epub-link-parser");
		const { start, end } = parseCfiRange(ctx.cfiRange);
		const subpath = buildEpubSubpath({
			cfi: start,
			end,
			color: ctx.color,
			text: ctx.selectedText.slice(0, 100),
			chapter: ctx.chapterTitle || undefined,
		});

		const template = this.plugin.settings.copyTemplate;
		const title = ctx.bookTitle ?? ctx.file.basename;
		const linkedSelection = `[[${ctx.file.path}${subpath}|${ctx.selectedText}]]`;
		const link = `[[${ctx.file.path}${subpath}|${ctx.selectedText.slice(0, 60)}]]`;
		const rawLink = `[[${ctx.file.path}${subpath}]]`;

		let formatted = template;
		const vars: Record<string, string> = {
			fileName: ctx.file.basename,
			title,
			author: ctx.bookAuthor ?? "",
			chapter: ctx.chapterTitle,
			selection: ctx.selectedText,
			linkedSelection,
			link,
			rawLink,
			color: ctx.color,
		};
		for (const [key, value] of Object.entries(vars)) {
			formatted = formatted.replace(
				new RegExp(`\\{\\{${key}\\}\\}`, "g"),
				value,
			);
		}

		// Append to the companion note
		const notePath = companionPath + ".md";
		let file = this.app.vault.getAbstractFileByPath(notePath);

		if (!(file instanceof TFile)) {
			// Create the companion note
			try {
				file = await this.app.vault.create(notePath, "");
			} catch {
				return false;
			}
		}
		if (!(file instanceof TFile)) return false;

		const content = await this.app.vault.read(file);
		const newContent = content
			? content.trimEnd() + "\n\n" + formatted + "\n"
			: formatted + "\n";
		await this.app.vault.modify(file, newContent);
		this.showReaderToast("\u2713 Added to note");
		return true;
	}

	private async buildLinkContext(
		cfiRange: string,
		text: string,
		color: string,
		context?: string,
	): Promise<LinkCopyContext> {
		return {
			file: this.file!,
			cfiRange,
			selectedText: text,
			chapterTitle:
				this.renderer?.getCurrentChapterTitle() ?? "",
			color,
			template: this.plugin.settings.copyTemplate,
			bookTitle: await this.renderer?.getBookTitle(),
			bookAuthor: await this.renderer?.getBookAuthor(),
			context,
		};
	}

	/**
	 * Check if the keyboard event target is a text input — if so,
	 * page-turn shortcuts should not fire.
	 */
	private toggleBookmark(): void {
		const loc = this.renderer?.getRendition()?.getCurrentLocation();
		if (!loc?.cfi || !this.file) return;

		const chapter = this.renderer?.getCurrentChapterTitle() ?? "";
		const percent = this.renderer?.getPercentage() ?? 0;

		// Check if already bookmarked at this CFI
		const existing = this.bookmarks.findIndex((b) => b.cfi === loc.cfi);
		if (existing >= 0) {
			this.bookmarks.splice(existing, 1);
			this.showReaderToast("\u{1F516} Bookmark removed");
		} else {
			this.bookmarks.push({
				cfi: loc.cfi,
				label: `${chapter} (${percent}%)`,
				created: new Date().toISOString(),
			});
			this.showReaderToast("\u{1F516} Bookmark added");
		}

		this.bookmarkPanel?.setBookmarks(this.bookmarks);
		void this.saveBookmarks();
	}

	private async saveBookmarks(): Promise<void> {
		if (!this.file) return;
		if (this.plugin.settings.progressStorage !== "frontmatter") return;

		const companionPath = this.plugin.progressStore
			.getCompanionNotePath(this.file.path) + ".md";
		const file = this.app.vault.getAbstractFileByPath(companionPath);
		if (!(file instanceof TFile)) return;

		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm["epub-bookmarks"] = this.bookmarks.map((b) => ({
				cfi: b.cfi,
				label: b.label,
				created: b.created,
			}));
		});
	}

	private loadBookmarks(): void {
		if (!this.file) return;
		if (this.plugin.settings.progressStorage !== "frontmatter") return;

		const companionPath = this.plugin.progressStore
			.getCompanionNotePath(this.file.path) + ".md";
		const file = this.app.vault.getAbstractFileByPath(companionPath);
		if (!(file instanceof TFile)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) return;

		const saved = fm["epub-bookmarks"] as
			| Array<{ cfi: string; label: string; created: string }>
			| undefined;
		if (saved && Array.isArray(saved)) {
			this.bookmarks = saved;
		}
	}

	private showFootnotePopup(content: string, event: MouseEvent): void {
		// Remove any existing popup
		const existing = this.contentEl.querySelector(".epub-plus-footnote-popup");
		if (existing) existing.remove();

		const popup = this.contentEl.createDiv({ cls: "epub-plus-footnote-popup" });

		// Position near the click
		const containerRect = this.contentEl.getBoundingClientRect();
		const renditionRect = this.renditionEl?.getBoundingClientRect();
		const x = event.clientX + (renditionRect?.left ?? 0) - containerRect.left;
		const y = event.clientY + (renditionRect?.top ?? 0) - containerRect.top;

		popup.setCssProps({
			"position": "absolute",
			"left": `${Math.max(20, Math.min(x - 150, containerRect.width - 320))}px`,
			"top": `${Math.max(20, y - 10)}px`,
			"z-index": "20",
		});

		const body = popup.createDiv({ cls: "epub-plus-footnote-body" });
		body.appendChild(sanitizeHTMLToDom(content));

		// Dismiss on click outside
		const dismiss = (e: Event) => {
			if (!popup.contains(e.target as Node)) {
				popup.remove();
				document.removeEventListener("mousedown", dismiss);
			}
		};
		this.registerDismissHandler("mousedown", dismiss, 100);
	}

	private lastTimeEstimate = "";
	private lastTimeEstimatePct = -1;

	private estimateReadingTime(currentPercent: number): string | null {
		if (currentPercent >= 99.5) return null;
		// Only recalculate when percentage changes by 1+
		const bucket = Math.floor(currentPercent);
		if (bucket === this.lastTimeEstimatePct) return this.lastTimeEstimate || null;
		this.lastTimeEstimatePct = bucket;

		const remaining = (100 - currentPercent) / 100;
		const totalMinutes = 240;
		const minutesLeft = Math.round(remaining * totalMinutes);

		let result: string;
		if (minutesLeft < 1) result = "< 1 min left";
		else if (minutesLeft < 60) result = `~${minutesLeft} min left`;
		else {
			const hours = Math.floor(minutesLeft / 60);
			const mins = minutesLeft % 60;
			result = mins === 0 ? `~${hours}h left` : `~${hours}h ${mins}m left`;
		}
		this.lastTimeEstimate = result;
		return result;
	}

	/**
	 * Register a document-level event listener with automatic cleanup on unload.
	 */
	private registerDismissHandler(
		event: string,
		handler: (e: Event) => void,
		delay = 50,
	): void {
		// On mobile, also bind touchstart for faster dismiss
		const events = Platform.isMobile && (event === "mousedown" || event === "click")
			? [event, "touchstart"]
			: [event];

		const wrappedCleanup = () => {
			for (const ev of events) {
				document.removeEventListener(ev, handler as EventListener);
			}
			const idx = this.activeDismissHandlers.indexOf(wrappedCleanup);
			if (idx >= 0) this.activeDismissHandlers.splice(idx, 1);
		};
		this.activeDismissHandlers.push(wrappedCleanup);
		setTimeout(() => {
			for (const ev of events) {
				document.addEventListener(ev, handler as EventListener);
			}
		}, delay);
	}

	private setupSwipeNavigation(el: HTMLElement): void {
		let startX = 0;
		let startY = 0;
		let startTime = 0;

		el.addEventListener("touchstart", (e) => {
			if (e.touches.length !== 1) return;
			startX = e.touches[0]!.clientX;
			startY = e.touches[0]!.clientY;
			startTime = Date.now();
		}, { passive: true });

		el.addEventListener("touchend", (e) => {
			if (e.changedTouches.length !== 1) return;
			const dx = e.changedTouches[0]!.clientX - startX;
			const dy = e.changedTouches[0]!.clientY - startY;
			const dt = Date.now() - startTime;
			// Horizontal, fast enough, far enough
			if (Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx) && dt < 500) {
				if (dx < 0) this.nextPage();
				else this.prevPage();
			}
		}, { passive: true });
	}

	private showReaderToast(message: string): void {
		const existing = this.contentEl.querySelector(".epub-plus-toast");
		if (existing) existing.remove();

		const toast = this.contentEl.createDiv({ cls: "epub-plus-toast" });
		toast.textContent = message;
		setTimeout(() => toast.addClass("epub-plus-toast-visible"), 10);
		setTimeout(() => {
			toast.removeClass("epub-plus-toast-visible");
			setTimeout(() => toast.remove(), 300);
		}, 1500);
	}

	private isTyping(e: KeyboardEvent): boolean {
		const tag = (e.target as HTMLElement)?.tagName;
		return tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable === true;
	}

	private nextPage(): void {
		this.suppressHistoryPush = true;
		void this.renderer?.next();
	}

	private prevPage(): void {
		this.suppressHistoryPush = true;
		void this.renderer?.prev();
	}

	private goBack(): void {
		const cfi = this.navHistory.pop();
		if (!cfi) return;
		this.suppressHistoryPush = true;
		void this.renderer?.display(cfi);
		if (this.navHistory.length === 0) {
			this.toolbar?.showBackButton(false);
		}
	}

	private jumpToPercentage(pct: number): void {
		if (!this.renderer?.areLocationsReady()) return;
		const cfi = this.renderer.cfiFromPercentage(Math.max(0, Math.min(1, pct)));
		if (cfi) {
			this.suppressHistoryPush = true;
			void this.renderer.display(cfi);
		}
	}

	private changeFontSize(delta: number): void {
		const current = this.plugin.settings.fontSize ?? 18;
		this.plugin.settings.fontSize = Math.max(
			10,
			Math.min(32, current + delta),
		);
		this.renderer?.updateSettings(this.plugin.settings);
		void this.plugin.saveSettings();
	}

	/**
	 * Get the Document of the currently rendered EPUB section (iframe).
	 */
	private getContentDocument(): Document | undefined {
		try {
			const contents = this.renderer?.getRendition()?.getContents() ?? [];
			return contents[0]?.document;
		} catch {
			return undefined;
		}
	}

	private linkCompanionNote(): void {
		if (!this.file) return;
		const modal = new LinkNoteModal(this.app, this.file.path, (notePath) => {
			if (!this.file) return;
			// Tell the frontmatter store to use this note
			this.plugin.progressStore.setCompanionNote(this.file.path, notePath);
			// Save current progress to the new companion note
			const current = this.plugin.progressStore.get(this.file.path);
			if (current) {
				this.plugin.progressStore.set(this.file.path, current);
			}
			new Notice(`Linked to ${notePath}.md`);
		});
		modal.open();
	}

	private async getSavedCfi(file: TFile): Promise<string | null> {
		const progress = await this.plugin.progressStore.getAsync(file.path);
		console.debug("[EPUB++] getSavedCfi:", file.path, "→", progress?.cfi ?? "none", progress?.percent ?? 0, "%");
		return progress?.cfi ?? null;
	}
}

class LinkNoteModal extends Modal {
	private result = "";

	constructor(
		app: import("obsidian").App,
		private epubPath: string,
		private onSubmit: (notePath: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Link companion note" });
		contentEl.createEl("p", {
			text: "Paste an Obsidian URL or enter the note path. Reading progress will be stored in this note's frontmatter.",
			cls: "setting-item-description",
		});

		new Setting(contentEl)
			.setName("Note path or URL")
			.addText((text) => {
				text.setPlaceholder(
					this.epubPath.replace(/\.epub$/i, ""),
				);
				text.inputEl.addClass("epub-plus-modal-input");
				text.onChange((value) => {
					this.result = value;
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Link")
					.setCta()
					.onClick(() => {
						const notePath = this.resolveNotePath(this.result);
						if (notePath) {
							this.onSubmit(notePath);
							this.close();
						} else {
							new Notice("Invalid note path or URL");
						}
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private resolveNotePath(input: string): string | null {
		if (!input.trim()) {
			// Default: companion note with same name
			return this.epubPath.replace(/\.epub$/i, "");
		}

		// Handle obsidian:// URLs
		if (input.startsWith("obsidian://")) {
			try {
				const url = new URL(input);
				const filePath = url.searchParams.get("file");
				if (filePath) {
					return decodeURIComponent(filePath);
				}
			} catch {
				// Not a valid URL
			}
		}

		// Strip .md extension if provided (we'll add it)
		const clean = input.replace(/\.md$/, "");
		return clean;
	}
}

