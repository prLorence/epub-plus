import type { EpubBacklink } from "../types";
import type { HighlightManager } from "./highlight-manager";
import type { BacklinkPanel } from "./backlink-panel";

export type HoverSyncMode =
	| "both"
	| "epub-to-backlinks"
	| "backlinks-to-epub"
	| "disabled";

/**
 * Bridges hover events between the EPUB highlight layer and the backlink panel.
 */
export class HoverSyncBridge {
	constructor(
		private highlightManager: HighlightManager,
		private backlinkPanel: BacklinkPanel | null,
		private mode: HoverSyncMode,
	) {}

	/**
	 * Called when a highlight in the EPUB is hovered.
	 * Syncs to the backlink panel.
	 */
	onHighlightHover(backlinks: EpubBacklink[] | null): void {
		if (
			this.mode === "disabled" ||
			this.mode === "backlinks-to-epub"
		) {
			return;
		}

		if (!this.backlinkPanel) return;

		if (backlinks && backlinks.length > 0) {
			const bl = backlinks[0]!;
			this.backlinkPanel.highlightEntry(
				bl.sourcePath,
				bl.position.line,
			);
		} else {
			this.backlinkPanel.clearHighlight();
		}
	}

	/**
	 * Called when a backlink panel entry is hovered.
	 * Syncs to the EPUB highlight layer.
	 */
	onPanelEntryHover(backlink: EpubBacklink | null): void {
		if (
			this.mode === "disabled" ||
			this.mode === "epub-to-backlinks"
		) {
			return;
		}

		if (backlink) {
			this.highlightManager.setHoverHighlight(backlink.cfiRange);
		} else {
			this.highlightManager.setHoverHighlight(null);
		}
	}

	setMode(mode: HoverSyncMode): void {
		this.mode = mode;
	}

	setBacklinkPanel(panel: BacklinkPanel | null): void {
		this.backlinkPanel = panel;
	}
}
