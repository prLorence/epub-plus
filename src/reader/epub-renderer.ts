import ePub, { Book, Rendition, Location, NavItem, Contents } from "epubjs";
import type { EpubPlusSettings } from "../settings";

export interface EpubRendererCallbacks {
	onRelocated: (location: Location) => void;
	onSelected: (cfiRange: string, contents: Contents) => void;
	onRendered?: () => void;
}

export class EpubRenderer {
	private book: Book | null = null;
	private rendition: Rendition | null = null;
	private locationsGenerated = false;
	private resizeObserver: ResizeObserver | null = null;
	private contentHookRegistered = false;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private containerEl: HTMLElement,
		private settings: EpubPlusSettings,
		private callbacks: EpubRendererCallbacks,
	) {}

	async open(data: ArrayBuffer): Promise<void> {
		console.debug("[EPUB++] Renderer.open: starting, data size:", data.byteLength);
		this.book = ePub();
		await this.book.open(data, "binary");
		console.debug("[EPUB++] Renderer.open: book opened");

		// Suppress unhandled rejections from optional book resources
		// (e.g., missing TOC files in some EPUBs)
		this.book.loaded.navigation.catch(() => {});
		this.book.loaded.pageList.catch(() => {});

		// Wait for next animation frame to ensure container is laid out
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

		// Use fixed fallback dimensions if container still has no size
		let { width, height } = this.getContainerSize();
		console.debug("[EPUB++] Renderer.open: container size:", width, "x", height,
			"marginSize:", this.settings.marginSize);
		if (width === 0 || height === 0) {
			width = 800;
			height = 600;
			console.debug("[EPUB++] Renderer.open: using fallback size:", width, "x", height);
		}

		this.rendition = this.book.renderTo(this.containerEl, {
			width,
			height,
			spread: "none",
			flow:
				this.settings.readingMode === "paginated"
					? "paginated"
					: "scrolled-doc",
		});
		console.debug("[EPUB++] Renderer.open: rendition created");

		this.applyTheme();
		this.applyFontSettings();

		this.rendition.on("relocated", (location: Location) => {
			this.callbacks.onRelocated(location);
		});

		this.rendition.on("selected", (cfiRange: string, contents: Contents) => {
			this.callbacks.onSelected(cfiRange, contents);
		});

		this.rendition.on("rendered", () => {
			this.callbacks.onRendered?.();
		});

		// Forward keyboard events from the EPUB iframe to the parent document
		// so Obsidian's Scope system can capture them (iframe events don't bubble up)
		this.rendition.on("keydown", (e: KeyboardEvent) => {
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

		this.resizeObserver = new ResizeObserver(() => {
			if (this.resizeTimer) clearTimeout(this.resizeTimer);
			this.resizeTimer = setTimeout(() => {
				this.resizeTimer = null;
				this.handleResize();
			}, 100);
		});
		this.resizeObserver.observe(this.containerEl);
	}

	async display(target?: string): Promise<void> {
		if (!this.rendition) {
			console.warn("[EPUB++] display: no rendition");
			return;
		}
		// Wrap bare CFI paths (starting with /) in epubcfi() format.
		// Leave hrefs (like "chapter1.xhtml") and existing epubcfi() strings as-is.
		const displayTarget =
			target && target.startsWith("/") && !target.startsWith("epubcfi(")
				? `epubcfi(${target})`
				: target;
		console.debug("[EPUB++] display:", displayTarget ?? "(beginning)");
		try {
			await this.rendition.display(displayTarget);
			console.debug("[EPUB++] display: success");
		} catch (e) {
			console.error("[EPUB++] display: failed", e);
			throw e;
		}

		if (!this.locationsGenerated && this.book) {
			void this.book.locations.generate(1024).then(() => {
				this.locationsGenerated = true;
			});
		}
	}

	async next(): Promise<void> {
		await this.rendition?.next();
	}

	async prev(): Promise<void> {
		await this.rendition?.prev();
	}

	getToc(): NavItem[] {
		return this.book?.navigation?.toc ?? [];
	}

	async getTocAsync(): Promise<NavItem[]> {
		if (!this.book) return [];
		try {
			await this.book.loaded.navigation;
			return this.book.navigation?.toc ?? [];
		} catch {
			// Some EPUBs have missing/broken TOC files
			return [];
		}
	}

	getRendition(): Rendition | null {
		return this.rendition;
	}

	getBook(): Book | null {
		return this.book;
	}

	getCurrentHref(): string | null {
		return this.rendition?.location?.start?.href ?? null;
	}

	async getBookTitle(): Promise<string> {
		if (!this.book) return "";
		const meta = await this.book.loaded.metadata;
		return meta.title ?? "";
	}

	async getBookAuthor(): Promise<string> {
		if (!this.book) return "";
		const meta = await this.book.loaded.metadata;
		return meta.creator ?? "";
	}

	getCurrentChapterTitle(): string {
		if (!this.rendition?.location || !this.book?.navigation) return "";
		const href = this.rendition.location.start.href;
		const toc = this.book.navigation.toc;
		return findChapterByHref(toc, href)?.label.trim() ?? "";
	}

	async getSelectedText(cfiRange: string): Promise<string> {
		if (!this.book) return "";
		try {
			const range = await this.book.getRange(cfiRange);
			return range.toString();
		} catch {
			return "";
		}
	}

	getPercentage(): number {
		if (!this.rendition?.location || !this.locationsGenerated) return 0;
		return Math.round(
			(this.rendition.location.start.percentage ?? 0) * 100,
		);
	}

	applyTheme(): void {
		if (!this.rendition) return;
		const theme = this.resolveTheme();
		this.rendition.themes.register("current", theme);
		this.rendition.themes.select("current");
	}

	applyFontSettings(): void {
		if (!this.rendition) return;

		// Register content hook once — injects a <style> tag into each
		// rendered section. This is more reliable than themes.default()
		// because it creates actual CSS rules with !important.
		if (!this.contentHookRegistered) {
			this.contentHookRegistered = true;
			this.rendition.hooks.content.register(
				(contents: Contents) => {
					this.injectUserStyles(contents);
				},
			);
		}
	}

	private injectUserStyles(contents: Contents): void {
		const fontSize = this.settings.fontSize ?? 18;
		const lineHeight = this.settings.lineHeight ?? 1.6;
		const fontFamily = this.settings.fontFamily;
		const opacity = this.settings.highlightOpacity ?? 0.3;

		const fontFamilyRule = fontFamily
			? `font-family: ${fontFamily} !important;`
			: "";

		void contents.addStylesheetCss(`
			body {
				font-size: ${fontSize}px !important;
				line-height: ${lineHeight} !important;
				${fontFamilyRule}
				text-rendering: optimizeLegibility;
				-webkit-font-smoothing: antialiased;
			}
			.epubjs-hl {
				fill: yellow;
				fill-opacity: ${opacity};
				mix-blend-mode: multiply;
			}
			::selection {
				background: rgba(255,255,0, 0.3);
			}
		`, "epub-plus-user-styles");
	}

	updateSettings(settings: EpubPlusSettings): void {
		this.settings = settings;
		this.applyTheme();
		this.applyFontSettings();

		// Re-inject styles into currently rendered content
		try {
			const contents = this.rendition?.getContents();
			const list = Array.isArray(contents) ? contents : [contents];
			for (const c of list) {
				if (c) this.injectUserStyles(c as unknown as Contents);
			}
		} catch {
			// ignore
		}
	}

	destroy(): void {
		if (this.resizeTimer) clearTimeout(this.resizeTimer);
		this.resizeTimer = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.rendition?.destroy();
		if (this.book) {
			this.book.destroy();
		}
		this.rendition = null;
		this.book = null;
	}

	private getContainerSize(): { width: number; height: number } {
		const w = this.containerEl.clientWidth;
		const h = this.containerEl.clientHeight;
		const margin = (this.settings.marginSize ?? 40) * 2;
		return {
			width: Math.floor(Math.max(w - margin, 200)) || 600,
			height: Math.floor(h) || 400,
		};
	}

	forceResize(): void {
		this.handleResize();
	}

	private handleResize(): void {
		try {
			if (!this.rendition) return;
			const { width, height } = this.getContainerSize();
			if (width > 0 && height > 0) {
				this.rendition.resize(width, height);
			}
		} catch (e) {
			console.debug("[EPUB++] handleResize failed:", e);
		}
	}

	private resolveTheme(): Record<string, Record<string, string>> {
		const setting = this.settings.theme;
		let bg: string;
		let fg: string;

		if (setting === "auto") {
			const isDark = document.body.classList.contains("theme-dark");
			bg = isDark ? "#1e1e1e" : "#ffffff";
			fg = isDark ? "#dcddde" : "#1e1e1e";
		} else if (setting === "dark") {
			bg = "#1e1e1e";
			fg = "#dcddde";
		} else if (setting === "sepia") {
			bg = "#f4ecd8";
			fg = "#5b4636";
		} else {
			bg = "#ffffff";
			fg = "#1e1e1e";
		}

		return {
			body: { background: bg, color: fg },
			"a:link": { color: "inherit" },
		};
	}
}

function findChapterByHref(
	toc: NavItem[],
	href: string,
): NavItem | undefined {
	for (const item of toc) {
		const itemHref = item.href.split("#")[0] ?? "";
		if (itemHref && (href === itemHref || href.endsWith(itemHref))) {
			return item;
		}
		if (item.subitems) {
			const found = findChapterByHref(item.subitems, href);
			if (found) return found;
		}
	}
	return undefined;
}
