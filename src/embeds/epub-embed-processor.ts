import { MarkdownRenderChild, parseLinktext } from "obsidian";
import type EpubPlusPlugin from "../main";
import { parseEpubSubpath, buildCfiRange } from "../links/epub-link-parser";

/**
 * Registers a markdown post-processor that renders ![[book.epub#cfi=...]]
 * embeds as styled blockquotes with the resolved text.
 */
export function registerEpubEmbedProcessor(plugin: EpubPlusPlugin): void {
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		const embeds = el.querySelectorAll(".internal-embed");

		for (const embedEl of Array.from(embeds)) {
			const src =
				embedEl.getAttribute("src") ??
				embedEl.getAttribute("alt") ?? "";
			if (!src) continue;

			const { path, subpath } = parseLinktext(src);
			if (!path.endsWith(".epub") || !subpath) continue;

			const params = parseEpubSubpath(subpath);
			if (!params?.cfi) continue;

			const child = new EpubEmbedChild(
				embedEl as HTMLElement,
				plugin,
				path,
				params.cfi,
				params.end,
				params.color,
				params.chapter,
				params.text,
			);
			ctx.addChild(child);
		}
	});
}

class EpubEmbedChild extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private plugin: EpubPlusPlugin,
		private epubLinkPath: string,
		private cfiStart: string,
		private cfiEnd: string | undefined,
		private color: string | undefined,
		private chapter: string | undefined,
		private textHint: string | undefined,
	) {
		super(containerEl);
	}

	onload(): void {
		this.renderEmbed();
	}

	private renderEmbed(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("epub-plus-embed");

		const colorHex = this.resolveColorHex(
			this.color ?? this.plugin.settings.defaultHighlightColor,
		);

		// Show text hint immediately if available
		if (this.textHint) {
			this.renderBlockquote(el, this.textHint, colorHex);
		} else {
			el.createDiv({
				cls: "epub-plus-embed-loading",
				text: "Loading excerpt...",
			});
		}

		// Resolve full text from cache
		const end = this.cfiEnd ?? this.cfiStart;
		const cfiRange = buildCfiRange(this.cfiStart, end);
		const cfiKey = `${this.cfiStart}&${end}`;

		const resolvedFile =
			this.plugin.app.metadataCache.getFirstLinkpathDest(
				this.epubLinkPath,
				"",
			);
		if (!resolvedFile) return;

		void this.plugin.textCache
			.resolve(resolvedFile.path, cfiRange, cfiKey)
			.then((result) => {
				if (result && result.text) {
					el.empty();
					this.renderBlockquote(el, result.text, colorHex);
				}
			});
	}

	private renderBlockquote(
		parent: HTMLElement,
		text: string,
		colorHex: string,
	): void {
		const quote = parent.createEl("blockquote", {
			cls: "epub-plus-embed-quote",
		});
		quote.style.borderLeftColor = colorHex;

		if (this.chapter) {
			quote.createEl("cite", {
				cls: "epub-plus-embed-chapter",
				text: this.chapter,
			});
		}

		quote.createEl("p", {
			cls: "epub-plus-embed-text",
			text,
		});

		const footer = quote.createEl("footer", {
			cls: "epub-plus-embed-source",
		});
		const link = footer.createEl("a", {
			cls: "epub-plus-embed-link",
			text: this.epubLinkPath.split("/").pop()?.replace(".epub", "") ?? "",
		});
		link.addEventListener("click", (e) => {
			e.preventDefault();
			const subpath = `#cfi=${this.cfiStart}`;
			void this.plugin.app.workspace.openLinkText(
				this.epubLinkPath + subpath,
				"",
			);
		});
	}

	private resolveColorHex(colorName: string): string {
		const found = this.plugin.settings.colorPalette.find(
			(c) => c.name === colorName,
		);
		return found?.hex ?? "#ffd400";
	}
}
