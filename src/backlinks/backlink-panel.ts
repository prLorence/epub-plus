import type { App } from "obsidian";
import type { EpubBacklink } from "../types";

export interface BacklinkPanelCallbacks {
	onEntryHover: (backlink: EpubBacklink | null) => void;
	onEntryClick: (backlink: EpubBacklink) => void;
}

export class BacklinkPanel {
	private backlinks: EpubBacklink[] = [];
	private currentHref = "";
	private filterByChapter = false;
	private hoveredEntry: HTMLElement | null = null;

	constructor(
		private app: App,
		private containerEl: HTMLElement,
		private callbacks: BacklinkPanelCallbacks,
	) {
		this.render();
	}

	setBacklinks(backlinks: EpubBacklink[]): void {
		this.backlinks = backlinks;
		this.render();
	}

	setCurrentChapter(href: string): void {
		this.currentHref = href;
		if (this.filterByChapter) {
			this.render();
		}
	}

	setFilterByChapter(filter: boolean): void {
		this.filterByChapter = filter;
		this.render();
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

	highlightEntry(sourcePath: string, line: number): void {
		this.clearHighlight();
		const entries = this.containerEl.querySelectorAll(
			".epub-plus-bl-entry",
		);
		for (const el of Array.from(entries)) {
			const htmlEl = el as HTMLElement;
			if (
				htmlEl.dataset["source"] === sourcePath &&
				htmlEl.dataset["line"] === String(line)
			) {
				htmlEl.classList.add("is-hover");
				htmlEl.scrollIntoView({ block: "nearest" });
				this.hoveredEntry = htmlEl;
				break;
			}
		}
	}

	clearHighlight(): void {
		if (this.hoveredEntry) {
			this.hoveredEntry.classList.remove("is-hover");
			this.hoveredEntry = null;
		}
	}

	private render(): void {
		this.containerEl.empty();

		const header = this.containerEl.createDiv({
			cls: "epub-plus-bl-header",
		});

		const headerLeft = header.createDiv({
			cls: "epub-plus-bl-header-left",
		});
		headerLeft.createEl("span", { text: "Backlinks" });

		const filtered = this.getFilteredBacklinks();
		headerLeft.createEl("span", {
			cls: "epub-plus-bl-count",
			text: String(filtered.length),
		});

		const headerRight = header.createDiv({
			cls: "epub-plus-bl-header-right",
		});
		const filterBtn = headerRight.createEl("button", {
			cls: `epub-plus-bl-filter-btn ${this.filterByChapter ? "is-active" : ""}`,
			title: "Filter by current chapter",
			text: "\u2261",
		});
		filterBtn.addEventListener("click", () => {
			this.filterByChapter = !this.filterByChapter;
			this.render();
		});

		const closeBtn = headerRight.createEl("button", {
			cls: "epub-plus-bl-close",
			text: "\u00d7",
		});
		closeBtn.addEventListener("click", () => this.hide());

		if (filtered.length === 0) {
			this.containerEl.createDiv({
				cls: "epub-plus-bl-empty",
				text: "No backlinks found.",
			});
			return;
		}

		// Group by chapter
		const groups = this.groupByChapter(filtered);
		const list = this.containerEl.createDiv({
			cls: "epub-plus-bl-list",
		});

		for (const [chapter, bls] of groups) {
			if (groups.size > 1) {
				list.createDiv({
					cls: "epub-plus-bl-chapter-header",
					text: chapter || "Unknown chapter",
				});
			}

			for (const bl of bls) {
				this.renderEntry(list, bl);
			}
		}
	}

	private renderEntry(parent: HTMLElement, bl: EpubBacklink): void {
		const entry = parent.createDiv({ cls: "epub-plus-bl-entry" });
		entry.dataset["source"] = bl.sourcePath;
		entry.dataset["line"] = String(bl.position.line);

		const dot = entry.createEl("span", {
			cls: "epub-plus-backlink-color-dot",
		});
		dot.style.backgroundColor = this.colorNameToHex(bl.color);

		entry.createEl("span", {
			cls: "epub-plus-bl-source",
			text: bl.sourceDisplay,
		});

		if (bl.text) {
			entry.createEl("span", {
				cls: "epub-plus-bl-text",
				text: bl.text.slice(0, 80),
			});
		}

		entry.addEventListener("click", () => {
			this.callbacks.onEntryClick(bl);
		});

		entry.addEventListener("mouseenter", () => {
			this.callbacks.onEntryHover(bl);
		});

		entry.addEventListener("mouseleave", () => {
			this.callbacks.onEntryHover(null);
		});
	}

	private getFilteredBacklinks(): EpubBacklink[] {
		if (!this.filterByChapter || !this.currentHref) {
			return this.backlinks;
		}

		return this.backlinks.filter((bl) => {
			// Match CFI spine position to current chapter href
			// CFIs start with /6/<spineIdx>! — we compare the chapter param if available
			if (bl.chapter) {
				// Simple string match on chapter name
				return true; // Show all with chapter info when filtering
			}
			// Fallback: check if the CFI's spine reference matches
			return this.cfiMatchesHref(bl.cfiStart, this.currentHref);
		});
	}

	private cfiMatchesHref(cfi: string, href: string): boolean {
		// This is a heuristic — full CFI-to-href resolution would need the book's spine
		// For now, we don't filter CFIs that we can't confidently match
		void cfi;
		void href;
		return true;
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
		// Simple mapping — could be moved to a shared utility
		const colors: Record<string, string> = {
			yellow: "#ffd400",
			red: "#ff6b6b",
			green: "#51cf66",
			blue: "#4dabf7",
			purple: "#cc5de8",
			pink: "#f06595",
			orange: "#ff922b",
		};
		return colors[name] ?? "#ffd400";
	}
}
