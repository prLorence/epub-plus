import type { IBookEngine, TocItem } from "../engine/types";

export interface SearchResult {
	href: string;
	excerpt: string;
	chapter: string;
	sectionIndex: number;
}

export interface SearchPanelCallbacks {
	onResultClick: (result: SearchResult) => void;
	onClose: () => void;
}

/**
 * Full-text search panel for EPUB books.
 * Searches across all sections using the engine's archive.
 */
export class SearchPanel {
	private inputEl: HTMLInputElement | null = null;
	private resultsEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private searchTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private containerEl: HTMLElement,
		private engine: IBookEngine,
		private callbacks: SearchPanelCallbacks,
	) {
		this.render();
	}

	show(): void {
		this.containerEl.classList.add("is-visible");
		setTimeout(() => this.inputEl?.focus(), 50);
	}

	hide(): void {
		this.containerEl.classList.remove("is-visible");
	}

	toggle(): void {
		if (this.containerEl.classList.contains("is-visible")) {
			this.hide();
		} else {
			this.show();
		}
	}

	private render(): void {
		this.containerEl.empty();

		const header = this.containerEl.createDiv({ cls: "epub-plus-search-header" });

		this.inputEl = header.createEl("input", {
			cls: "epub-plus-search-input",
			attr: { type: "text", placeholder: "Search in book..." },
		});

		this.countEl = header.createEl("span", {
			cls: "epub-plus-search-count",
		});

		const closeBtn = header.createEl("button", {
			cls: "epub-plus-anno-close",
			text: "\u00d7",
		});
		closeBtn.addEventListener("click", () => {
			this.hide();
			this.callbacks.onClose();
		});

		this.resultsEl = this.containerEl.createDiv({
			cls: "epub-plus-search-results",
		});

		this.inputEl.addEventListener("input", () => {
			if (this.searchTimer) clearTimeout(this.searchTimer);
			this.searchTimer = setTimeout(() => {
				this.searchTimer = null;
				void this.performSearch(this.inputEl?.value ?? "");
			}, 300);
		});

		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				this.hide();
				this.callbacks.onClose();
			}
			e.stopPropagation();
		});
	}

	private async performSearch(query: string): Promise<void> {
		if (!this.resultsEl) return;
		this.resultsEl.empty();

		if (query.length < 2) {
			if (this.countEl) this.countEl.textContent = "";
			return;
		}

		const toc = await this.engine.getToc();
		const archive = this.engine.getArchive();
		if (!archive) {
			if (this.countEl) this.countEl.textContent = "Search unavailable";
			return;
		}

		const results: SearchResult[] = [];
		const queryLower = query.toLowerCase();

		// Use spine hrefs (covers all sections) with TOC labels for display
		const spineHrefs = this.engine.getSpineHrefs();
		const tocLabelMap = this.buildTocLabelMap(toc);
		const filesToSearch = spineHrefs.map((href, i) => ({
			href,
			label: tocLabelMap.get(href.split("#")[0] ?? "") ?? `Section ${i + 1}`,
		}));

		for (let i = 0; i < filesToSearch.length; i++) {
			const { href, label } = filesToSearch[i]!;
			const baseHref = href.split("#")[0] ?? "";
			if (!baseHref) continue;

			try {
				// Try fetching from the archive with multiple path resolutions
				let xhtml: string | null = null;
				for (const candidate of [baseHref, baseHref.replace(/^.*?\//, "")]) {
					try {
						const result = await archive.request(candidate, "text");
						if (result && typeof result === "string" && result.length > 50) {
							xhtml = result;
							break;
						}
					} catch {
						// Try next candidate
					}
				}

				if (!xhtml) continue;

				const parser = new DOMParser();
				const doc = parser.parseFromString(xhtml, "application/xhtml+xml");
				const text = doc.body?.textContent ?? "";
				const textLower = text.toLowerCase();

				let pos = 0;
				while ((pos = textLower.indexOf(queryLower, pos)) !== -1) {
					const start = Math.max(0, pos - 40);
					const end = Math.min(text.length, pos + query.length + 40);
					let excerpt = text.slice(start, end).trim();
					if (start > 0) excerpt = "..." + excerpt;
					if (end < text.length) excerpt = excerpt + "...";

					results.push({
						href: baseHref,
						excerpt,
						chapter: label,
						sectionIndex: i,
					});

					pos += query.length;
					if (results.length > 100) break;
				}
			} catch {
				// Section not loadable
			}

			if (results.length > 100) break;
		}

		if (this.countEl) {
			this.countEl.textContent = results.length > 100
				? "100+ results"
				: `${results.length} result${results.length === 1 ? "" : "s"}`;
		}

		// Render results
		for (const result of results) {
			const entry = this.resultsEl.createDiv({ cls: "epub-plus-search-result" });

			entry.createDiv({
				cls: "epub-plus-search-chapter",
				text: result.chapter,
			});

			const excerptEl = entry.createDiv({ cls: "epub-plus-search-excerpt" });
			// Highlight the query in the excerpt
			this.highlightText(excerptEl, result.excerpt, query);

			entry.addEventListener("click", () => {
				this.callbacks.onResultClick(result);
			});
		}
	}

	private highlightText(el: HTMLElement, text: string, query: string): void {
		const lowerText = text.toLowerCase();
		const lowerQuery = query.toLowerCase();
		let lastIdx = 0;
		let idx = lowerText.indexOf(lowerQuery);

		while (idx !== -1) {
			if (idx > lastIdx) {
				el.appendText(text.slice(lastIdx, idx));
			}
			el.createEl("mark", {
				text: text.slice(idx, idx + query.length),
				cls: "epub-plus-search-match",
			});
			lastIdx = idx + query.length;
			idx = lowerText.indexOf(lowerQuery, lastIdx);
		}

		if (lastIdx < text.length) {
			el.appendText(text.slice(lastIdx));
		}
	}

	private buildTocLabelMap(toc: TocItem[]): Map<string, string> {
		const map = new Map<string, string>();
		const walk = (items: TocItem[]) => {
			for (const item of items) {
				const base = item.href.split("#")[0] ?? "";
				if (base && !map.has(base)) {
					map.set(base, item.label);
				}
				if (item.children.length > 0) walk(item.children);
			}
		};
		walk(toc);
		return map;
	}
}
