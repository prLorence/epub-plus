import type { Rendition } from "epubjs";
import type { EpubBacklink, PaletteColor } from "../types";

export interface HighlightCallbacks {
	onHighlightClick: (backlinks: EpubBacklink[], event: MouseEvent) => void;
	onHighlightHover: (
		backlinks: EpubBacklink[] | null,
		event: MouseEvent,
	) => void;
}

/**
 * Manages highlight rendering using rendition.annotations.highlight()
 * following the pattern from the epub.js highlights example.
 *
 * Key: highlights are styled via rendition.themes.default() using the
 * '.epubjs-hl' class, and CFI ranges are passed directly as returned
 * by the 'selected' event.
 */
export class HighlightManager {
	private backlinkMap = new Map<string, EpubBacklink[]>();
	private appliedCfis = new Set<string>();
	private hoveredCfi: string | null = null;
	private stylesApplied = false;

	constructor(
		private getRendition: () => Rendition | null,
		private palette: PaletteColor[],
		private opacity: number,
		private callbacks: HighlightCallbacks,
	) {}

	/**
	 * Apply highlight styles via rendition.themes.default().
	 * Must be called after the rendition is created and before highlights are applied.
	 */
	applyHighlightStyles(): void {
		const rendition = this.getRendition();
		if (!rendition || this.stylesApplied) return;

		rendition.themes.default({
			".epubjs-hl": {
				fill: "yellow",
				"fill-opacity": String(this.opacity),
				"mix-blend-mode": "multiply",
			},
			"::selection": {
				background: "rgba(255,255,0, 0.3)",
			},
		});
		this.stylesApplied = true;
	}

	applyBacklinks(backlinks: EpubBacklink[]): void {
		const rendition = this.getRendition();
		if (!rendition) return;

		this.applyHighlightStyles();

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

		// Remove stale highlights
		for (const cfi of this.appliedCfis) {
			if (!grouped.has(cfi)) {
				try {
					rendition.annotations.remove(cfi, "highlight");
				} catch {
					// ignore
				}
				this.appliedCfis.delete(cfi);
			}
		}

		// Add new highlights
		for (const [cfi, bls] of grouped) {
			if (!this.appliedCfis.has(cfi)) {
				try {
					const color = bls[0]!.color;
					const hex = this.colorNameToHex(color);

					rendition.annotations.highlight(
						cfi,
						{ backlinks: bls },
						(e: MouseEvent) => {
							this.callbacks.onHighlightClick(bls, e);
						},
						"epubjs-hl",
						{
							fill: hex,
							"fill-opacity": String(this.opacity),
							"mix-blend-mode": "multiply",
						},
					);
					this.appliedCfis.add(cfi);
				} catch {
					// CFI may not resolve — skip
				}
			}
		}

		this.backlinkMap = grouped;
	}

	clearAll(): void {
		const rendition = this.getRendition();
		if (!rendition) return;

		for (const cfi of this.appliedCfis) {
			try {
				rendition.annotations.remove(cfi, "highlight");
			} catch {
				// ignore
			}
		}
		this.appliedCfis.clear();
		this.backlinkMap.clear();
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
		// Annotations API handles re-injection on page turns automatically
		// No manual re-attach needed
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

	private toggleHoverClass(cfi: string, active: boolean): void {
		this.forEachDocument((doc) => {
			// EPUB.js highlight elements use the 'epubjs-hl' class
			const els = doc.querySelectorAll(".epubjs-hl");
			for (const el of Array.from(els)) {
				// EPUB.js stores the CFI in a data attribute or the ref
				el.classList.toggle("epubjs-hl-hover", active);
			}
		});
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
			// ignore
		}
	}

	private colorNameToHex(name: string): string {
		const found = this.palette.find((c) => c.name === name);
		return found?.hex ?? "#ffd400";
	}
}
