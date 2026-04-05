/* Modifies CSS rules inside iframe, not Obsidian DOM */
/**
 * EPUB.js engine adapter — wraps epub.js Book + Rendition behind
 * the IBookEngine / IRendition interfaces.
 *
 * This is the ONLY file that imports from "epubjs".
 */
import ePub, { Book, Rendition, NavItem, Contents } from "epubjs";
import type { Location } from "epubjs";
import type {
	IBookEngine,
	IRendition,
	RenderOptions,
	TocItem,
	BookMetadata,
	ReaderLocation,
	SelectionInfo,
	ContentAccessor,
	ITextResolver,
	EpubArchive,
} from "./types";

// ── Book Engine ──

export class EpubJsEngine implements IBookEngine {
	private book: Book | null = null;

	async open(data: ArrayBuffer): Promise<void> {
		this.book = ePub();
		await this.book.open(data, "binary");
		// Suppress unhandled rejections from optional resources
		this.book.loaded.navigation.catch(() => {});
		this.book.loaded.pageList.catch(() => {});
	}

	renderTo(el: HTMLElement, options: RenderOptions): IRendition {
		if (!this.book) throw new Error("Book not opened");
		const rendition = this.book.renderTo(el, {
			width: options.width,
			height: options.height,
			spread: options.spread,
			flow: options.flow === "paginated" ? "paginated" : "scrolled-doc",
		});
		return new EpubJsRendition(rendition, this.book);
	}

	async getToc(): Promise<TocItem[]> {
		if (!this.book) return [];
		try {
			await this.book.loaded.navigation;
			return convertNavItems(this.book.navigation?.toc ?? []);
		} catch {
			return [];
		}
	}

	async getMetadata(): Promise<BookMetadata> {
		if (!this.book) return { title: "", author: "" };
		const meta = await this.book.loaded.metadata;
		return {
			title: meta.title ?? "",
			author: meta.creator ?? "",
		};
	}

	async getRange(cfiRange: string): Promise<Range | null> {
		if (!this.book) return null;
		try {
			return await this.book.getRange(cfiRange);
		} catch {
			return null;
		}
	}

	getSpineHrefs(): string[] {
		if (!this.book) return [];
		const hrefs: string[] = [];
		this.book.spine.each((section: { href: string }) => {
			hrefs.push(section.href);
		});
		return hrefs;
	}

	getArchive(): EpubArchive | null {
		if (!this.book?.archive) return null;
		return {
			request: (url: string, type: string) =>
				this.book!.archive.request(url, type) as Promise<string>,
		};
	}

	destroy(): void {
		if (this.book) {
			this.book.destroy();
			this.book = null;
		}
	}
}

// ── Rendition ──

class EpubJsRendition implements IRendition {
	private locationsGenerated = false;

	constructor(
		private rendition: Rendition,
		private book: Book,
	) {}

	async display(target?: string): Promise<void> {
		// Wrap bare CFI paths in epubcfi() format
		const displayTarget =
			target && target.startsWith("/") && !target.startsWith("epubcfi(")
				? `epubcfi(${target})`
				: target;
		await this.rendition.display(displayTarget);
	}

	async next(): Promise<void> {
		await this.rendition.next();
	}

	async prev(): Promise<void> {
		await this.rendition.prev();
	}

	resize(width: number, height: number): void {
		this.rendition.resize(width, height);
	}

	destroy(): void {
		this.rendition.destroy();
	}

	// Themes & styling

	setTheme(theme: Record<string, Record<string, string>>): void {
		this.rendition.themes.register("current", theme);
		this.rendition.themes.select("current");
	}

	injectStylesheet(css: string, key: string): void {
		// Register a content hook that injects the stylesheet into each section
		// AND rewrites absolute font sizes to rem for proper scaling.
		this.rendition.hooks.content.register((contents: Contents) => {
			void contents.addStylesheetCss(css, key);
			// Rewrite book's absolute font sizes to rem
			this.rewriteFontSizesToRem(contents);
		});
	}

	/**
	 * Rewrite absolute font sizes (px, pt) in the book's stylesheets
	 * to rem units. This is the Zotero approach — ensures all font sizes
	 * scale proportionally with the user's root font-size setting.
	 * Base: 13px = 1rem (matching Zotero's 13pt base).
	 */
	private rewriteFontSizesToRem(contents: Contents): void {
		try {
			const doc = (contents as unknown as { document: Document }).document;
			if (!doc) return;

			const sheets = doc.styleSheets;
			for (let i = 0; i < sheets.length; i++) {
				const sheet = sheets[i]!;
				// Skip our own injected stylesheet
				if (sheet.ownerNode instanceof HTMLElement &&
					sheet.ownerNode.id === "epub-plus-user-styles") {
					continue;
				}
				try {
					this.rewriteRules(sheet.cssRules);
				} catch {
					// Cross-origin stylesheet — can't access rules
				}
			}
		} catch {
			// Ignore errors
		}
	}

	private rewriteRules(rules: CSSRuleList): void {
		const BASE_PX = 16;

		for (let i = 0; i < rules.length; i++) {
			const rule = rules[i]!;
			if (rule instanceof CSSStyleRule) {
				const fs = rule.style.getPropertyValue("font-size");
				if (fs) {
					const remValue = this.convertToRem(fs, BASE_PX);
					if (remValue !== null) {
						rule.style.setProperty("font-size", remValue);
					}
				}
				// If this looks like a heading (large font), add page-break-before
				// so headings start at the top of a new page in paginated mode.
				if (fs) {
					const px = this.toPx(fs, BASE_PX);
					if (px !== null && px >= BASE_PX * 1.3) {
						rule.style.setProperty("break-before", "column");
					}
				}
			} else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
				this.rewriteRules(rule.cssRules);
			}
		}
	}

	private static readonly RE_PX = /^([\d.]+)\s*px$/i;
	private static readonly RE_PT = /^([\d.]+)\s*pt$/i;
	private static readonly RE_REM = /^([\d.]+)\s*rem$/i;
	private static readonly RE_EM = /^([\d.]+)\s*em$/i;
	private static readonly NAMED_SIZES: Record<string, string> = {
		"xx-small": "0.5625rem",
		"x-small": "0.625rem",
		"small": "0.8333rem",
		"medium": "1rem",
		"large": "1.125rem",
		"x-large": "1.5rem",
		"xx-large": "2rem",
	};

	private toPx(value: string, basePx: number): number | null {
		let m: RegExpExecArray | null;
		if ((m = EpubJsRendition.RE_PX.exec(value))) return parseFloat(m[1]!);
		if ((m = EpubJsRendition.RE_PT.exec(value))) return parseFloat(m[1]!) * 1.333;
		if ((m = EpubJsRendition.RE_REM.exec(value))) return parseFloat(m[1]!) * basePx;
		if ((m = EpubJsRendition.RE_EM.exec(value))) return parseFloat(m[1]!) * basePx;
		return null;
	}

	private convertToRem(value: string, basePx: number): string | null {
		let m: RegExpExecArray | null;
		if ((m = EpubJsRendition.RE_PX.exec(value))) {
			return `${(parseFloat(m[1]!) / basePx).toFixed(4)}rem`;
		}
		if ((m = EpubJsRendition.RE_PT.exec(value))) {
			return `${(parseFloat(m[1]!) * 1.333 / basePx).toFixed(4)}rem`;
		}
		return EpubJsRendition.NAMED_SIZES[value.toLowerCase()] ?? null;
	}

	// Annotations

	addHighlight(
		cfiRange: string,
		data: unknown,
		color: string,
		opacity: number,
		onClick?: (e: MouseEvent) => void,
		style: "highlight" | "underline" = "highlight",
	): void {
		const cssClass = style === "underline" ? "epubjs-ul" : "epubjs-hl";
		const styles = style === "underline"
			? {
				fill: "none",
				stroke: color,
				"stroke-width": "2",
				"stroke-opacity": String(Math.min(opacity + 0.3, 1)),
			}
			: {
				fill: color,
				"fill-opacity": String(opacity),
				"mix-blend-mode": "multiply",
			};

		this.rendition.annotations.highlight(
			cfiRange,
			data ?? {},
			onClick ?? (() => {}),
			cssClass,
			styles,
		);
	}

	removeHighlight(cfiRange: string): void {
		try {
			this.rendition.annotations.remove(cfiRange, "highlight");
		} catch {
			// ignore
		}
	}

	clearHighlights(): void {
		// epub.js doesn't have a clearAll — tracked externally by HighlightManager
	}

	// State

	getCurrentLocation(): ReaderLocation | null {
		const loc = this.rendition.location;
		if (!loc?.start) return null;
		return {
			cfi: loc.start.cfi,
			href: loc.start.href,
			percentage: loc.start.percentage ?? 0,
			displayed: loc.start.displayed
				? { page: loc.start.displayed.page, total: loc.start.displayed.total }
				: undefined,
		};
	}

	getSpineEndHref(): string | null {
		try {
			return this.book.spine.last()?.href ?? null;
		} catch {
			return null;
		}
	}

	getContents(): ContentAccessor[] {
		const raw = this.rendition.getContents();
		const list = Array.isArray(raw) ? raw : [raw];
		return list
			.filter((c): c is Contents => !!c)
			.map((c) => ({
				document: (c as unknown as { document: Document }).document,
				window: (c as unknown as { window: Window }).window,
			}));
	}

	// Locations

	async generateLocations(chars: number): Promise<void> {
		await this.book.locations.generate(chars);
		this.locationsGenerated = true;
	}

	areLocationsReady(): boolean {
		return this.locationsGenerated;
	}

	percentageFromCfi(cfi: string): number | null {
		if (!this.locationsGenerated) return null;
		try {
			const pct = this.book.locations.percentageFromCfi(cfi);
			if (typeof pct === "number" && !isNaN(pct)) return pct;
			return null;
		} catch {
			return null;
		}
	}

	cfiFromPercentage(pct: number): string | null {
		if (!this.locationsGenerated) return null;
		try {
			const cfi = this.book.locations.cfiFromPercentage(pct);
			if (cfi && typeof cfi === "string" && cfi.startsWith("epubcfi(")) {
				return cfi;
			}
			return null;
		} catch {
			return null;
		}
	}

	// Events

	on(event: "relocated", cb: (location: ReaderLocation) => void): void;
	on(event: "selected", cb: (cfiRange: string, selection: SelectionInfo) => void): void;
	on(event: "rendered", cb: () => void): void;
	on(event: "keydown", cb: (e: KeyboardEvent) => void): void;
	on(event: "click", cb: () => void): void;
	on(event: string, cb: ((...args: never[]) => void)): void {
		if (event === "relocated") {
			this.rendition.on("relocated", (location: Location) => {
				(cb as (loc: ReaderLocation) => void)({
					cfi: location.start.cfi,
					href: location.start.href,
					percentage: location.start.percentage ?? 0,
					displayed: location.start.displayed
						? { page: location.start.displayed.page, total: location.start.displayed.total }
						: undefined,
				});
			});
		} else if (event === "selected") {
			this.rendition.on("selected", (cfiRange: string, contents: Contents) => {
				(cb as (cfi: string, sel: SelectionInfo) => void)(cfiRange, {
					text: contents.window.getSelection()?.toString() ?? "",
					window: contents.window,
					document: contents.document,
					clearSelection: () => contents.window.getSelection()?.removeAllRanges(),
				});
			});
		} else {
			this.rendition.on(event, cb);
		}
	}

	off(event: string, cb: unknown): void {
		this.rendition.off(event, cb as (...args: unknown[]) => void);
	}
}

// ── Text Resolver ──

export class EpubJsTextResolver implements ITextResolver {
	async resolve(data: ArrayBuffer, cfiRange: string): Promise<string | null> {
		const book = ePub();
		try {
			await book.open(data, "binary");
			const range = await book.getRange(cfiRange);
			return range?.toString() ?? null;
		} catch {
			return null;
		} finally {
			book.destroy();
		}
	}
}

// ── Helpers ──

function convertNavItems(items: NavItem[]): TocItem[] {
	return items.map((item) => ({
		id: item.id ?? "",
		href: item.href,
		label: item.label.trim(),
		children: item.subitems ? convertNavItems(item.subitems) : [],
	}));
}
