import type { App } from "obsidian";
import type { EpubBacklink } from "../types";

export interface BacklinkPanelCallbacks {
	onEntryHover: (backlink: EpubBacklink | null) => void;
	onEntryClick: (backlink: EpubBacklink) => void;
}

export class BacklinkPanel {
	private backlinks: EpubBacklink[] = [];
	private currentHref = "";
	private currentChapterName = "";
	private filterByChapter = false;
	private hoveredEntry: HTMLElement | null = null;
	private entryMap = new Map<string, HTMLElement>();
	private countEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private emptyEl: HTMLElement | null = null;
	private filterBtn: HTMLElement | null = null;

	constructor(
		private app: App,
		private containerEl: HTMLElement,
		private callbacks: BacklinkPanelCallbacks,
	) {
		this.renderStructure();
	}

	setBacklinks(backlinks: EpubBacklink[]): void {
		this.backlinks = backlinks;
		this.rebuildList();
	}

	setCurrentChapter(href: string, chapterName?: string): void {
		if (
			this.currentHref === href &&
			this.currentChapterName === (chapterName ?? "")
		) {
			return;
		}
		this.currentHref = href;
		this.currentChapterName = chapterName ?? "";
		if (this.filterByChapter) {
			this.updateVisibility();
		}
	}

	setFilterByChapter(filter: boolean): void {
		this.filterByChapter = filter;
		this.updateVisibility();
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
		const key = `${sourcePath}:${line}`;
		const el = this.entryMap.get(key);
		if (el) {
			el.classList.add("is-hover");
			el.scrollIntoView({ block: "nearest" });
			this.hoveredEntry = el;
		}
	}

	clearHighlight(): void {
		if (this.hoveredEntry) {
			this.hoveredEntry.classList.remove("is-hover");
			this.hoveredEntry = null;
		}
	}

	/**
	 * Build the static shell (header, filter button, list container).
	 * Called once in constructor.
	 */
	private renderStructure(): void {
		this.containerEl.empty();

		const header = this.containerEl.createDiv({
			cls: "epub-plus-bl-header",
		});

		const headerLeft = header.createDiv({
			cls: "epub-plus-bl-header-left",
		});
		headerLeft.createEl("span", { text: "Backlinks" });

		this.countEl = headerLeft.createEl("span", {
			cls: "epub-plus-bl-count",
			text: "0",
		});

		const headerRight = header.createDiv({
			cls: "epub-plus-bl-header-right",
		});
		this.filterBtn = headerRight.createEl("button", {
			cls: "epub-plus-bl-filter-btn",
			title: "Filter by current chapter",
			text: "\u2261",
		});
		this.filterBtn.addEventListener("click", () => {
			this.filterByChapter = !this.filterByChapter;
			this.filterBtn?.classList.toggle(
				"is-active",
				this.filterByChapter,
			);
			this.updateVisibility();
		});

		const closeBtn = headerRight.createEl("button", {
			cls: "epub-plus-bl-close",
			text: "\u00d7",
		});
		closeBtn.addEventListener("click", () => this.hide());

		this.emptyEl = this.containerEl.createDiv({
			cls: "epub-plus-bl-empty",
			text: "No backlinks found.",
		});

		this.listEl = this.containerEl.createDiv({
			cls: "epub-plus-bl-list",
		});
	}

	/**
	 * Rebuild entries in the list when backlinks data changes.
	 */
	private rebuildList(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		this.entryMap.clear();

		const groups = this.groupByChapter(this.backlinks);

		for (const [chapter, bls] of groups) {
			if (groups.size > 1) {
				this.listEl.createDiv({
					cls: "epub-plus-bl-chapter-header",
					text: chapter || "Unknown chapter",
				});
			}

			for (const bl of bls) {
				this.renderEntry(this.listEl, bl);
			}
		}

		this.updateVisibility();
	}

	/**
	 * Show/hide entries based on chapter filter. No DOM rebuild.
	 */
	private updateVisibility(): void {
		const filtered = this.getFilteredBacklinks();
		const visibleKeys = new Set(
			filtered.map(
				(bl) => `${bl.sourcePath}:${bl.position.line}`,
			),
		);

		for (const [key, el] of this.entryMap) {
			el.style.display = visibleKeys.has(key) ? "" : "none";
		}

		// Update count
		if (this.countEl) {
			this.countEl.textContent = String(filtered.length);
		}

		// Show/hide empty message and list
		const hasVisible = filtered.length > 0;
		if (this.emptyEl) {
			this.emptyEl.style.display = hasVisible ? "none" : "";
		}
		if (this.listEl) {
			this.listEl.style.display = hasVisible ? "" : "none";
		}

		// Also hide chapter headers if all their entries are hidden
		if (this.listEl) {
			const headers = this.listEl.querySelectorAll(
				".epub-plus-bl-chapter-header",
			);
			for (let i = 0; i < headers.length; i++) {
				const header = headers[i]!;
				let next = header.nextElementSibling;
				let anyVisible = false;
				while (
					next &&
					!next.classList.contains(
						"epub-plus-bl-chapter-header",
					)
				) {
					if (
						(next as HTMLElement).style.display !== "none"
					) {
						anyVisible = true;
						break;
					}
					next = next.nextElementSibling;
				}
				(header as HTMLElement).style.display = anyVisible
					? ""
					: "none";
			}
		}
	}

	private renderEntry(parent: HTMLElement, bl: EpubBacklink): void {
		const entry = parent.createDiv({ cls: "epub-plus-bl-entry" });
		entry.dataset["source"] = bl.sourcePath;
		entry.dataset["line"] = String(bl.position.line);

		const key = `${bl.sourcePath}:${bl.position.line}`;
		this.entryMap.set(key, entry);

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
		if (!this.filterByChapter || !this.currentChapterName) {
			return this.backlinks;
		}

		const current = this.currentChapterName.toLowerCase();
		return this.backlinks.filter((bl) => {
			if (bl.chapter) {
				return bl.chapter.toLowerCase() === current;
			}
			return false;
		});
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
