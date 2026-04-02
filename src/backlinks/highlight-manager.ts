import { Platform } from "obsidian";
import type { IRendition } from "../engine/types";
import { addLongPress } from "../reader/touch-utils";
import type { EpubBacklink, PaletteColor } from "../types";

export interface HighlightCallbacks {
	onHighlightClick: (backlinks: EpubBacklink[], event: MouseEvent) => void;
	onHighlightHover: (
		backlinks: EpubBacklink[] | null,
		event: MouseEvent,
	) => void;
	onHighlightContextMenu?: (backlinks: EpubBacklink[], event: MouseEvent) => void;
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
		private getRendition: () => IRendition | null,
		private palette: PaletteColor[],
		private opacity: number,
		private callbacks: HighlightCallbacks,
	) {}

	/**
	 * Apply highlight styles via rendition.themes.default().
	 * Must be called after the rendition is created and before highlights are applied.
	 */
	applyBacklinks(backlinks: EpubBacklink[]): void {
		const rendition = this.getRendition();
		if (!rendition) return;

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
				rendition.removeHighlight(cfi);
				this.appliedCfis.delete(cfi);
			}
		}

		// Add new highlights
		for (const [cfi, bls] of grouped) {
			if (!this.appliedCfis.has(cfi)) {
				try {
					const color = bls[0]!.color;
					const hex = this.colorNameToHex(color);

					rendition.addHighlight(
						cfi,
						{ backlinks: bls },
						hex,
						this.opacity,
						(e: MouseEvent) => {
							this.callbacks.onHighlightClick(bls, e);
						},
					);
					this.appliedCfis.add(cfi);
				} catch {
					// CFI may not resolve — skip
				}
			}
		}

		this.backlinkMap = grouped;

		// Attach contextmenu listeners for right-click color change
		if (this.callbacks.onHighlightContextMenu) {
			this.attachContextMenuListeners();
		}
	}

	/**
	 * Attach right-click listeners to highlight elements in the content.
	 * Must be called after highlights are applied.
	 */
	private attachContextMenuListeners(): void {
		const rendition = this.getRendition();
		if (!rendition) return;

		for (const content of rendition.getContents()) {
			const hlElements = content.document.querySelectorAll(".epubjs-hl");
			for (let i = 0; i < hlElements.length; i++) {
				const el = hlElements[i] as HTMLElement;
				// Avoid double-binding
				if (el.dataset["ctxBound"]) continue;
				el.dataset["ctxBound"] = "1";

				el.addEventListener("contextmenu", (e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					const cfi = el.getAttribute("data-epubcfi") ?? "";
					const bls = this.backlinkMap.get(cfi);
					if (bls && this.callbacks.onHighlightContextMenu) {
						this.callbacks.onHighlightContextMenu(bls, e);
					}
				});
				if (Platform.isMobile) {
					addLongPress(el, (touch) => {
						const cfi = el.getAttribute("data-epubcfi") ?? "";
						const bls = this.backlinkMap.get(cfi);
						if (bls && this.callbacks.onHighlightContextMenu) {
							this.callbacks.onHighlightContextMenu(bls, new MouseEvent("contextmenu", {
								clientX: touch.clientX,
								clientY: touch.clientY,
							}));
						}
					});
				}
			}
		}
	}

	clearAll(): void {
		const rendition = this.getRendition();
		if (!rendition) return;

		for (const cfi of this.appliedCfis) {
			rendition.removeHighlight(cfi);
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
		const rendition = this.getRendition();
		if (!rendition) return;

		// Search content documents for highlight elements matching this CFI
		try {
			for (const content of rendition.getContents()) {
				const encodedCfi = encodeURI(cfi);
				const el: HTMLElement | null = content.document.querySelector(
					`[data-epubcfi="${encodedCfi}"]`,
				);
				if (el) {
					el.classList.toggle("epubjs-hl-hover", active);
					return;
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
