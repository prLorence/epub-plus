import type { EpubPlusSettings } from "../settings";
import { Platform } from "obsidian";
import type {
	IBookEngine,
	IRendition,
	TocItem,
	ReaderLocation,
	SelectionInfo,
} from "../engine/types";
import { createEngine } from "../engine/engine-factory";
import { getBundledFontCss } from "../fonts/bundled-fonts";
import type { EngineType } from "../engine/engine-factory";

export interface EpubRendererCallbacks {
	onRelocated: (location: ReaderLocation) => void;
	onSelected: (cfiRange: string, selection: SelectionInfo) => void;
	onRendered?: () => void;
	onFocused?: () => void;
	onBeforeResizeNav?: () => void;
	onFootnoteClick?: (content: string, event: MouseEvent) => void;
}

export class EpubRenderer {
	private engine: IBookEngine | null = null;
	private rendition: IRendition | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;
	private cachedMetadata: { title: string; author: string } | null = null;
	private cachedToc: TocItem[] | null = null;
	private lastStyleHash = "";
	private lastResizeWidth = 0;
	private lastResizeHeight = 0;
	private lastHref = "";
	private pendingRestoreCfi: string | null = null;
	private stylesInjected = false;

	constructor(
		private containerEl: HTMLElement,
		private settings: EpubPlusSettings,
		private callbacks: EpubRendererCallbacks,
	) {}

	async open(data: ArrayBuffer): Promise<void> {
		console.debug("[EPUB++] Renderer.open: starting, data size:", data.byteLength);
		const engineType = (this.settings as { engineType?: EngineType }).engineType ?? "epubjs";
		this.engine = createEngine(engineType);
		await this.engine.open(data);
		console.debug("[EPUB++] Renderer.open: book opened");

		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		let { width, height } = this.getContainerSize();
		console.debug("[EPUB++] Renderer.open: container size:", width, "x", height);
		if (width === 0 || height === 0) {
			width = 800;
			height = 600;
		}

		this.rendition = this.engine.renderTo(this.containerEl, {
			width,
			height,
			spread: "none",
			flow: this.settings.readingMode === "paginated" ? "paginated" : "scrolled",
		});
		console.debug("[EPUB++] Renderer.open: rendition created");

		this.applyTheme();
		this.applyFontSettings();

		this.rendition.on("relocated", (location: ReaderLocation) => {
			this.callbacks.onRelocated(location);
		});

		this.rendition.on("selected", (cfiRange: string, selection: SelectionInfo) => {
			this.callbacks.onSelected(cfiRange, selection);
		});

		this.rendition.on("rendered", () => {
			this.callbacks.onRendered?.();
		});

		this.rendition.on("keydown", (e: KeyboardEvent) => {
			this.callbacks.onFocused?.();
			document.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: e.key,
					code: e.code,
					ctrlKey: e.ctrlKey,
					metaKey: e.metaKey,
					shiftKey: e.shiftKey,
					altKey: e.altKey,
				}),
			);
		});

		this.rendition.on("click", () => {
			this.callbacks.onFocused?.();
		});

		let lastObservedWidth = this.containerEl.clientWidth;
		this.resizeObserver = new ResizeObserver(() => {
			const newWidth = this.containerEl.clientWidth;
			// On mobile, ignore height-only changes (keyboard open/close)
			if (Platform.isMobile && newWidth === lastObservedWidth) return;
			lastObservedWidth = newWidth;

			if (this.resizeTimer) clearTimeout(this.resizeTimer);
			this.resizeTimer = setTimeout(() => {
				this.resizeTimer = null;
				this.handleResize();
			}, 150);
		});
		this.resizeObserver.observe(this.containerEl);
	}

	async display(target?: string): Promise<void> {
		if (!this.rendition) {
			console.warn("[EPUB++] display: no rendition");
			return;
		}
		console.debug("[EPUB++] display:", target ?? "(beginning)");
		try {
			await this.rendition.display(target);
			console.debug("[EPUB++] display: success");
		} catch (e) {
			console.error("[EPUB++] display: failed", e);
			throw e;
		}

		if (!this.rendition.areLocationsReady()) {
			void this.rendition.generateLocations(1024).catch(() => {
				// Some EPUBs have broken spine that prevents location generation
			});
		}
	}

	async next(): Promise<void> {
		await this.rendition?.next();
	}

	async prev(): Promise<void> {
		await this.rendition?.prev();
	}

	async getTocAsync(): Promise<TocItem[]> {
		if (this.cachedToc) return this.cachedToc;
		if (!this.engine) return [];
		try {
			this.cachedToc = await this.engine.getToc();
			return this.cachedToc;
		} catch {
			return [];
		}
	}

	getRendition(): IRendition | null {
		return this.rendition;
	}

	getEngine(): IBookEngine | null {
		return this.engine;
	}

	getCachedToc(): TocItem[] {
		return this.cachedToc ?? [];
	}

	getCurrentHref(): string | null {
		return this.rendition?.getCurrentLocation()?.href ?? null;
	}

	async getBookTitle(): Promise<string> {
		return (await this.getMetadataCached()).title;
	}

	async getBookAuthor(): Promise<string> {
		return (await this.getMetadataCached()).author;
	}

	getCurrentChapterTitle(): string {
		const loc = this.rendition?.getCurrentLocation();
		if (!loc || !this.cachedToc) return "";
		return findChapterByHref(this.cachedToc, loc.href)?.label ?? "";
	}

	async getSelectedText(cfiRange: string): Promise<string> {
		if (!this.engine) return "";
		try {
			const range = await this.engine.getRange(cfiRange);
			return range?.toString() ?? "";
		} catch {
			return "";
		}
	}

	getPercentage(): number {
		const loc = this.rendition?.getCurrentLocation();
		if (!loc || !this.rendition?.areLocationsReady()) return 0;

		const pct = this.rendition.percentageFromCfi(loc.cfi);
		if (pct != null) {
			return Math.round(pct * 1000) / 10;
		}

		return Math.round((loc.percentage ?? 0) * 1000) / 10;
	}

	areLocationsReady(): boolean {
		return this.rendition?.areLocationsReady() ?? false;
	}

	async waitForLocations(): Promise<void> {
		if (!this.rendition) return;
		if (this.rendition.areLocationsReady()) return;
		await this.rendition.generateLocations(1024).catch(() => {});
	}

	cfiFromPercentage(percentage: number): string | null {
		return this.rendition?.cfiFromPercentage(percentage) ?? null;
	}

	getLastHref(): string {
		return this.lastHref;
	}

	setLastHref(href: string): void {
		this.lastHref = href;
	}

	applyTheme(): void {
		if (!this.rendition) return;
		this.rendition.setTheme(this.resolveTheme());
	}

	applyFontSettings(): void {
		if (!this.rendition || this.stylesInjected) return;
		this.stylesInjected = true;
		this.rendition.injectStylesheet(this.buildUserCss(), "epub-plus-user-styles");

		// Set up footnote interception on each rendered section
		if (this.callbacks.onFootnoteClick && this.engine) {
			this.setupFootnoteInterception();
		}
	}

	private setupFootnoteInterception(): void {
		if (!this.rendition) return;

		// Register a content hook that intercepts footnote link clicks
		this.rendition.on("rendered", () => {
			const contents = this.rendition?.getContents() ?? [];
			for (const content of contents) {
				this.interceptFootnoteLinks(content.document);
			}
		});

		// Also run on already-rendered content
		const contents = this.rendition.getContents();
		for (const content of contents) {
			this.interceptFootnoteLinks(content.document);
		}
	}

	private static readonly RE_FOOTNOTE_CLASS = /\bfootnote\b|\bendnote\b|\bnoteref\b/i;
	private static readonly RE_FOOTNOTE_TEXT = /^\[\d+\]$|^\d+$/;

	private interceptFootnoteLinks(doc: Document): void {
		if (!doc) return;
		// Skip if this document was already fully processed
		if ((doc as unknown as { _fnProcessed?: boolean })._fnProcessed) return;
		(doc as unknown as { _fnProcessed?: boolean })._fnProcessed = true;

		const links = doc.querySelectorAll("a[href]");
		for (let i = 0; i < links.length; i++) {
			const link = links[i] as HTMLAnchorElement;
			if (link.dataset["fnBound"]) continue;
			link.dataset["fnBound"] = "1";

			const isFootnote =
				link.getAttribute("epub:type")?.includes("noteref") ||
				link.getAttribute("role") === "doc-noteref" ||
				EpubRenderer.RE_FOOTNOTE_CLASS.test(link.className) ||
				EpubRenderer.RE_FOOTNOTE_TEXT.test(link.textContent?.trim() ?? "");

			if (!isFootnote) continue;

			link.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				void this.loadFootnoteContent(link.getAttribute("href") ?? "")
					.then((content) => {
						if (content && this.callbacks.onFootnoteClick) {
							this.callbacks.onFootnoteClick(content, e);
						}
					});
			});
		}
	}

	private async loadFootnoteContent(href: string): Promise<string | null> {
		if (!this.engine || !href) return null;

		try {
			const hashIdx = href.indexOf("#");
			const targetId = hashIdx >= 0 ? href.slice(hashIdx + 1) : "";
			const targetFile = hashIdx > 0 ? href.slice(0, hashIdx) : "";

			if (!targetId) return null;

			// Try current section first
			const contents = this.rendition?.getContents() ?? [];
			for (const content of contents) {
				const el = content.document.getElementById(targetId);
				if (el) {
					return el.innerHTML;
				}
			}

			// Cross-section: fetch the target file from the EPUB archive
			if (targetFile) {
				return await this.loadFootnoteFromArchive(targetFile, targetId);
			}

			return null;
		} catch {
			return null;
		}
	}

	private async loadFootnoteFromArchive(
		fileHref: string,
		targetId: string,
	): Promise<string | null> {
		if (!this.engine) return null;

		const archive = this.engine.getArchive();
		if (!archive) return null;

		// Resolve relative to the current section's directory
		const currentDir = this.lastHref.split("/").slice(0, -1).join("/");
		const candidates = [
			fileHref,
			currentDir ? `${currentDir}/${fileHref}` : fileHref,
			fileHref.replace(/^\.\//, currentDir ? `${currentDir}/` : ""),
		];

		for (const href of candidates) {
			try {
				const xhtml = await archive.request(href, "text");
				if (!xhtml || typeof xhtml !== "string") continue;

				const parser = new DOMParser();
				const doc = parser.parseFromString(xhtml, "application/xhtml+xml");
				const el = doc.getElementById(targetId);
				if (el) return el.innerHTML;
			} catch {
				continue;
			}
		}

		return null;
	}

	updateSettings(settings: EpubPlusSettings): void {
		const styleHash = this.computeStyleHash(settings);
		const styleChanged = styleHash !== this.lastStyleHash;

		const layoutChanged =
			settings.maxContentWidth !== this.settings.maxContentWidth
			|| settings.marginSize !== this.settings.marginSize;

		this.settings = settings;

		if (styleChanged) {
			this.applyTheme();
			this.lastStyleHash = styleHash;
			// Re-inject styles into currently rendered contents
			const contents = this.rendition?.getContents() ?? [];
			const css = this.buildUserCss();
			for (const c of contents) {
				try {
					const existing = c.document.getElementById("epub-plus-user-styles");
					if (existing) {
						existing.textContent = css;
					}
				} catch {
					// ignore
				}
			}
		}

		if (layoutChanged) {
			this.lastResizeWidth = 0;
			this.lastResizeHeight = 0;
			this.handleResize();
		}
	}

	destroy(): void {
		if (this.resizeTimer) clearTimeout(this.resizeTimer);
		this.resizeTimer = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.rendition?.destroy();
		this.engine?.destroy();
		this.rendition = null;
		this.engine = null;
	}

	forceResize(): void {
		this.handleResize();
	}

	savePositionForResize(): void {
		this.pendingRestoreCfi = this.rendition?.getCurrentLocation()?.cfi ?? null;
	}

	// ── Private ──

	private async getMetadataCached(): Promise<{ title: string; author: string }> {
		if (this.cachedMetadata) return this.cachedMetadata;
		if (!this.engine) return { title: "", author: "" };
		const meta = await this.engine.getMetadata();
		this.cachedMetadata = { title: meta.title, author: meta.author };
		return this.cachedMetadata;
	}

	private buildUserCss(): string {
		const fontSize = this.settings.fontSize ?? 18;
		const lineHeight = this.settings.lineHeight ?? 1.6;
		const fontFamily = this.settings.fontFamily;
		const fontWeight = this.settings.fontWeight ?? 400;
		const headingWeight = this.settings.headingWeight ?? 700;
		const opacity = this.settings.highlightOpacity ?? 0.3;

		// Resolve font: bundled → @font-face + family, otherwise plain CSS
		let fontFaceCss = "";
		let contentFont: string;

		const bundled = getBundledFontCss(fontFamily);
		if (bundled) {
			fontFaceCss = bundled.fontFaceCss;
			contentFont = bundled.fontFamily;
		} else if (fontFamily === "system-serif") {
			contentFont = '"Georgia", "Times New Roman", serif';
		} else if (fontFamily === "system-sans") {
			contentFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
		} else if (fontFamily) {
			contentFont = fontFamily;
		} else {
			// Book default — don't override
			contentFont = "";
		}

		const fontRule = contentFont
			? `font-family: ${contentFont} !important;`
			: "";

		return `
			${fontFaceCss}
			:root {
				font-size: ${fontSize}px !important;
			}
			body {
				${fontRule}
				font-weight: ${fontWeight} !important;
				line-height: ${lineHeight} !important;
				text-align: justify;
				text-rendering: optimizeLegibility;
				-webkit-font-smoothing: antialiased;
				hyphens: auto;
				-webkit-hyphens: auto;
			}
			p, [role="paragraph"] {
				widows: 2;
				orphans: 2;
			}
			a { text-decoration: none; }
			h1, h2, h3, h4, h5, h6 {
				break-before: column;
				break-after: avoid;
				font-weight: ${headingWeight} !important;
				line-height: 1.3;
				margin-block-start: 1.5em;
				margin-block-end: 0.5em;
			}
			h1 { font-size: 1.6em; }
			h2 { font-size: 1.35em; }
			h3 { font-size: 1.15em; }
			h4, h5, h6 { font-size: 1em; }
			img, svg {
				max-width: 100%;
				height: auto;
			}
			.epubjs-hl {
				fill: yellow;
				fill-opacity: ${opacity};
				mix-blend-mode: multiply;
			}
			::selection {
				background: rgba(113, 173, 253, 0.4);
			}
		`;
	}

	private computeStyleHash(settings: EpubPlusSettings): string {
		return `${settings.fontSize}|${settings.lineHeight}|${settings.fontFamily}|${settings.fontWeight}|${settings.headingWeight}|${settings.highlightOpacity}|${settings.theme}|${settings.maxContentWidth}|${settings.marginSize}`;
	}

	private getContainerSize(): { width: number; height: number } {
		const w = this.containerEl.clientWidth;
		const h = this.containerEl.clientHeight;
		const configuredMargin = this.settings.marginSize ?? 40;
		const margin = w < 400 ? Math.min(configuredMargin, 10) * 2
			: w < 600 ? Math.min(configuredMargin, 20) * 2
			: configuredMargin * 2;
		let contentWidth = Math.floor(Math.max(w - margin, 200)) || 600;
		const maxWidth = this.settings.maxContentWidth ?? 0;
		if (maxWidth > 0) {
			contentWidth = Math.min(contentWidth, maxWidth);
		}
		return {
			width: contentWidth,
			height: Math.floor(h) || 400,
		};
	}

	private handleResize(): void {
		try {
			if (!this.rendition) return;
			const { width, height } = this.getContainerSize();
			if (width > 0 && height > 0
				&& (width !== this.lastResizeWidth || height !== this.lastResizeHeight)) {
				const restoreCfi = this.pendingRestoreCfi;
				this.pendingRestoreCfi = null;
				this.lastResizeWidth = width;
				this.lastResizeHeight = height;
				this.callbacks.onBeforeResizeNav?.();
				this.rendition.resize(width, height);
				if (restoreCfi) {
					void this.display(restoreCfi);
				}
			}
		} catch (e) {
			console.debug("[EPUB++] handleResize failed:", e);
		}
	}

	private resolveTheme(): Record<string, Record<string, string>> {
		const setting = this.settings.theme;
		let bg: string;
		let fg: string;
		let isDark = false;

		if (setting === "auto") {
			isDark = document.body.classList.contains("theme-dark");
			// Use Obsidian's actual CSS variables for perfect theme matching
			const computed = getComputedStyle(document.body);
			bg = computed.getPropertyValue("--background-primary").trim() || (isDark ? "#1e1e1e" : "#ffffff");
			fg = computed.getPropertyValue("--text-normal").trim() || (isDark ? "#dcddde" : "#1e1e1e");
		} else if (setting === "dark") {
			isDark = true;
			bg = "#1e1e1e";
			fg = "#dcddde";
		} else if (setting === "sepia") {
			bg = "#f4ecd8";
			fg = "#5b4636";
		} else {
			bg = "#ffffff";
			fg = "#1e1e1e";
		}

		const theme: Record<string, Record<string, string>> = {
			body: { background: bg, color: fg },
			"a:link": { color: "inherit" },
		};

		// Dim images in dark mode to reduce eye strain
		if (isDark) {
			theme["img"] = { filter: "brightness(0.8)" };
			theme["svg"] = { filter: "brightness(0.8)" };
		}

		return theme;
	}
}

function findChapterByHref(
	toc: TocItem[],
	href: string,
): TocItem | undefined {
	for (const item of toc) {
		const itemHref = item.href.split("#")[0] ?? "";
		if (itemHref && (href === itemHref || href.endsWith(itemHref))) {
			return item;
		}
		if (item.children.length > 0) {
			const found = findChapterByHref(item.children, href);
			if (found) return found;
		}
	}
	return undefined;
}
