import { FileView, TFile, WorkspaceLeaf, Scope, Notice } from "obsidian";
import type { Location, Contents } from "epubjs";
import { EPUB_VIEW_TYPE } from "../constants";
import { EpubRenderer } from "./epub-renderer";
import { TocPanel } from "./toc-panel";
import { ReaderToolbar } from "./reader-toolbar";
import { parseEpubSubpath } from "../links/epub-link-parser";
import { copyLinkToSelection } from "../links/link-copy";
import type EpubPlusPlugin from "../main";

export class EpubView extends FileView {
	private plugin: EpubPlusPlugin;
	private renderer: EpubRenderer | null = null;
	private tocPanel: TocPanel | null = null;
	private toolbar: ReaderToolbar | null = null;
	private pendingCfi: string | null = null;
	private containerEl_: HTMLElement | null = null;
	private renditionEl: HTMLElement | null = null;

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
		// If another leaf already has this file open, redirect there instead
		const existingLeaf = this.plugin.findExistingEpubLeaf(
			file.path,
			this.leaf,
		);
		if (existingLeaf) {
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
			if (this.pendingCfi) {
				existingLeaf.view.setEphemeralState({
					subpath: `#cfi=${this.pendingCfi}`,
				});
				this.pendingCfi = null;
			}
			// Navigate this leaf back (undo the file open)
			void this.leaf.setViewState({
				type: "empty",
				state: {},
			});
			void this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		this.buildDom();

		const data = await this.app.vault.readBinary(file);

		this.renderer = new EpubRenderer(
			this.renditionEl!,
			this.plugin.settings,
			{
				onRelocated: (location: Location) =>
					this.handleRelocated(location),
				onSelected: (cfiRange: string, contents: Contents) =>
					this.handleSelected(cfiRange, contents),
			},
		);

		await this.renderer.open(data);

		// Set up TOC
		this.tocPanel = new TocPanel(
			this.containerEl_!.querySelector(".epub-plus-toc-panel")!,
			this.renderer.getToc(),
			(href) => void this.renderer?.display(href),
		);

		if (this.plugin.settings.showTocOnOpen) {
			this.tocPanel.show();
		}

		// Set up toolbar
		this.toolbar = new ReaderToolbar(
			this.containerEl_!.querySelector(".epub-plus-toolbar")!,
			{
				onPrev: () => void this.renderer?.prev(),
				onNext: () => void this.renderer?.next(),
				onTocToggle: () => this.tocPanel?.toggle(),
				onFontSizeChange: (delta) => this.changeFontSize(delta),
			},
		);

		// Display at saved position or pending CFI
		const startCfi = this.pendingCfi ?? this.getSavedCfi(file);
		this.pendingCfi = null;
		await this.renderer.display(startCfi ?? undefined);
	}

	async onUnloadFile(file: TFile): Promise<void> {
		this.saveProgress();
		this.renderer?.destroy();
		this.renderer = null;
		this.tocPanel = null;
		this.toolbar = null;
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

		this.containerEl_ = contentEl.createDiv({ cls: "epub-plus-container" });
		this.containerEl_.createDiv({ cls: "epub-plus-toc-panel" });

		const readerArea = this.containerEl_.createDiv({
			cls: "epub-plus-reader-area",
		});
		readerArea.createDiv({ cls: "epub-plus-toolbar" });
		this.renditionEl = readerArea.createDiv({
			cls: "epub-plus-rendition",
		});
		readerArea.createDiv({ cls: "epub-plus-bottom-bar" });
	}

	private handleRelocated(location: Location): void {
		if (this.toolbar && this.renderer) {
			this.toolbar.updateProgress(this.renderer.getPercentage());
			this.toolbar.updateChapter(this.renderer.getCurrentChapterTitle());
		}

		if (this.tocPanel) {
			this.tocPanel.setActiveHref(location.start.href);
		}

		if (this.file && this.plugin.settings.autoSaveProgress) {
			this.plugin.progressStore.set(this.file.path, {
				cfi: location.start.cfi,
				percent: Math.round((location.start.percentage ?? 0) * 100),
				updated: new Date().toISOString(),
			});
			this.plugin.progressStore.scheduleSave();
		}
	}

	private handleSelected(cfiRange: string, contents: Contents): void {
		const selection = contents.window.getSelection();
		const text = selection?.toString() ?? "";
		if (!text || !this.file) return;

		this.showSelectionPopup(contents, cfiRange, text);
	}

	private showSelectionPopup(
		contents: Contents,
		cfiRange: string,
		text: string,
	): void {
		const doc = contents.document;
		const existing = doc.querySelector(".epub-plus-selection-popup");
		if (existing) existing.remove();

		const selection = contents.window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();

		const popup = doc.createElement("div");
		popup.className = "epub-plus-selection-popup";
		popup.setAttribute(
			"style",
			`position:absolute;left:${rect.left + rect.width / 2}px;top:${rect.top - 36}px;` +
				"transform:translateX(-50%);z-index:9999;background:#333;color:#fff;" +
				"padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;" +
				"box-shadow:0 2px 8px rgba(0,0,0,0.3);white-space:nowrap;",
		);
		popup.textContent = "Copy link";

		popup.addEventListener("click", () => {
			void copyLinkToSelection(
				this.file!,
				cfiRange,
				text,
				this.renderer?.getCurrentChapterTitle() ?? "",
				this.plugin.settings.defaultHighlightColor,
				this.plugin.settings.copyTemplate,
			).then(() => {
				popup.remove();
				new Notice("Link copied to clipboard");
			});
		});

		const removePopup = () => {
			popup.remove();
			doc.removeEventListener("click", removePopup);
		};
		setTimeout(() => doc.addEventListener("click", removePopup), 100);

		doc.body.appendChild(popup);
	}

	private changeFontSize(delta: number): void {
		this.plugin.settings.fontSize = Math.max(
			10,
			Math.min(32, this.plugin.settings.fontSize + delta),
		);
		this.renderer?.updateSettings(this.plugin.settings);
		void this.plugin.saveSettings();
	}

	private getSavedCfi(file: TFile): string | null {
		const progress = this.plugin.progressStore.get(file.path);
		return progress?.cfi ?? null;
	}

	private saveProgress(): void {
		if (!this.plugin.settings.autoSaveProgress) return;
		void this.plugin.progressStore.save();
	}
}
