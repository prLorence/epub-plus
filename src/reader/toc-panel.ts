import type { NavItem } from "epubjs";

export class TocPanel {
	private visible = false;
	private activeHref = "";
	private hrefMap = new Map<string, HTMLElement>();
	private activeEl: HTMLElement | null = null;

	constructor(
		private containerEl: HTMLElement,
		private toc: NavItem[],
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

	setActiveHref(href: string): void {
		if (this.activeHref === href) return;
		this.activeHref = href;
		this.updateActiveState();
	}

	private render(): void {
		this.containerEl.empty();
		this.hrefMap.clear();
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
		items: NavItem[],
		depth: number,
	): void {
		for (const item of items) {
			const entry = parent.createDiv({
				cls: "epub-plus-toc-item",
			});
			entry.style.paddingLeft = `${12 + depth * 16}px`;
			const itemHref = item.href.split("#")[0] ?? "";
			entry.dataset["href"] = itemHref;
			entry.createEl("span", { text: item.label.trim() });
			entry.addEventListener("click", () => {
				this.onNavigate(item.href);
			});

			// Index by href for O(1) lookups
			if (itemHref) {
				this.hrefMap.set(itemHref, entry);
			}

			if (item.subitems && item.subitems.length > 0) {
				this.renderItems(parent, item.subitems, depth + 1);
			}
		}
	}

	private updateActiveState(): void {
		// Remove old active
		if (this.activeEl) {
			this.activeEl.classList.remove("is-active");
			this.activeEl = null;
		}

		if (!this.activeHref) return;

		// Try exact match first
		let el = this.hrefMap.get(this.activeHref);

		// Try suffix match if exact fails
		if (!el) {
			for (const [href, entry] of this.hrefMap) {
				if (this.activeHref.endsWith(href)) {
					el = entry;
					break;
				}
			}
		}

		if (el) {
			el.classList.add("is-active");
			this.activeEl = el;
		}
	}
}
