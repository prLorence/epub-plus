/* Iframe DOM not managed by Obsidian */
/**
 * Native rendering engine — Zotero-inspired approach.
 *
 * Uses EPUB.js only for parsing/unpacking (Book, Section, EpubCFI).
 * Renders sections as direct DOM nodes in a single iframe.
 * Uses CSS multi-column layout for pagination.
 * Preserves the book's original CSS with scoped selectors.
 */
import ePub, { Book } from "epubjs";
import type Section from "epubjs/types/section";
import type { NavItem } from "epubjs";

import type {
	IBookEngine,
	IRendition,
	RenderOptions,
	TocItem,
	BookMetadata,
	ReaderLocation,
	SelectionInfo,
	ContentAccessor,
} from "./types";

// ── Book Engine ──

export class NativeEngine implements IBookEngine {
	private book: Book | null = null;

	async open(data: ArrayBuffer): Promise<void> {
		this.book = ePub();
		await this.book.open(data, "binary");
		this.book.loaded.navigation.catch(() => {});
		this.book.loaded.pageList.catch(() => {});
	}

	renderTo(el: HTMLElement, options: RenderOptions): IRendition {
		if (!this.book) throw new Error("Book not opened");
		return new NativeRendition(this.book, el, options);
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
		return { title: meta.title ?? "", author: meta.creator ?? "" };
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

	getArchive(): import("./types").EpubArchive | null {
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

class NativeRendition implements IRendition {
	private iframe: HTMLIFrameElement | null = null;
	private sectionsContainer: HTMLElement | null = null;
	private currentSectionIndex = 0;
	private sections: Section[] = [];
	private sectionElements = new Map<number, HTMLElement>();
	private locationsGenerated = false;
	private locationsCfis: string[] = [];
	private isPaginated: boolean;
	private spreadWidth = 0;
	private currentPage = 0;
	private totalPages = 0;
	private currentCfi = "";
	private currentHref = "";
	private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
	private highlights = new Map<string, { elements: HTMLElement[]; data: unknown }>();

	constructor(
		private book: Book,
		private containerEl: HTMLElement,
		private options: RenderOptions,
	) {
		this.isPaginated = options.flow === "paginated";
	}

	private iframeReady = false;

	private async ensureIframe(): Promise<void> {
		if (this.iframeReady) return;
		this.iframe = this.containerEl.createEl("iframe", {
			cls: "epub-plus-native-iframe",
		});
		this.iframe.setAttribute("sandbox", "allow-same-origin");
		this.iframe.setAttribute("frameborder", "0");
		this.iframe.setCssProps({
			"width": "100%",
			"height": "100%",
			"border": "none",
		});
		this.iframe.srcdoc = "<!DOCTYPE html><html><head></head><body></body></html>";

		// Wait for iframe to load
		await new Promise<void>((r) => this.iframe!.addEventListener("load", () => r(), { once: true }));

		const doc = this.iframe.contentDocument;
		if (!doc) return;

		// Set up the sections container
		const pageWrapper = doc.createElement("div");
		pageWrapper.className = "epub-page-wrapper";
		this.sectionsContainer = doc.createElement("div");
		this.sectionsContainer.className = "epub-sections";
		pageWrapper.appendChild(this.sectionsContainer);
		doc.body.appendChild(pageWrapper);

		// Inject base styles
		const style = doc.createElement("style");
		style.id = "epub-plus-native-base";
		style.textContent = this.getBaseStyles();
		doc.head.appendChild(style);

		// Forward events
		doc.addEventListener("keydown", (e: KeyboardEvent) => {
			this.emit("keydown", e);
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

		doc.addEventListener("click", () => {
			this.emit("click");
		});

		doc.addEventListener("mouseup", () => {
			const sel = doc.getSelection();
			if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
			const range = sel.getRangeAt(0);
			// Generate a CFI from the range
			const cfi = this.rangeToCfi(range);
			if (cfi) {
				this.emit("selected", cfi, {
					text: sel.toString(),
					window: this.iframe!.contentWindow!,
					document: doc,
					clearSelection: () => sel.removeAllRanges(),
				} satisfies SelectionInfo);
			}
		});

		// Load spine sections
		const sections: Section[] = [];
		this.book.spine.each((section: Section) => {
			sections.push(section);
		});
		this.sections = sections;
		this.iframeReady = true;
	}

	async display(target?: string): Promise<void> {
		await this.ensureIframe();
		if (!target) {
			// Display from beginning
			await this.displaySection(0);
			this.scrollToPage(0);
			return;
		}

		// Wrap bare CFI paths
		const cfi = target.startsWith("/") && !target.startsWith("epubcfi(")
			? `epubcfi(${target})`
			: target;

		if (cfi.startsWith("epubcfi(")) {
			// Find which section contains this CFI
			const sectionIndex = this.findSectionByCfi(cfi);
			await this.displaySection(sectionIndex);
			// Scroll to the CFI position
			this.scrollToCfi(cfi);
		} else {
			// Treat as href
			const sectionIndex = this.sections.findIndex((s) => {
				const sHref = s.href.split("#")[0] ?? "";
				return target === s.href || target.endsWith(sHref) || sHref.endsWith(target.split("#")[0] ?? "");
			});
			if (sectionIndex >= 0) {
				await this.displaySection(sectionIndex);
				const fragment = target.split("#")[1];
				if (fragment) {
					const doc = this.getIframeDoc();
					const el = doc?.getElementById(fragment);
					if (el) el.scrollIntoView();
				}
			}
		}
	}

	async next(): Promise<void> {
		if (this.isPaginated) {
			if (this.currentPage < this.totalPages - 1) {
				this.scrollToPage(this.currentPage + 1);
			} else if (this.currentSectionIndex < this.sections.length - 1) {
				await this.displaySection(this.currentSectionIndex + 1);
				this.scrollToPage(0);
			}
		} else {
			const container = this.sectionsContainer?.parentElement;
			if (container) {
				container.scrollBy({ top: container.clientHeight * 0.85, behavior: "smooth" });
			}
		}
	}

	async prev(): Promise<void> {
		if (this.isPaginated) {
			if (this.currentPage > 0) {
				this.scrollToPage(this.currentPage - 1);
			} else if (this.currentSectionIndex > 0) {
				await this.displaySection(this.currentSectionIndex - 1);
				// Go to last page of previous section
				this.scrollToPage(Math.max(0, this.totalPages - 1));
			}
		} else {
			const container = this.sectionsContainer?.parentElement;
			if (container) {
				container.scrollBy({ top: -container.clientHeight * 0.85, behavior: "smooth" });
			}
		}
	}

	resize(width: number, height: number): void {
		if (!this.iframe) return;
		this.options.width = width;
		this.options.height = height;
		this.updatePaginationLayout();
	}

	destroy(): void {
		if (this.iframe) {
			this.iframe.remove();
			this.iframe = null;
		}
		this.sectionsContainer = null;
		this.sectionElements.clear();
		this.highlights.clear();
		this.listeners.clear();
	}

	// Themes & styling

	setTheme(theme: Record<string, Record<string, string>>): void {
		const doc = this.getIframeDoc();
		if (!doc) return;

		const bodyStyles = theme["body"];
		if (bodyStyles) {
			const root = doc.documentElement;
			const bg = bodyStyles["background"] ?? "#ffffff";
			const fg = bodyStyles["color"] ?? "#121212";
			const isDark = bg.startsWith("#1") || bg.startsWith("#2");

			root.style.setProperty("--background-color", bg);
			root.style.setProperty("--text-color", fg);

			if (isDark) {
				root.setAttribute("data-color-scheme", "dark");
				root.style.setProperty("--link-color", "#63caff");
				root.style.setProperty("--visited-link-color", "#0099e5");
			} else {
				root.setAttribute("data-color-scheme", "light");
				root.style.setProperty("--link-color", "#0000ee");
				root.style.setProperty("--visited-link-color", "#551a8b");
			}
		}
	}

	injectStylesheet(css: string, key: string): void {
		const doc = this.getIframeDoc();
		if (!doc) return;

		// For user styles, apply via CSS variables on root instead of
		// injecting a competing stylesheet. This preserves book styling.
		if (key === "epub-plus-user-styles") {
			const root = doc.documentElement;
			// Parse font-size from the CSS
			const fontMatch = /font-size:\s*(\d+)px/i.exec(css);
			if (fontMatch) {
				const px = parseInt(fontMatch[1]!, 10);
				root.style.setProperty("font-size", `${px}px`, "important");
			}
			// Parse font-family
			const familyMatch = /font-family:\s*([^;!]+)/i.exec(css);
			if (familyMatch) {
				root.style.setProperty("--content-font-family", familyMatch[1]!.trim());
				const wrappers = doc.querySelectorAll(".section-wrapper");
				for (let i = 0; i < wrappers.length; i++) {
					(wrappers[i] as HTMLElement).style.setProperty("font-family", "var(--content-font-family)");
				}
			}
			return;
		}

		let style = doc.getElementById(key) as HTMLStyleElement | null;
		if (!style) {
			style = doc.createElement("style");
			style.id = key;
			doc.head.appendChild(style);
		}
		style.textContent = css;
	}

	// Annotations

	addHighlight(
		cfiRange: string,
		data: unknown,
		color: string,
		opacity: number,
		_onClick?: (e: MouseEvent) => void,
	): void {
		const doc = this.getIframeDoc();
		if (!doc) return;

		void this.cfiToRange(cfiRange).then((range) => {
			if (!range) return;
			const elements = this.wrapRangeWithHighlight(range, doc, color, opacity, cfiRange);
			this.highlights.set(cfiRange, { elements, data });
		}).catch(() => {
			// CFI resolution failed
		});
	}

	removeHighlight(cfiRange: string): void {
		const entry = this.highlights.get(cfiRange);
		if (!entry) return;

		for (const el of entry.elements) {
			const parent = el.parentNode;
			if (parent) {
				while (el.firstChild) {
					parent.insertBefore(el.firstChild, el);
				}
				parent.removeChild(el);
			}
		}
		this.highlights.delete(cfiRange);
	}

	clearHighlights(): void {
		for (const cfi of this.highlights.keys()) {
			this.removeHighlight(cfi);
		}
	}

	// State

	getCurrentLocation(): ReaderLocation | null {
		return {
			cfi: this.currentCfi,
			href: this.currentHref,
			percentage: this.locationsGenerated ? this.calculatePercentage() : 0,
			displayed: this.isPaginated
				? { page: this.currentPage + 1, total: this.totalPages }
				: undefined,
		};
	}

	getSpineEndHref(): string | null {
		const last = this.sections[this.sections.length - 1];
		return last?.href ?? null;
	}

	getContents(): ContentAccessor[] {
		const doc = this.getIframeDoc();
		const win = this.iframe?.contentWindow;
		if (!doc || !win) return [];
		return [{ document: doc, window: win }];
	}

	// Locations

	async generateLocations(chars: number): Promise<void> {
		// Use epub.js's location generation on the book object
		try {
			this.locationsCfis = await this.book.locations.generate(chars);
			this.locationsGenerated = true;
		} catch {
			// Some books fail location generation
		}
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
		let list = this.listeners.get(event);
		if (!list) {
			list = [];
			this.listeners.set(event, list);
		}
		list.push(cb);
	}

	off(event: string, cb: unknown): void {
		const list = this.listeners.get(event);
		if (!list) return;
		const idx = list.indexOf(cb as (...args: unknown[]) => void);
		if (idx >= 0) list.splice(idx, 1);
	}

	// ── Private ──

	private emit(event: string, ...args: unknown[]): void {
		const list = this.listeners.get(event);
		if (!list) return;
		for (const cb of list) {
			cb(...args);
		}
	}

	private getIframeDoc(): Document | null {
		return this.iframe?.contentDocument ?? null;
	}

	private async displaySection(index: number): Promise<void> {
		if (index < 0 || index >= this.sections.length) return;
		this.currentSectionIndex = index;
		const section = this.sections[index]!;
		this.currentHref = section.href;

		const container = this.sectionsContainer;
		if (!container) return;

		// Clear previous content
		container.innerHTML = "";
		this.sectionElements.clear();

		// Render the section's XHTML
		const doc = this.getIframeDoc();
		if (!doc) return;

		try {
			// section.render() returns a Promise at runtime despite the types saying string
			const contents = await (section.render(
				this.book.archive.request.bind(this.book.archive),
			) as unknown as Promise<string>);

			// Parse the XHTML
			const parser = new DOMParser();
			const sectionDoc = parser.parseFromString(
				contents,
				"application/xhtml+xml",
			);

			// Extract and scope the CSS
			await this.injectSectionStyles(sectionDoc, section, doc, index);

			// Create a scoped wrapper
			const wrapper = doc.createElement("div");
			wrapper.className = `section-wrapper __scope_${index}`;
			wrapper.dataset["sectionIndex"] = String(index);

			// Move body content into the wrapper
			const body = sectionDoc.body || sectionDoc.querySelector("body");
			if (body) {
				for (const child of Array.from(body.childNodes)) {
					wrapper.appendChild(doc.importNode(child, true));
				}
			}

			container.appendChild(wrapper);
			this.sectionElements.set(index, wrapper);
		} catch (e) {
			console.error("[EPUB++] Native: failed to render section", index, e);
		}

		this.updatePaginationLayout();
		this.updateCurrentCfi();
		this.emit("rendered");
		this.emitRelocated();
	}

	private async injectSectionStyles(
		sectionDoc: Document,
		section: Section,
		targetDoc: Document,
		scopeIndex: number,
	): Promise<void> {
		const scopeClass = `__scope_${scopeIndex}`;

		// Extract <link> stylesheets.
		// section.render() resolves hrefs to blob URLs. We fetch from
		// the parent window since the sandboxed iframe can't fetch.
		const links = sectionDoc.querySelectorAll('link[rel="stylesheet"]');

		const sectionDir = section.href.split("/").slice(0, -1).join("/");

		for (const link of Array.from(links)) {
			const href = link.getAttribute("href");
			if (!href) continue;

			let cssText: string | null = null;

			// Strategy 1: fetch blob URL directly (if section.render() resolved it)
			if (href.startsWith("blob:")) {
				try {
					const response = await window.fetch(href);
					if (response.ok) cssText = await response.text();
				} catch { /* try next strategy */ }
			}

			// Strategy 2: resolve relative to section directory in archive
			if (!cssText) {
				const candidates = [
					sectionDir ? `${sectionDir}/${href}` : href,
					href,
					href.replace(/^\.\//, ""),
				];
				for (const candidate of candidates) {
					if (cssText) break;
					try {
						const result = await this.book.archive.request(candidate, "text") as string;
						if (result && typeof result === "string" && result.length > 10) {
							cssText = result;
						}
					} catch { /* try next */ }
				}
			}

			if (cssText) {
				console.debug("[EPUB++] Native: loaded stylesheet", cssText.length, "chars");
				const scoped = this.scopeCss(cssText, scopeClass);
				const style = targetDoc.createElement("style");
				style.dataset["scope"] = scopeClass;
				style.textContent = scoped;
				targetDoc.head.appendChild(style);
			} else {
				console.debug("[EPUB++] Native: could not load stylesheet", href);
			}
		}

		// Extract inline <style> elements
		const styles = sectionDoc.querySelectorAll("style");
		for (const inlineStyle of Array.from(styles)) {
			if (inlineStyle.textContent) {
				const scoped = this.scopeCss(inlineStyle.textContent, scopeClass);
				const style = targetDoc.createElement("style");
				style.dataset["scope"] = scopeClass;
				style.textContent = scoped;
				targetDoc.head.appendChild(style);
			}
		}
	}

	/**
	 * Scope CSS by injecting it into a CSSStyleSheet and rewriting
	 * selectors programmatically. Falls back to regex for broken CSS.
	 */
	private scopeCss(css: string, scopeClass: string): string {
		// Replace -epub- prefixed properties with standard equivalents
		const processed = css
			.replace(/-epub-hyphens/g, "hyphens")
			.replace(/-epub-writing-mode/g, "writing-mode")
			.replace(/-epub-text-align-last/g, "text-align-last")
			.replace(/-epub-word-break/g, "word-break");

		// Use CSSStyleSheet API for robust parsing
		try {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(processed);
			return this.scopeRules(sheet.cssRules, scopeClass);
		} catch {
			// Fallback: return the CSS with a simple wrapper
			return `.${scopeClass} { ${processed} }`;
		}
	}

	private scopeRules(rules: CSSRuleList, scopeClass: string): string {
		const parts: string[] = [];

		for (let i = 0; i < rules.length; i++) {
			const rule = rules[i]!;

			if (rule instanceof CSSStyleRule) {
				const scoped = this.scopeSelector(rule.selectorText, scopeClass);
				parts.push(`${scoped} { ${rule.style.cssText} }`);
			} else if (rule instanceof CSSMediaRule) {
				const inner = this.scopeRules(rule.cssRules, scopeClass);
				parts.push(`@media ${rule.conditionText} { ${inner} }`);
			} else if (rule instanceof CSSSupportsRule) {
				const inner = this.scopeRules(rule.cssRules, scopeClass);
				parts.push(`@supports ${rule.conditionText} { ${inner} }`);
			} else if (rule instanceof CSSFontFaceRule) {
				// Don't scope @font-face — it needs to be global.
				// URL resolution for font files is handled by epub.js archive.
				parts.push(rule.cssText);
			} else if (rule instanceof CSSKeyframesRule) {
				parts.push(rule.cssText);
			} else {
				// Other rules (@import, @page, etc.) — pass through
				parts.push(rule.cssText);
			}
		}

		return parts.join("\n");
	}

	private scopeSelector(selectorText: string, scopeClass: string): string {
		return selectorText
			.split(",")
			.map((sel) => {
				sel = sel.trim();
				if (!sel) return sel;
				// Replace body/html with the scope class
				sel = sel.replace(/\bbody\b/gi, `.${scopeClass}`);
				sel = sel.replace(/\bhtml\b/gi, `.${scopeClass}`);
				// Prepend scope if not already scoped
				if (!sel.startsWith(`.${scopeClass}`)) {
					return `.${scopeClass} ${sel}`;
				}
				return sel;
			})
			.join(", ");
	}

	private updatePaginationLayout(): void {
		const doc = this.getIframeDoc();
		if (!doc || !this.sectionsContainer) return;

		// Update the base styles with new dimensions
		const baseStyle = doc.getElementById("epub-plus-native-base");
		if (baseStyle) {
			baseStyle.textContent = this.getBaseStyles();
		}

		if (this.isPaginated) {
			const width = this.options.width;
			this.spreadWidth = width;

			// Calculate total pages after layout
			requestAnimationFrame(() => {
				if (!this.sectionsContainer) return;
				const scrollWidth = this.sectionsContainer.scrollWidth;
				const spreadSize = this.getSpreadSize();
				this.totalPages = Math.max(1, Math.ceil(scrollWidth / spreadSize));
				this.emitRelocated();
			});
		}
	}

	private getSpreadSize(): number {
		const doc = this.getIframeDoc();
		const viewportWidth = doc?.documentElement.clientWidth ?? this.spreadWidth;
		// Column width = viewport - 80px (body margin), gap = viewport (100vw)
		const colWidth = viewportWidth - 80;
		return colWidth + viewportWidth;
	}

	private scrollToPage(page: number): void {
		if (!this.sectionsContainer || !this.isPaginated) return;
		this.currentPage = Math.max(0, Math.min(page, this.totalPages - 1));
		const offset = this.currentPage * this.getSpreadSize();
		this.sectionsContainer.scrollLeft = offset;
		this.updateCurrentCfi();
		this.emitRelocated();
	}

	private scrollToCfi(cfi: string): void {
		// For now, CFI-based scrolling is best-effort.
		// The section is already displayed by findSectionByCfi.
		// Scroll to the beginning of the section.
		this.currentCfi = cfi;
		if (this.isPaginated) {
			this.scrollToPage(0);
		}
	}

	private updateCurrentCfi(): void {
		const doc = this.getIframeDoc();
		if (!doc || !this.sections[this.currentSectionIndex]) return;

		const section = this.sections[this.currentSectionIndex]!;
		try {
			// Get the first visible element in the section
			const wrapper = this.sectionElements.get(this.currentSectionIndex);
			const firstEl = wrapper?.querySelector("p, h1, h2, h3, h4, div, span");
			if (firstEl) {
				this.currentCfi = section.cfiFromElement(firstEl);
			}
		} catch {
			this.currentCfi = "";
		}
	}

	private calculatePercentage(): number {
		if (this.sections.length === 0) return 0;
		const sectionProgress = this.currentSectionIndex / this.sections.length;
		const pageProgress = this.totalPages > 0
			? this.currentPage / this.totalPages / this.sections.length
			: 0;
		return sectionProgress + pageProgress;
	}

	private relocatedTimer: ReturnType<typeof setTimeout> | null = null;

	private emitRelocated(): void {
		// Debounce to avoid spamming progress saves
		if (this.relocatedTimer) return;
		this.relocatedTimer = setTimeout(() => {
			this.relocatedTimer = null;
			const loc = this.getCurrentLocation();
			if (loc) {
				this.emit("relocated", loc);
			}
		}, 100);
	}

	private findSectionByCfi(cfi: string): number {
		// Parse the spine position from the CFI string.
		// CFI format: epubcfi(/6/N!...) where N is the spine index * 2
		try {
			const match = /^epubcfi\(\/6\/(\d+)/.exec(cfi);
			if (match) {
				const spinePos = Math.floor(parseInt(match[1]!, 10) / 2) - 1;
				for (let i = 0; i < this.sections.length; i++) {
					if (this.sections[i]!.index === spinePos) {
						return i;
					}
				}
			}
		} catch {
			// Fall through
		}
		return 0;
	}

	private rangeToCfi(range: Range): string | null {
		const section = this.sections[this.currentSectionIndex];
		if (!section) return null;
		try {
			return section.cfiFromRange(range);
		} catch {
			return null;
		}
	}

	private async cfiToRange(cfi: string): Promise<Range | null> {
		try {
			return await this.book.getRange(cfi);
		} catch {
			return null;
		}
	}

	private wrapRangeWithHighlight(
		range: Range,
		doc: Document,
		color: string,
		opacity: number,
		cfi: string,
	): HTMLElement[] {
		const elements: HTMLElement[] = [];

		// Get all client rects for the range (handles multi-line selections)
		const rects = range.getClientRects();
		if (rects.length === 0) return elements;

		// Use mark elements to wrap the range content
		try {
			const mark = doc.createElement("mark");
			mark.className = "html-plus-highlight";
			mark.dataset["epubcfi"] = cfi;
			mark.style.setProperty("background-color", color);
			mark.style.setProperty("opacity", String(opacity));
			mark.style.setProperty("mix-blend-mode", "multiply");
			mark.style.setProperty("border-radius", "2px");
			range.surroundContents(mark);
			elements.push(mark);
		} catch {
			// surroundContents fails for cross-element ranges — use extractContents instead
			try {
				const fragment = range.extractContents();
				const mark = doc.createElement("mark");
				mark.className = "html-plus-highlight";
				mark.dataset["epubcfi"] = cfi;
				mark.style.setProperty("background-color", color);
				mark.style.setProperty("opacity", String(opacity));
				mark.style.setProperty("mix-blend-mode", "multiply");
				mark.appendChild(fragment);
				range.insertNode(mark);
				elements.push(mark);
			} catch {
				// Give up on this highlight
			}
		}

		return elements;
	}

	private getBaseStyles(): string {
		const isPaginated = this.isPaginated;
		const pageWidth = this.options.width || 800;

		return `
			/* ── Reset (matches Zotero reader layout) ── */
			html {
				margin: 0 !important;
				padding: 0 !important;
				background-color: var(--background-color, #ffffff) !important;
				color: var(--text-color, #121212) !important;
			}

			body {
				margin: ${isPaginated ? "40px" : "0"} !important;
				padding: 0 !important;
				overflow: hidden;
				overscroll-behavior: none;
			}

			::selection {
				background-color: rgba(113, 173, 253, 0.4);
			}

			/* ── Page wrapper ── */
			.epub-page-wrapper {
				overflow: hidden;
			}

			/* ── Sections container ── */
			.epub-sections {
				margin-inline: auto;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
					"Helvetica Neue", Helvetica, Arial, sans-serif;
				text-rendering: optimizeLegibility;
				-webkit-font-smoothing: antialiased;
				${isPaginated ? `
					max-width: calc(100vw - 80px);
					min-height: calc(100vh - 80px);
					max-height: calc(100vh - 80px);
					column-fill: auto;
					-webkit-column-fill: auto;
					column-gap: 100vw;
					column-width: calc(100vw - 80px);
					overflow: hidden;
					overscroll-behavior: none;
				` : `
					margin-inline: 40px;
					max-width: ${Math.min(pageWidth, 800)}px;
					overflow-x: visible;
				`}
			}

			/* ── Section wrappers ── */
			.section-wrapper {
				display: block;
				line-height: 1.6;
				${!isPaginated ? `
					margin-block-end: 100px;
				` : ""}
			}

			.section-wrapper.hidden {
				display: none;
			}

			/* ── Typography ── */
			.section-wrapper {
				font-family: var(--content-font-family, "Georgia", "Times New Roman", serif);
			}

			.section-wrapper p,
			.section-wrapper [role="paragraph"] {
				widows: 2;
				orphans: 2;
				hyphens: auto;
				-webkit-hyphens: auto;
				text-align: justify;
			}

			.section-wrapper a {
				text-decoration: none;
			}

			.section-wrapper :link {
				color: var(--link-color, #0000ee) !important;
			}

			.section-wrapper :visited {
				color: var(--visited-link-color, #551a8b) !important;
			}

			/* ── Media ── */
			.section-wrapper img,
			.section-wrapper svg,
			.section-wrapper video {
				${isPaginated ? `
					max-width: calc(min(0.98 * ${Math.min(pageWidth, 800)}px, 100%)) !important;
					max-height: calc(0.98 * (100vh - 80px)) !important;
					object-fit: contain;
				` : `
					max-width: 100% !important;
					max-height: 100vh;
					object-fit: contain;
				`}
				width: auto;
				height: auto;
			}

			/* ── Page breaks (paginated) ── */
			${isPaginated ? `
				.section-wrapper section + section {
					margin-block-start: 100vh;
				}
			` : ""}

			/* ── Highlights ── */
			.html-plus-highlight {
				border-radius: 2px;
				cursor: pointer;
			}
			.html-plus-highlight:hover {
				filter: brightness(0.9);
			}
		`;
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
