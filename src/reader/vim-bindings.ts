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

	private isTyping(e: KeyboardEvent): boolean {
		const tag = (e.target as HTMLElement)?.tagName;
		return tag === "INPUT" || tag === "TEXTAREA"
			|| (e.target as HTMLElement)?.isContentEditable === true;
	}

	private register(): void {
		// j/k — next/prev page
		this.scope.register([], "j", (e) => {
			if (this.isTyping(e)) return true;
			this.callbacks.onNext();
			return false;
		});
		this.scope.register([], "k", (e) => {
			if (this.isTyping(e)) return true;
			this.callbacks.onPrev();
			return false;
		});

		// h/l — prev/next page
		this.scope.register([], "h", (e) => {
			if (this.isTyping(e)) return true;
			this.callbacks.onPrev();
			return false;
		});
		this.scope.register([], "l", (e) => {
			if (this.isTyping(e)) return true;
			this.callbacks.onNext();
			return false;
		});

		// G (shift+g) — go to end
		this.scope.register(["Shift"], "g", (e) => {
			if (this.isTyping(e)) return true;
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
		this.scope.register([], "g", (e) => {
			if (this.isTyping(e)) return true;
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
