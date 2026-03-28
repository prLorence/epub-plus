export interface ToolbarCallbacks {
	onPrev: () => void;
	onNext: () => void;
	onTocToggle: () => void;
	onFontSizeChange: (delta: number) => void;
}

export class ReaderToolbar {
	private progressEl: HTMLElement | null = null;
	private chapterEl: HTMLElement | null = null;

	constructor(
		private containerEl: HTMLElement,
		private callbacks: ToolbarCallbacks,
	) {
		this.render();
	}

	updateProgress(percent: number): void {
		if (this.progressEl) {
			this.progressEl.textContent =
				percent > 0 ? `${percent}%` : "";
		}
	}

	updateChapter(title: string): void {
		if (this.chapterEl) {
			this.chapterEl.textContent = title;
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

		// Left: Previous page
		this.createButton(left, "\u2190", "Previous page", () =>
			this.callbacks.onPrev(),
		);

		// Center: chapter name + progress
		this.chapterEl = center.createEl("span", {
			cls: "epub-plus-toolbar-chapter",
		});
		this.progressEl = center.createEl("span", {
			cls: "epub-plus-toolbar-progress",
		});

		// Right: font controls + next
		this.createButton(right, "A\u2212", "Decrease font size", () =>
			this.callbacks.onFontSizeChange(-1),
		);
		this.createButton(right, "A+", "Increase font size", () =>
			this.callbacks.onFontSizeChange(1),
		);
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
