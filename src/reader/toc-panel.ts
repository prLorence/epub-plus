import type { NavItem } from "epubjs";

export class TocPanel {
	private visible = false;
	private activeHref = "";

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
		this.activeHref = href;
		this.updateActiveState();
	}

	private render(): void {
		this.containerEl.empty();

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
			entry.dataset["href"] = item.href.split("#")[0];
			entry.createEl("span", { text: item.label.trim() });
			entry.addEventListener("click", () => {
				this.onNavigate(item.href);
			});

			if (item.subitems && item.subitems.length > 0) {
				this.renderItems(parent, item.subitems, depth + 1);
			}
		}
	}

	private updateActiveState(): void {
		const items =
			this.containerEl.querySelectorAll(".epub-plus-toc-item");
		for (const el of Array.from(items)) {
			const href = (el as HTMLElement).dataset["href"] ?? "";
			if (
				this.activeHref === href ||
				this.activeHref.endsWith(href)
			) {
				el.classList.add("is-active");
			} else {
				el.classList.remove("is-active");
			}
		}
	}
}
