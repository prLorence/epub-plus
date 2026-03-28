import { App } from "obsidian";
import type { HoverParent } from "obsidian";
import type { EpubBacklink } from "../types";

/**
 * Show a hover popover when the user hovers over a highlight.
 * Uses Obsidian's built-in hover-link trigger for page preview.
 */
export function showHighlightPopover(
	app: App,
	backlinks: EpubBacklink[],
	event: MouseEvent,
	hoverParent: HoverParent,
): void {
	if (backlinks.length === 0) return;

	const targetEl = event.target as HTMLElement;
	if (!targetEl) return;

	if (backlinks.length === 1) {
		const bl = backlinks[0]!;
		app.workspace.trigger("hover-link", {
			event,
			source: "epub-plus",
			hoverParent,
			targetEl,
			linktext: bl.sourcePath,
			sourcePath: "",
		});
	} else {
		showMultiBacklinkPopover(app, backlinks, targetEl);
	}
}

/**
 * Navigate to the source note of a backlink.
 */
export function navigateToBacklink(
	app: App,
	backlink: EpubBacklink,
): void {
	void app.workspace.openLinkText(
		backlink.sourcePath,
		"",
		false,
		{
			eState: {
				line: backlink.position.line,
			},
		},
	);
}

function showMultiBacklinkPopover(
	app: App,
	backlinks: EpubBacklink[],
	anchorEl: HTMLElement,
): void {
	// Remove any existing multi-popover
	const existing = document.querySelector(
		".epub-plus-multi-backlink-popover",
	);
	if (existing) existing.remove();

	const rect = anchorEl.getBoundingClientRect();

	const popover = document.createElement("div");
	popover.className = "epub-plus-multi-backlink-popover";
	popover.setAttribute(
		"style",
		`position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;z-index:9999;`,
	);

	for (const bl of backlinks) {
		const entry = popover.createDiv({
			cls: "epub-plus-multi-backlink-entry",
		});
		const dot = entry.createEl("span", {
			cls: "epub-plus-backlink-color-dot",
		});
		dot.style.backgroundColor = bl.color;
		entry.createEl("span", {
			text: bl.sourceDisplay,
			cls: "epub-plus-multi-backlink-name",
		});
		if (bl.text) {
			entry.createEl("span", {
				text: bl.text.slice(0, 60),
				cls: "epub-plus-multi-backlink-text",
			});
		}

		entry.addEventListener("click", () => {
			navigateToBacklink(app, bl);
			popover.remove();
		});
	}

	const dismiss = () => {
		popover.remove();
		document.removeEventListener("click", dismiss);
	};
	setTimeout(() => document.addEventListener("click", dismiss), 100);

	document.body.appendChild(popover);
}
