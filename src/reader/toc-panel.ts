import type { TocItem } from "../engine/types";

export class TocPanel {
	private visible = false;
	private activeHref = "";
	/** Full href (with fragment) → element */
	private hrefMap = new Map<string, HTMLElement>();
	/** Base href (no fragment) → all entries for that file, in TOC order */
	private baseHrefEntries = new Map<string, HTMLElement[]>();
	/** Filename only → first element */
	private filenameMap = new Map<string, HTMLElement>();
	/** Tracks which TOC entry was last clicked by the user */
	private lastClickedEl: HTMLElement | null = null;
	private activeEl: HTMLElement | null = null;

	constructor(
		private containerEl: HTMLElement,
		private toc: TocItem[],
		private onNavigate: (href: string) => void,
	) {
		this.render();
	}

	show(): void {
		this.visible = true;
		this.containerEl.classList.add("is-visible");
	}

	hide(): void {
		this.visible = false;
		this.containerEl.classList.remove("is-visible");
	}

	toggle(): void {
		if (this.visible) {
			this.hide();
		} else {
			this.show();
		}
	}

	/**
	 * Update the active TOC item based on the current location.
	 * @param href - The current spine item href from EPUB.js (no fragment)
	 * @param contentDoc - The rendered section's document, used to find
	 *                     which sub-section anchor is currently visible.
	 */
	setActiveHref(href: string, contentDoc?: Document): void {
		// Always re-evaluate even if href is the same — the visible
		// sub-section within the same file may have changed.
		this.activeHref = href;
		this.updateActiveState(contentDoc);
	}

	private render(): void {
		this.containerEl.empty();
		this.hrefMap.clear();
		this.baseHrefEntries.clear();
		this.filenameMap.clear();
		this.lastClickedEl = null;
		this.activeEl = null;

		const header = this.containerEl.createDiv({
			cls: "epub-plus-toc-header",
		});
		header.createEl("span", { text: "Table of contents" });

		const closeBtn = header.createEl("button", {
			cls: "epub-plus-toc-close",
			text: "\u00d7",
		});
		closeBtn.addEventListener("click", () => this.hide());

		const list = this.containerEl.createDiv({
			cls: "epub-plus-toc-list",
		});

		this.renderItems(list, this.toc, 0);
	}

	private renderItems(
		parent: HTMLElement,
		items: TocItem[],
		depth: number,
	): void {
		for (const item of items) {
			const entry = parent.createDiv({
				cls: "epub-plus-toc-item",
			});
			entry.style.paddingLeft = `${12 + depth * 16}px`;
			entry.dataset["href"] = item.href;
			entry.createEl("span", { text: item.label.trim() });
			entry.addEventListener("click", () => {
				this.lastClickedEl = entry;
				this.onNavigate(item.href);
			});

			if (item.href) {
				this.hrefMap.set(item.href, entry);
				const baseHref = item.href.split("#")[0] ?? "";
				if (baseHref) {
					let list = this.baseHrefEntries.get(baseHref);
					if (!list) {
						list = [];
						this.baseHrefEntries.set(baseHref, list);
					}
					list.push(entry);
				}
				const filename = this.extractFilename(baseHref);
				if (filename && !this.filenameMap.has(filename)) {
					this.filenameMap.set(filename, entry);
				}
			}

			if (item.children && item.children.length > 0) {
				this.renderItems(parent, item.children, depth + 1);
			}
		}
	}

	private updateActiveState(contentDoc?: Document): void {
		if (this.activeEl) {
			this.activeEl.classList.remove("is-active");
			this.activeEl = null;
		}

		if (!this.activeHref) return;

		// 1. Exact match on full href (with fragment)
		let el = this.hrefMap.get(this.activeHref);

		if (!el) {
			const baseHref = this.activeHref.split("#")[0] ?? "";
			const entries = this.baseHrefEntries.get(baseHref)
				?? this.baseHrefEntries.get(this.activeHref);

			if (entries && entries.length > 0) {
				if (entries.length === 1) {
					// Only one TOC entry for this file — use it
					el = entries[0];
				} else if (contentDoc) {
					// 2. Multiple entries for same file — find which
					//    sub-section anchor is closest to the current
					//    scroll position (last anchor above the viewport).
					el = this.findVisibleEntry(entries, contentDoc);
				}

				// 3. Fallback to clicked entry or first entry
				if (!el) {
					el = (this.lastClickedEl && entries.includes(this.lastClickedEl))
						? this.lastClickedEl
						: entries[0];
				}
			}
		}

		// 4. Filename fallback
		if (!el) {
			const filename = this.extractFilename(this.activeHref);
			el = this.filenameMap.get(filename);
		}

		if (el) {
			el.classList.add("is-active");
			this.activeEl = el;
			el.scrollIntoView({ block: "nearest" });
		}
	}

	/**
	 * Given multiple TOC entries for the same file, find the one whose
	 * anchor is closest to (but not past) the current viewport.
	 */
	private findVisibleEntry(
		entries: HTMLElement[],
		contentDoc: Document,
	): HTMLElement | undefined {
		let best: HTMLElement | undefined;

		for (const entry of entries) {
			const href = entry.dataset["href"] ?? "";
			const fragment = href.split("#")[1];
			if (!fragment) {
				// Entry with no fragment = start of file, always a valid fallback
				best = entry;
				continue;
			}

			const anchor = contentDoc.getElementById(fragment);
			if (!anchor) continue;

			const rect = anchor.getBoundingClientRect();
			// Anchor is above or at the top of the viewport — it's been scrolled past
			if (rect.top <= 10) {
				best = entry;
			} else if (!best) {
				// First anchor that's visible (below viewport top) — use it
				// only if we haven't found anything better
				best = entry;
			}
		}

		return best;
	}

	private extractFilename(href: string): string {
		return href.split("/").pop() ?? href;
	}
}
