export interface ToolbarCallbacks {
	onPrev: () => void;
	onNext: () => void;
	onTocToggle: () => void;
	onBacklinksToggle?: () => void;
	onAnnotationsToggle?: () => void;
	onFontSizeChange: (delta: number) => void;
	onGoBack?: () => void;
	onLinkNote?: () => void;
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
		this.createButton(left, "\u2630", "Table of contents", () =>
			this.callbacks.onTocToggle(),
		);

		// Left: Back button (hidden until a link is followed)
		if (this.callbacks.onGoBack) {
			this.backBtn = this.createButton(
				left,
				"\u21A9",
				"Go back (Alt+\u2190)",
				() => this.callbacks.onGoBack!(),
			);
			this.backBtn.addClass("epub-plus-hidden");
		}

		// Left: Previous page
		this.createButton(left, "\u2190", "Previous page", () =>
			this.callbacks.onPrev(),
		);

		// Center: chapter name only
		this.chapterEl = center.createEl("span", {
			cls: "epub-plus-toolbar-chapter",
		});

		// Right: font controls, backlinks toggle, next
		this.createButton(right, "A\u2212", "Decrease font size", () =>
			this.callbacks.onFontSizeChange(-1),
		);
		this.createButton(right, "A+", "Increase font size", () =>
			this.callbacks.onFontSizeChange(1),
		);

		if (this.callbacks.onBacklinksToggle) {
			this.createButton(
				right,
				"\u{1F517}",
				"Toggle backlinks panel",
				() => this.callbacks.onBacklinksToggle!(),
			);
		}

		if (this.callbacks.onAnnotationsToggle) {
			this.createButton(
				right,
				"\u{1F5D2}",
				"Toggle annotations",
				() => this.callbacks.onAnnotationsToggle!(),
			);
		}

		if (this.callbacks.onLinkNote) {
			this.createButton(
				right,
				"\u{1F4CE}",
				"Link companion note",
				() => this.callbacks.onLinkNote!(),
			);
		}

		this.createButton(right, "\u2192", "Next page", () =>
			this.callbacks.onNext(),
		);
	}

	private createButton(
		parent: HTMLElement,
		text: string,
		title: string,
		onClick: () => void,
	): HTMLElement {
		const btn = parent.createEl("button", {
			cls: "epub-plus-toolbar-btn",
			text,
			title,
		});
		btn.addEventListener("click", onClick);
		return btn;
	}
}
