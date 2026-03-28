import type { Rendition, Contents } from "epubjs";
import type { EpubBacklink, PaletteColor } from "../types";

export interface HighlightCallbacks {
	onHighlightClick: (backlinks: EpubBacklink[], event: MouseEvent) => void;
	onHighlightHover: (
		backlinks: EpubBacklink[] | null,
		event: MouseEvent,
	) => void;
}

/**
 * Manages highlight rendering by directly injecting <mark> elements into the
 * EPUB iframe DOM via content hooks. Bypasses EPUB.js's unreliable annotations API.
 */
export class HighlightManager {
	private backlinkMap = new Map<string, EpubBacklink[]>();
	private hoveredCfi: string | null = null;

	constructor(
		private getRendition: () => Rendition | null,
		private palette: PaletteColor[],
		private opacity: number,
		private callbacks: HighlightCallbacks,
	) {
		this.registerContentHook();
	}

	applyBacklinks(backlinks: EpubBacklink[]): void {
		// Group by CFI range
		const grouped = new Map<string, EpubBacklink[]>();
		for (const bl of backlinks) {
			const existing = grouped.get(bl.cfiRange);
			if (existing) {
				existing.push(bl);
			} else {
				grouped.set(bl.cfiRange, [bl]);
			}
		}
		this.backlinkMap = grouped;

		// Re-render highlights in currently displayed content
		this.renderHighlightsInCurrentViews();
	}

	clearAll(): void {
		this.backlinkMap.clear();
		this.removeAllHighlightElements();
	}

	setHoverHighlight(cfiRange: string | null): void {
		if (this.hoveredCfi) {
			this.toggleHoverClass(this.hoveredCfi, false);
		}
		this.hoveredCfi = cfiRange;
		if (cfiRange) {
			this.toggleHoverClass(cfiRange, true);
		}
	}

	reattachHoverListeners(): void {
		// Called after EPUB.js renders new content
		this.renderHighlightsInCurrentViews();
	}

	updatePalette(palette: PaletteColor[]): void {
		this.palette = palette;
	}

	updateOpacity(opacity: number): void {
		this.opacity = opacity;
	}

	getBacklinksAtCfi(cfiRange: string): EpubBacklink[] {
		return this.backlinkMap.get(cfiRange) ?? [];
	}

	/**
	 * Register a hook that runs whenever EPUB.js renders a new section.
	 * This injects highlights into the freshly rendered DOM.
	 */
	private registerContentHook(): void {
		const rendition = this.getRendition();
		if (!rendition) return;

		rendition.hooks.content.register(
			(contents: Contents) => {
				// Small delay to ensure DOM is fully laid out
				setTimeout(() => {
					this.injectHighlightsIntoContents(contents);
				}, 50);
			},
		);
	}

	private renderHighlightsInCurrentViews(): void {
		const rendition = this.getRendition();
		if (!rendition) return;

		try {
			// getContents() returns the current Contents object(s)
			const contents = rendition.getContents();
			// contents can be a single object or array depending on EPUB.js version
			const contentsList = Array.isArray(contents)
				? contents
				: [contents];
			for (const c of contentsList) {
				if (c) {
					this.injectHighlightsIntoContents(
						c as unknown as Contents,
					);
				}
			}
		} catch {
			// Silently ignore
		}
	}

	private injectHighlightsIntoContents(contents: Contents): void {
		const doc = contents.document;
		if (!doc) return;

		// Remove previously injected highlights in this document
		const existing = doc.querySelectorAll(".epub-plus-hl");
		for (const el of Array.from(existing)) {
			const parent = el.parentNode;
			if (parent) {
				// Unwrap: move children out, remove the mark element
				while (el.firstChild) {
					parent.insertBefore(el.firstChild, el);
				}
				parent.removeChild(el);
			}
		}

		// Inject highlights for each backlink
		for (const [cfiRange, bls] of this.backlinkMap) {
			try {
				const range = contents.range(cfiRange);
				if (!range) continue;

				const color = bls[0]!.color;
				const hex = this.colorNameToHex(color);
				this.highlightRange(doc, range, cfiRange, hex, bls);
			} catch {
				// CFI doesn't resolve in this section — expected, skip
			}
		}

		// Inject styles if not already present
		this.injectHighlightStyles(doc);
	}

	private highlightRange(
		doc: Document,
		range: Range,
		cfiRange: string,
		hex: string,
		bls: EpubBacklink[],
	): void {
		// For ranges that span multiple elements, we need to walk the range
		// and wrap each text node segment individually
		const textNodes = this.getTextNodesInRange(range);

		for (const { node, startOffset, endOffset } of textNodes) {
			const mark = doc.createElement("mark");
			mark.className = "epub-plus-hl";
			mark.dataset["cfi"] = cfiRange;
			mark.setAttribute(
				"style",
				`background-color: ${hex}; opacity: ${this.opacity}; ` +
					"border-radius: 2px; cursor: pointer; " +
					"mix-blend-mode: multiply; padding: 0 1px;",
			);

			// Extract the highlighted portion of the text node
			const highlightRange = doc.createRange();
			highlightRange.setStart(node, startOffset);
			highlightRange.setEnd(node, endOffset);

			try {
				highlightRange.surroundContents(mark);
			} catch {
				// surroundContents fails if range crosses element boundaries
				// Fall back: wrap the extracted content
				const fragment = highlightRange.extractContents();
				mark.appendChild(fragment);
				highlightRange.insertNode(mark);
			}

			// Attach event listeners
			mark.addEventListener("click", (e) => {
				this.callbacks.onHighlightClick(bls, e);
			});
			mark.addEventListener("mouseenter", (e) => {
				this.callbacks.onHighlightHover(bls, e);
			});
			mark.addEventListener("mouseleave", (e) => {
				this.callbacks.onHighlightHover(null, e);
			});
		}
	}

	private getTextNodesInRange(
		range: Range,
	): { node: Text; startOffset: number; endOffset: number }[] {
		const results: {
			node: Text;
			startOffset: number;
			endOffset: number;
		}[] = [];

		if (
			range.startContainer === range.endContainer &&
			range.startContainer.nodeType === Node.TEXT_NODE
		) {
			// Simple case: range is within a single text node
			results.push({
				node: range.startContainer as Text,
				startOffset: range.startOffset,
				endOffset: range.endOffset,
			});
			return results;
		}

		// Walk through all text nodes in the range
		const walker = document.createTreeWalker(
			range.commonAncestorContainer,
			NodeFilter.SHOW_TEXT,
		);

		let node = walker.nextNode();
		let inRange = false;

		while (node) {
			if (node === range.startContainer) {
				inRange = true;
				results.push({
					node: node as Text,
					startOffset: range.startOffset,
					endOffset: (node as Text).length,
				});
			} else if (node === range.endContainer) {
				results.push({
					node: node as Text,
					startOffset: 0,
					endOffset: range.endOffset,
				});
				break;
			} else if (inRange) {
				results.push({
					node: node as Text,
					startOffset: 0,
					endOffset: (node as Text).length,
				});
			}
			node = walker.nextNode();
		}

		return results;
	}

	private toggleHoverClass(cfi: string, active: boolean): void {
		this.forEachDocument((doc) => {
			const marks = doc.querySelectorAll(
				`.epub-plus-hl[data-cfi="${CSS.escape(cfi)}"]`,
			);
			for (const el of Array.from(marks)) {
				el.classList.toggle("epub-plus-hl-hover", active);
			}
		});
	}

	private removeAllHighlightElements(): void {
		this.forEachDocument((doc) => {
			const marks = doc.querySelectorAll(".epub-plus-hl");
			for (const el of Array.from(marks)) {
				const parent = el.parentNode;
				if (parent) {
					while (el.firstChild) {
						parent.insertBefore(el.firstChild, el);
					}
					parent.removeChild(el);
				}
			}
		});
	}

	private injectHighlightStyles(doc: Document): void {
		if (doc.querySelector("#epub-plus-hl-styles")) return;

		const style = doc.createElement("style");
		style.id = "epub-plus-hl-styles";
		style.textContent = `
			.epub-plus-hl-hover {
				outline: 2px solid rgba(100, 150, 255, 0.8);
				outline-offset: 1px;
			}
		`;
		doc.head.appendChild(style);
	}

	private forEachDocument(fn: (doc: Document) => void): void {
		const rendition = this.getRendition();
		if (!rendition) return;

		try {
			const contents = rendition.getContents();
			const list = Array.isArray(contents) ? contents : [contents];
			for (const c of list) {
				if (c) {
					const doc = (c as unknown as { document: Document })
						.document;
					if (doc) fn(doc);
				}
			}
		} catch {
			// Silently ignore
		}
	}

	private colorNameToHex(name: string): string {
		const found = this.palette.find((c) => c.name === name);
		return found?.hex ?? "#ffd400";
	}
}
