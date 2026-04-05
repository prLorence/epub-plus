import { setIcon } from "obsidian";

export interface ToolbarCallbacks {
	onPrev: () => void;
	onNext: () => void;
	onTocToggle: () => void;
	onBacklinksToggle?: () => void;
	onAnnotationsToggle?: () => void;
	onSearchToggle?: () => void;
	onBookmark?: () => void;
	onFontSizeChange: (delta: number) => void;
	onGoBack?: () => void;
	onLinkNote?: () => void;
	onResetView?: () => void;
}

export class ReaderToolbar {
	private chapterEl: HTMLElement | null = null;
	private backBtn: HTMLElement | null = null;

	constructor(
		private containerEl: HTMLElement,
		private callbacks: ToolbarCallbacks,
	) {
		this.render();
	}

	updateChapter(title: string): void {
		if (this.chapterEl) {
			this.chapterEl.textContent = title;
		}
	}

	showBackButton(visible: boolean): void {
		if (this.backBtn) {
			this.backBtn.toggleClass("epub-plus-hidden", !visible);
		}
	}

	private render(): void {
		this.containerEl.empty();

		const left = this.containerEl.createDiv({
			cls: "epub-plus-toolbar-left",
		});
		const center = this.containerEl.createDiv({
			cls: "epub-plus-toolbar-center",
		});
		const right = this.containerEl.createDiv({
			cls: "epub-plus-toolbar-right",
		});

		// Left: TOC toggle
		this.createButton(left, "list", "Table of contents", () =>
			this.callbacks.onTocToggle(), true,
		);

		// Left: Back button (hidden until a link is followed)
		if (this.callbacks.onGoBack) {
			this.backBtn = this.createButton(
				left, "undo-2", "Go back (Alt+\u2190)",
				() => this.callbacks.onGoBack!(), true,
			);
			this.backBtn.addClass("epub-plus-hidden");
		}

		// Left: Previous page
		this.createButton(left, "chevron-left", "Previous page", () =>
			this.callbacks.onPrev(), true,
		);

		// Center: chapter name only
		this.chapterEl = center.createEl("span", {
			cls: "epub-plus-toolbar-chapter",
		});

		// Right: font controls
		this.createButton(right, "a-arrow-down", "Decrease font size", () =>
			this.callbacks.onFontSizeChange(-1), true,
		);
		this.createButton(right, "a-arrow-up", "Increase font size", () =>
			this.callbacks.onFontSizeChange(1), true,
		);

		if (this.callbacks.onSearchToggle) {
			this.createButton(right, "search", "Search in book (Ctrl+F)", () =>
				this.callbacks.onSearchToggle!(), true,
			);
		}

		if (this.callbacks.onBookmark) {
			this.createButton(right, "bookmark", "Bookmarks (Ctrl+D to add)", () =>
				this.callbacks.onBookmark!(), true,
			);
		}

		if (this.callbacks.onAnnotationsToggle) {
			this.createButton(right, "highlighter", "Toggle annotations", () =>
				this.callbacks.onAnnotationsToggle!(), true,
			);
		}

		if (this.callbacks.onBacklinksToggle) {
			this.createButton(right, "link", "Toggle backlinks panel", () =>
				this.callbacks.onBacklinksToggle!(), true,
			);
		}

		if (this.callbacks.onResetView) {
			this.createButton(right, "refresh-cw", "Reset view", () =>
				this.callbacks.onResetView!(), true,
			);
		}

		if (this.callbacks.onLinkNote) {
			this.createButton(right, "file-symlink", "Link companion note", () =>
				this.callbacks.onLinkNote!(), true,
			);
		}

		// Right: Next page
		this.createButton(right, "chevron-right", "Next page", () =>
			this.callbacks.onNext(), true,
		);
	}

	private createButton(
		parent: HTMLElement,
		iconOrText: string,
		title: string,
		onClick: () => void,
		useIcon = false,
	): HTMLElement {
		const btn = parent.createEl("button", {
			cls: "epub-plus-toolbar-btn",
			title,
		});
		if (useIcon) {
			setIcon(btn, iconOrText);
		} else {
			btn.textContent = iconOrText;
		}
		btn.addEventListener("click", onClick);
		return btn;
	}
}
