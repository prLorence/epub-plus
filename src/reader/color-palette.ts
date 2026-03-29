/* eslint-disable obsidianmd/no-static-styles-assignment -- elements are in EPUB iframe, no access to plugin CSS */
import type { PaletteColor } from "../types";

export interface PaletteCallbacks {
	onColorSelect: (color: PaletteColor) => void;
	onAddToNote: (color: PaletteColor) => void;
}

/**
 * Renders a color palette popup near a text selection inside the EPUB iframe.
 */
export function showColorPalettePopup(
	doc: Document,
	rect: DOMRect,
	palette: PaletteColor[],
	callbacks: PaletteCallbacks,
): HTMLElement {
	// Remove any existing popup
	const existing = doc.querySelector(".epub-plus-selection-popup");
	if (existing) existing.remove();

	const popup = doc.createElement("div");
	popup.className = "epub-plus-selection-popup";

	// Position above selection
	popup.setAttribute(
		"style",
		`position:absolute;left:${rect.left + rect.width / 2}px;top:${rect.top - 44}px;` +
			"transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:4px;" +
			"background:#2b2b2b;padding:6px 10px;border-radius:6px;" +
			"box-shadow:0 2px 12px rgba(0,0,0,0.4);white-space:nowrap;",
	);

	// Color swatches
	for (const color of palette) {
		const swatch = doc.createElement("button");
		swatch.className = "epub-plus-popup-swatch";
		swatch.title = color.name;
		swatch.setAttribute(
			"style",
			`width:22px;height:22px;border-radius:50%;border:2px solid transparent;` +
				`background:${color.hex};cursor:pointer;padding:0;margin:0;` +
				"transition:border-color 0.15s;",
		);
		swatch.addEventListener("mouseenter", () => {
			swatch.setAttribute(
				"style",
				swatch
					.getAttribute("style")!
					.replace(
						"border:2px solid transparent",
						"border:2px solid #fff",
					),
			);
		});
		swatch.addEventListener("mouseleave", () => {
			swatch.setAttribute(
				"style",
				swatch
					.getAttribute("style")!
					.replace(
						"border:2px solid #fff",
						"border:2px solid transparent",
					),
			);
		});
		swatch.addEventListener("click", (e) => {
			e.stopPropagation();
			callbacks.onColorSelect(color);
			popup.remove();
		});
		popup.appendChild(swatch);
	}

	// Separator
	const sep = doc.createElement("span");
	sep.setAttribute(
		"style",
		"width:1px;height:18px;background:#555;margin:0 4px;",
	);
	popup.appendChild(sep);

	// "Add to note" button
	const addBtn = doc.createElement("button");
	addBtn.className = "epub-plus-popup-add-btn";
	addBtn.textContent = "Add to note";
	addBtn.title = "Add to active note";
	addBtn.setAttribute(
		"style",
		"background:none;border:none;color:#ccc;cursor:pointer;" +
			"font-size:11px;padding:2px 6px;border-radius:3px;",
	);
	addBtn.addEventListener("mouseenter", () => {
		addBtn.setAttribute(
			"style",
			addBtn
				.getAttribute("style")!
				.replace("background:none", "background:#444"),
		);
	});
	addBtn.addEventListener("mouseleave", () => {
		addBtn.setAttribute(
			"style",
			addBtn
				.getAttribute("style")!
				.replace("background:#444", "background:none"),
		);
	});
	addBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		// Use default color when adding to note
		const defaultColor = palette[0];
		if (defaultColor) {
			callbacks.onAddToNote(defaultColor);
		}
		popup.remove();
	});
	popup.appendChild(addBtn);

	// Dismiss only when the selection is cleared
	const win = doc.defaultView;
	const checkSelection = () => {
		const sel = win?.getSelection();
		if (!sel || sel.isCollapsed || sel.toString().trim() === "") {
			popup.remove();
			doc.removeEventListener("selectionchange", checkSelection);
			doc.removeEventListener("mousedown", onMouseDown);
		}
	};
	const onMouseDown = (e: Event) => {
		// If clicking inside the popup, don't dismiss
		if (popup.contains(e.target as Node)) return;
		// Otherwise wait for selection to update, then check
		setTimeout(checkSelection, 50);
	};
	doc.addEventListener("selectionchange", checkSelection);
	doc.addEventListener("mousedown", onMouseDown);

	doc.body.appendChild(popup);
	return popup;
}
