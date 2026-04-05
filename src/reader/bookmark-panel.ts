import { Platform } from "obsidian";
import { addLongPress } from "./touch-utils";

export interface Bookmark {
	cfi: string;
	label: string;
	created: string;
}

export interface BookmarkPanelCallbacks {
	onBookmarkClick: (bookmark: Bookmark) => void;
	onBookmarkDelete: (bookmark: Bookmark) => void;
	onBookmarkAdd?: () => void;
}

/**
 * Panel showing all bookmarks for the current book.
 * Click a bookmark to jump to it, right-click to delete.
 */
export class BookmarkPanel {
	private bookmarks: Bookmark[] = [];
	private listEl: HTMLElement | null = null;
	private emptyEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;

	constructor(
		private containerEl: HTMLElement,
		private callbacks: BookmarkPanelCallbacks,
	) {
		this.renderStructure();
	}

	setBookmarks(bookmarks: Bookmark[]): void {
		this.bookmarks = [...bookmarks];
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
			cls: "epub-plus-bm-header",
		});

		const headerLeft = header.createDiv({
			cls: "epub-plus-anno-header-left",
		});
		headerLeft.createEl("span", { text: "Bookmarks" });
		this.countEl = headerLeft.createEl("span", {
			cls: "epub-plus-anno-count",
			text: "0",
		});

		const headerRight = header.createDiv({
			cls: "epub-plus-bm-header-right",
		});

		if (this.callbacks.onBookmarkAdd) {
			const addBtn = headerRight.createEl("button", {
				cls: "epub-plus-anno-close",
				text: "+",
				title: "Add bookmark at current position",
			});
			addBtn.addEventListener("click", () => this.callbacks.onBookmarkAdd?.());
		}

		const closeBtn = headerRight.createEl("button", {
			cls: "epub-plus-anno-close",
			text: "\u00d7",
		});
		closeBtn.addEventListener("click", () => this.hide());

		this.emptyEl = this.containerEl.createDiv({
			cls: "epub-plus-anno-empty",
			text: "No bookmarks yet. Press Ctrl+D to add one.",
		});

		this.listEl = this.containerEl.createDiv({
			cls: "epub-plus-bm-list",
		});
	}

	private rebuildList(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		// Sort by creation date (newest first)
		const sorted = [...this.bookmarks].sort(
			(a, b) => b.created.localeCompare(a.created),
		);

		for (const bm of sorted) {
			const entry = this.listEl.createDiv({ cls: "epub-plus-bm-entry" });

			entry.createDiv({
				cls: "epub-plus-bm-label",
				text: bm.label,
			});

			const date = new Date(bm.created);
			entry.createDiv({
				cls: "epub-plus-bm-date",
				text: date.toLocaleDateString(undefined, {
					month: "short",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit",
				}),
			});

			entry.addEventListener("click", () => {
				this.callbacks.onBookmarkClick(bm);
			});

			entry.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				this.callbacks.onBookmarkDelete(bm);
			});
			if (Platform.isMobile) {
				addLongPress(entry, () => this.callbacks.onBookmarkDelete(bm));
			}
		}

		const count = this.bookmarks.length;
		if (this.countEl) this.countEl.textContent = String(count);
		this.emptyEl?.toggleClass("epub-plus-hidden", count > 0);
		this.listEl?.toggleClass("epub-plus-hidden", count === 0);
	}
}
