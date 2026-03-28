import ePub, { Book, Rendition, Location, NavItem, Contents } from "epubjs";
import type { EpubPlusSettings } from "../settings";

export interface EpubRendererCallbacks {
	onRelocated: (location: Location) => void;
	onSelected: (cfiRange: string, contents: Contents) => void;
}

export class EpubRenderer {
	private book: Book | null = null;
	private rendition: Rendition | null = null;
	private locationsGenerated = false;
	private resizeObserver: ResizeObserver | null = null;

	constructor(
		private containerEl: HTMLElement,
		private settings: EpubPlusSettings,
		private callbacks: EpubRendererCallbacks,
	) {}

	async open(data: ArrayBuffer): Promise<void> {
		this.book = ePub();
		await this.book.open(data, "binary");

		const { width, height } = this.getContainerSize();

		this.rendition = this.book.renderTo(this.containerEl, {
			width,
			height,
			spread: "none",
			flow:
				this.settings.readingMode === "paginated"
					? "paginated"
					: "scrolled-doc",
		});

		this.applyTheme();
		this.applyFontSettings();

		this.rendition.on("relocated", (location: Location) => {
			this.callbacks.onRelocated(location);
		});

		this.rendition.on("selected", (cfiRange: string, contents: Contents) => {
			this.callbacks.onSelected(cfiRange, contents);
		});

		this.resizeObserver = new ResizeObserver(() => {
			this.handleResize();
		});
		this.resizeObserver.observe(this.containerEl);
	}

	async display(target?: string): Promise<void> {
		if (!this.rendition) return;
		// EPUB.js expects CFIs in epubcfi(...) format
		const displayTarget =
			target && !target.startsWith("epubcfi(")
				? `epubcfi(${target})`
				: target;
		await this.rendition.display(displayTarget);

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
		const styles: Record<string, string> = {
			"font-size": `${this.settings.fontSize}px !important`,
			"line-height": `${this.settings.lineHeight}`,
		};
		if (this.settings.fontFamily) {
			styles["font-family"] = `${this.settings.fontFamily} !important`;
		}
		this.rendition.themes.default({ body: styles });
	}

	updateSettings(settings: EpubPlusSettings): void {
		this.settings = settings;
		this.applyTheme();
		this.applyFontSettings();
	}

	destroy(): void {
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
		const rect = this.containerEl.getBoundingClientRect();
		return {
			width: Math.floor(rect.width) || 600,
			height: Math.floor(rect.height) || 400,
		};
	}

	private handleResize(): void {
		if (!this.rendition) return;
		const { width, height } = this.getContainerSize();
		this.rendition.resize(width, height);
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
