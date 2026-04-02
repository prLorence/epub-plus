import type { Scope } from "obsidian";
import type { EpubRenderer } from "./epub-renderer";

export interface VimBindingsCallbacks {
	onNext: () => void;
	onPrev: () => void;
}

/**
 * Optional vim-style keybindings for the EPUB reader.
 * Only active when the EpubView has focus (via Obsidian's Scope system).
 */
export class VimBindings {
	private lastGPress = 0;

	constructor(
		private scope: Scope,
		private renderer: EpubRenderer,
		private callbacks: VimBindingsCallbacks,
	) {
		this.register();
	}

	private register(): void {
		// j/k — next/prev page
		this.scope.register([], "j", () => {
			this.callbacks.onNext();
			return false;
		});
		this.scope.register([], "k", () => {
			this.callbacks.onPrev();
			return false;
		});

		// h/l — prev/next page
		this.scope.register([], "h", () => {
			this.callbacks.onPrev();
			return false;
		});
		this.scope.register([], "l", () => {
			this.callbacks.onNext();
			return false;
		});

		// G (shift+g) — go to end
		this.scope.register(["Shift"], "g", () => {
			const rendition = this.renderer.getRendition();
			if (rendition) {
				const endHref = rendition.getSpineEndHref();
				if (endHref) {
					void rendition.display(endHref);
				}
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
