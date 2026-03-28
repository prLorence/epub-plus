import type { Scope } from "obsidian";
import type { EpubRenderer } from "./epub-renderer";

/**
 * Optional vim-style keybindings for the EPUB reader.
 * Only active when the EpubView has focus (via Obsidian's Scope system).
 */
export class VimBindings {
	private lastGPress = 0;

	constructor(
		private scope: Scope,
		private renderer: EpubRenderer,
	) {
		this.register();
	}

	private register(): void {
		// j/k — next/prev page
		this.scope.register([], "j", () => {
			void this.renderer.next();
			return false;
		});
		this.scope.register([], "k", () => {
			void this.renderer.prev();
			return false;
		});

		// h/l — prev/next page
		this.scope.register([], "h", () => {
			void this.renderer.prev();
			return false;
		});
		this.scope.register([], "l", () => {
			void this.renderer.next();
			return false;
		});

		// G (shift+g) — go to end
		this.scope.register(["Shift"], "g", () => {
			const rendition = this.renderer.getRendition();
			if (rendition) {
				void rendition.display(
					rendition.book.spine.last()?.href,
				);
			}
			return false;
		});

		// g — double-tap for beginning
		this.scope.register([], "g", () => {
			const now = Date.now();
			if (now - this.lastGPress < 500) {
				void this.renderer.display();
				this.lastGPress = 0;
			} else {
				this.lastGPress = now;
			}
			return false;
		});
	}
}
