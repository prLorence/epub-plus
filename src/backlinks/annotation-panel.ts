import { Platform } from "obsidian";
import type { EpubBacklink, PaletteColor } from "../types";
import { addLongPress } from "../reader/touch-utils";

export interface AnnotationPanelCallbacks {
	onAnnotationClick: (backlink: EpubBacklink) => void;
	onAnnotationHover: (backlink: EpubBacklink | null) => void;
	onColorChange: (backlink: EpubBacklink, newColor: string) => void;
}

/**
 * Annotation sidebar — shows all highlights for the current book,
 * grouped by chapter, with the actual highlighted text.
 * Distinct from BacklinkPanel which shows source note references.
 */
export class AnnotationPanel {
	private backlinks: EpubBacklink[] = [];
	private listEl: HTMLElement | null = null;
	private emptyEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;

	constructor(
		private containerEl: HTMLElement,
		private callbacks: AnnotationPanelCallbacks,
		private colorPalette: PaletteColor[],
	) {
		this.renderStructure();
	}

	setBacklinks(backlinks: EpubBacklink[]): void {
		this.backlinks = backlinks;
		this.rebuildList();
	}

	show(): void {
		this.containerEl.classList.add("is-visible");
	}

	hide(): void {
		this.containerEl.classList.remove("is-visible");
	}

	toggle(): void {
		this.containerEl.classList.toggle("is-visible");
	}

	private renderStructure(): void {
		this.containerEl.empty();

		const header = this.containerEl.createDiv({
			cls: "epub-plus-anno-header",
		});

		const headerLeft = header.createDiv({
			cls: "epub-plus-anno-header-left",
		});
		headerLeft.createEl("span", { text: "Annotations" });
		this.countEl = headerLeft.createEl("span", {
			cls: "epub-plus-anno-count",
			text: "0",
		});

		const closeBtn = header.createEl("button", {
			cls: "epub-plus-anno-close",
			text: "\u00d7",
		});
		closeBtn.addEventListener("click", () => this.hide());

		this.emptyEl = this.containerEl.createDiv({
			cls: "epub-plus-anno-empty",
			text: "No annotations yet. Highlight text to create one.",
		});

		this.listEl = this.containerEl.createDiv({
			cls: "epub-plus-anno-list",
		});
	}

	private rebuildList(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		const groups = this.groupByChapter(this.backlinks);

		for (const [chapter, bls] of groups) {
			if (groups.size > 1 || chapter) {
				this.listEl.createDiv({
					cls: "epub-plus-anno-chapter",
					text: chapter || "Unknown chapter",
				});
			}

			for (const bl of bls) {
				this.renderAnnotation(this.listEl, bl);
			}
		}

		const count = this.backlinks.length;
		if (this.countEl) {
			this.countEl.textContent = String(count);
		}
		this.emptyEl?.toggleClass("epub-plus-hidden", count > 0);
		this.listEl?.toggleClass("epub-plus-hidden", count === 0);
	}

	private renderAnnotation(parent: HTMLElement, bl: EpubBacklink): void {
		const entry = parent.createDiv({ cls: "epub-plus-anno-entry" });

		// Color stripe on the left
		const stripe = entry.createDiv({ cls: "epub-plus-anno-stripe" });
		stripe.style.backgroundColor = this.colorNameToHex(bl.color);

		// Right-click (desktop) or long-press (mobile) to change color
		stripe.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.showColorPicker(stripe, bl);
		});
		if (Platform.isMobile) {
			addLongPress(stripe, () => this.showColorPicker(stripe, bl));
		}

		const content = entry.createDiv({ cls: "epub-plus-anno-content" });

		// Highlighted text
		if (bl.text) {
			content.createEl("p", {
				cls: "epub-plus-anno-text",
				text: bl.text,
			});
		}

		// Source note
		const meta = content.createDiv({ cls: "epub-plus-anno-meta" });
		meta.createEl("span", {
			cls: "epub-plus-anno-source",
			text: bl.sourceDisplay,
		});
		if (bl.chapter) {
			meta.createEl("span", {
				cls: "epub-plus-anno-chapter-label",
				text: bl.chapter,
			});
		}

		// Click to navigate
		entry.addEventListener("click", () => {
			this.callbacks.onAnnotationClick(bl);
		});

		entry.addEventListener("mouseenter", () => {
			this.callbacks.onAnnotationHover(bl);
		});
		entry.addEventListener("mouseleave", () => {
			this.callbacks.onAnnotationHover(null);
		});
	}

	private showColorPicker(anchor: HTMLElement, bl: EpubBacklink): void {
		// Remove any existing picker
		const existing = this.containerEl.querySelector(".epub-plus-anno-color-picker");
		if (existing) existing.remove();

		const picker = this.containerEl.createDiv({
			cls: "epub-plus-anno-color-picker",
		});

		const rect = anchor.getBoundingClientRect();
		const containerRect = this.containerEl.getBoundingClientRect();
		picker.setCssProps({
			"position": "absolute",
			"top": `${rect.top - containerRect.top}px`,
			"left": `${rect.right - containerRect.left + 4}px`,
			"z-index": "10",
		});

		for (const color of this.colorPalette) {
			const swatch = picker.createDiv({ cls: "epub-plus-anno-swatch" });
			swatch.style.backgroundColor = color.hex;
			swatch.title = color.name;
			swatch.addEventListener("click", (e) => {
				e.stopPropagation();
				this.callbacks.onColorChange(bl, color.name);
				picker.remove();
			});
		}

		// Dismiss on click outside
		const dismiss = () => {
			picker.remove();
			document.removeEventListener("click", dismiss);
		};
		setTimeout(() => document.addEventListener("click", dismiss), 50);
	}

	private groupByChapter(
		backlinks: EpubBacklink[],
	): Map<string, EpubBacklink[]> {
		const groups = new Map<string, EpubBacklink[]>();
		for (const bl of backlinks) {
			const key = bl.chapter ?? "";
			const list = groups.get(key);
			if (list) {
				list.push(bl);
			} else {
				groups.set(key, [bl]);
			}
		}
		return groups;
	}

	private colorNameToHex(name: string): string {
		const found = this.colorPalette.find((c) => c.name === name);
		return found?.hex ?? "#ffd400";
	}
}
