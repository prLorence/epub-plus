import { FileView, TFile, WorkspaceLeaf, Scope, Notice } from "obsidian";
import type { EventRef } from "obsidian";
import type { Location, Contents } from "epubjs";
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
import { HoverSyncBridge } from "../backlinks/hover-sync";
import {
	showHighlightPopover,
	navigateToBacklink,
} from "../backlinks/hover-popover";
import { showColorPalettePopup } from "./color-palette";
import type { PaletteColor } from "../types";
import type EpubPlusPlugin from "../main";

export class EpubView extends FileView {
	private plugin: EpubPlusPlugin;
	private renderer: EpubRenderer | null = null;
	private tocPanel: TocPanel | null = null;
	private toolbar: ReaderToolbar | null = null;
	private highlightManager: HighlightManager | null = null;
	private backlinkPanel: BacklinkPanel | null = null;
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
	private pageInfoEl: HTMLElement | null = null;
	private pendingSelection: {
		cfiRange: string;
		text: string;
		contents: Contents;
	} | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: EpubPlusPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true;

		this.scope = new Scope(this.app.scope);
		this.scope.register([], "ArrowRight", () => {
			void this.renderer?.next();
			return false;
		});
		this.scope.register([], "ArrowLeft", () => {
			void this.renderer?.prev();
			return false;
		});
		this.scope.register([], " ", () => {
			void this.renderer?.next();
			return false;
		});
		this.scope.register(["Shift"], " ", () => {
			void this.renderer?.prev();
			return false;
		});
		this.scope.register([], "Escape", () => {
			this.pendingSelection = null;
			// Don't consume the event — let Obsidian handle Escape too
			return true;
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
					this.pendingSelection.contents,
				);
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

	getDisplayText(): string {
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
				onRelocated: (location: Location) =>
					this.handleRelocated(location),
				onSelected: (cfiRange: string, contents: Contents) =>
					this.handleSelected(cfiRange, contents),
				onRendered: () => this.handleRendered(),
				onFocused: () => {
					this.app.workspace.setActiveLeaf(this.leaf, {
						focus: false,
					});
				},
			},
		);

		await this.renderer.open(data);

		// TOC panel — some EPUBs have missing/broken TOC files
		let toc: import("epubjs").NavItem[] = [];
		try {
			toc = await this.renderer.getTocAsync();
		} catch {
			console.debug("[EPUB++] TOC loading failed, using empty TOC");
		}
		this.tocPanel = new TocPanel(
			this.containerEl_!.querySelector(".epub-plus-toc-panel")!,
			toc,
			(href) => void this.renderer?.display(href),
		);
		if (this.plugin.settings.showTocOnOpen) {
			this.tocPanel.show();
		}

		// Toolbar
		this.toolbar = new ReaderToolbar(
			this.containerEl_!.querySelector(".epub-plus-toolbar")!,
			{
				onPrev: () => void this.renderer?.prev(),
				onNext: () => void this.renderer?.next(),
				onTocToggle: () => this.tocPanel?.toggle(),
				onBacklinksToggle: () => this.backlinkPanel?.toggle(),
				onFontSizeChange: (delta) => this.changeFontSize(delta),
			},
		);

		// Display at saved position or pending CFI
		const startCfi = this.pendingCfi ?? this.getSavedCfi(file);
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
		if (this.plugin.settings.enableVimBindings && this.renderer) {
			this.vimBindings = new VimBindings(this.scope!, this.renderer);
		}

		// Phase 2: Backlink highlighting
		this.setupBacklinkHighlighting(file);
	}

	async onUnloadFile(file: TFile): Promise<void> {
		await this.plugin.progressStore.save();
		this.teardownBacklinks();
		this.narrowObserver?.disconnect();
		this.narrowObserver = null;
		this.renderer?.destroy();
		this.renderer = null;
		this.tocPanel = null;
		this.toolbar = null;
		this.progressFillEl = null;
		this.pageInfoEl = null;
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
		const bottomBar = readerArea.createDiv({ cls: "epub-plus-bottom-bar" });
		this.progressFillEl = bottomBar.createDiv({ cls: "epub-plus-progress-fill" });
		this.pageInfoEl = bottomBar.createDiv({ cls: "epub-plus-page-info" });

		this.containerEl_.createDiv({ cls: "epub-plus-backlink-panel" });

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
			},
		);

		// Backlink panel
		const panelEl = this.containerEl_?.querySelector(
			".epub-plus-backlink-panel",
		) as HTMLElement | null;
		if (panelEl) {
			this.backlinkPanel = new BacklinkPanel(this.app, panelEl, {
				onEntryHover: (bl) =>
					this.hoverSync?.onPanelEntryHover(bl),
				onEntryClick: (bl) => {
					// Navigate EPUB to the highlight position
					void this.renderer?.display(bl.cfiStart);
				},
			});
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
			this.renderer,
			settings.hoverSyncMode,
		);

		// Initial scan
		const backlinks = scanBacklinksForEpub(
			this.app,
			file.path,
			settings.defaultHighlightColor,
		);
		this.highlightManager.applyBacklinks(backlinks);
		this.backlinkPanel?.setBacklinks(backlinks);

		// Watch for changes
		this.backlinkWatchRefs = watchBacklinks(
			this.app,
			file.path,
			settings.defaultHighlightColor,
			(updatedBacklinks) => {
				this.highlightManager?.applyBacklinks(updatedBacklinks);
				this.backlinkPanel?.setBacklinks(updatedBacklinks);
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
		} else if (this.plugin.settings.hoverAction === "preview") {
			showHighlightPopover(this.app, backlinks, event, this.leaf);
		}
	}

	private handleHighlightHover(
		backlinks: import("../types").EpubBacklink[] | null,
		_event: MouseEvent,
	): void {
		this.hoverSync?.onHighlightHover(backlinks);
	}

	// ── Event Handlers ──

	private handleRendered(): void {
		// EPUB.js annotations API auto-injects highlights on page turns.
		// No manual re-attach needed — kept as a hook for future use.
	}

	private handleRelocated(location: Location): void {
		const locationsReady =
			this.renderer?.areLocationsReady() ?? false;
		const bookPercent = locationsReady
			? this.renderer!.getPercentage()
			: 0;

		const chapterName = this.renderer?.getCurrentChapterTitle() ?? "";

		if (this.toolbar) {
			this.toolbar.updateProgress(bookPercent);
			this.toolbar.updateChapter(chapterName);
		}

		// Update progress bar (book-level)
		if (this.progressFillEl) {
			this.progressFillEl.setCssProps({
				"--progress": `${String(bookPercent)}%`,
			});
		}

		// Update page counter (chapter-level pages)
		if (this.pageInfoEl) {
			const displayed = location.start.displayed;
			if (displayed) {
				this.pageInfoEl.textContent =
					`${String(displayed.page)}/${String(displayed.total)}`;
			}
		}

		if (this.tocPanel) {
			const contentDoc = this.getContentDocument();
			this.tocPanel.setActiveHref(location.start.href, contentDoc);
		}

		// Update backlink panel chapter filter
		this.backlinkPanel?.setCurrentChapter(
			location.start.href,
			chapterName,
		);

		// Save reading progress — skip until locations are generated
		// to avoid overwriting accurate saved data with 0%
		const autoSave = this.plugin.settings.autoSaveProgress ?? true;
		if (
			this.file &&
			autoSave &&
			locationsReady &&
			location.start.cfi
		) {
			this.plugin.progressStore.set(this.file.path, {
				cfi: location.start.cfi,
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
					location.start.cfi,
				);
				this.plugin.progressStore.scheduleSave();
			}
		}
	}

	private handleSelected(cfiRange: string, contents: Contents): void {
		const selection = contents.window.getSelection();
		const text = selection?.toString() ?? "";
		if (!text || !this.file) return;

		// Store for keyboard shortcut (1-7 keys)
		this.pendingSelection = { cfiRange, text, contents };

		this.showSelectionPopup(contents, cfiRange, text);
	}

	private showSelectionPopup(
		contents: Contents,
		cfiRange: string,
		text: string,
	): void {
		const doc = contents.document;
		const selection = contents.window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();
		const palette = this.plugin.settings.colorPalette;

		showColorPalettePopup(doc, rect, palette, {
			onColorSelect: (color: PaletteColor) => {
				this.createHighlightAnnotation(cfiRange, color, contents);
				void this.copyWithColor(cfiRange, text, color.name);
			},
			onAddToNote: (color: PaletteColor) => {
				this.createHighlightAnnotation(cfiRange, color, contents);
				void this.addToActiveNote(cfiRange, text, color.name);
			},
		});
	}

	/**
	 * Create a persistent highlight annotation in the EPUB viewer
	 * and clear the text selection (following the epub.js reference pattern).
	 */
	private createHighlightAnnotation(
		cfiRange: string,
		color: PaletteColor,
		contents: Contents,
	): void {
		const rendition = this.renderer?.getRendition();
		if (!rendition) return;

		try {
			rendition.annotations.highlight(
				cfiRange,
				{},
				() => {
					// highlight clicked
				},
				"epubjs-hl",
				{
					fill: color.hex,
					"fill-opacity": String(
						this.plugin.settings.highlightOpacity,
					),
					"mix-blend-mode": "multiply",
				},
			);
		} catch {
			// ignore CFI resolution errors
		}

		// Clear the text selection
		contents.window.getSelection()?.removeAllRanges();
	}

	private async copyWithColor(
		cfiRange: string,
		text: string,
		color: string,
	): Promise<void> {
		const ctx = await this.buildLinkContext(cfiRange, text, color);
		await copyLinkToSelection(ctx);
		new Notice("Link copied to clipboard");
	}

	private async addToActiveNote(
		cfiRange: string,
		text: string,
		color: string,
	): Promise<void> {
		const ctx = await this.buildLinkContext(cfiRange, text, color);
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

	private async buildLinkContext(
		cfiRange: string,
		text: string,
		color: string,
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
		};
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
			const contents = this.renderer?.getRendition()?.getContents();
			const list = Array.isArray(contents) ? contents : [contents];
			const first = list[0] as { document?: Document } | undefined;
			return first?.document;
		} catch {
			return undefined;
		}
	}

	private getSavedCfi(file: TFile): string | null {
		const progress = this.plugin.progressStore.get(file.path);
		console.debug("[EPUB++] getSavedCfi:", file.path, "→", progress?.cfi ?? "none", progress?.percent ?? 0, "%");
		return progress?.cfi ?? null;
	}
}
