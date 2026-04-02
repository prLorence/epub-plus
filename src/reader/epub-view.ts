import { FileView, TFile, WorkspaceLeaf, Scope, Notice, Modal, Setting } from "obsidian";
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
	private chapterPageEl: HTMLElement | null = null;
	private bookPercentEl: HTMLElement | null = null;
	/** Navigation history stack for back navigation (stores CFIs). */
	private navHistory: string[] = [];
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
		this.scope.register([], "ArrowRight", () => {
			this.nextPage();
			return false;
		});
		this.scope.register([], "ArrowLeft", () => {
			this.prevPage();
			return false;
		});
		this.scope.register([], " ", () => {
			this.nextPage();
			return false;
		});
		this.scope.register(["Shift"], " ", () => {
			this.prevPage();
			return false;
		});
		this.scope.register([], "Escape", () => {
			this.pendingSelection = null;
			// Don't consume the event — let Obsidian handle Escape too
			return true;
		});

		// Alt+Left arrow to go back after clicking a link
		this.scope.register(["Alt"], "ArrowLeft", () => {
			this.goBack();
			return false;
		});

		// Page Up / Page Down
		this.scope.register([], "PageDown", () => {
			this.nextPage();
			return false;
		});
		this.scope.register([], "PageUp", () => {
			this.prevPage();
			return false;
		});

		// Home / End — go to beginning / end of book
		this.scope.register([], "Home", () => {
			void this.renderer?.display();
			return false;
		});
		this.scope.register([], "End", () => {
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
		if (this.plugin.settings.enableVimBindings && this.renderer) {
			this.vimBindings = new VimBindings(this.scope!, this.renderer, {
				onNext: () => this.nextPage(),
				onPrev: () => this.prevPage(),
			});
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
				this.bookPercentEl.textContent = `${display}%`;
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
		this.showSelectionPopup(selInfo, cfiRange, text);
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

		showColorPalettePopup(doc, rect, palette, {
			onColorSelect: (color: PaletteColor) => {
				this.createHighlightAnnotation(cfiRange, color);
				selInfo.clearSelection();
				void this.copyWithColor(cfiRange, text, color.name);
			},
			onAddToNote: (color: PaletteColor) => {
				this.createHighlightAnnotation(cfiRange, color);
				selInfo.clearSelection();
				void this.addToActiveNote(cfiRange, text, color.name);
			},
		});
	}

	private createHighlightAnnotation(
		cfiRange: string,
		color: PaletteColor,
	): void {
		const rendition = this.renderer?.getRendition();
		if (!rendition) return;

		try {
			rendition.addHighlight(
				cfiRange,
				{},
				color.hex,
				this.plugin.settings.highlightOpacity,
			);
		} catch {
			// ignore CFI resolution errors
		}
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

