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

	const s = popup.style;
	s.position = "absolute";
	s.left = `${rect.left + rect.width / 2}px`;
	s.top = `${rect.top - 44}px`;
	s.transform = "translateX(-50%)";
	s.zIndex = "9999";
	s.display = "flex";
	s.alignItems = "center";
	s.gap = "4px";
	s.background = "#2b2b2b";
	s.padding = "6px 10px";
	s.borderRadius = "6px";
	s.boxShadow = "0 2px 12px rgba(0,0,0,0.4)";
	s.whiteSpace = "nowrap";

	// Color swatches
	for (const color of palette) {
		const swatch = doc.createElement("button");
		swatch.className = "epub-plus-popup-swatch";
		swatch.title = color.name;

		const ss = swatch.style;
		ss.width = "22px";
		ss.height = "22px";
		ss.borderRadius = "50%";
		ss.border = "2px solid transparent";
		ss.background = color.hex;
		ss.cursor = "pointer";
		ss.padding = "0";
		ss.margin = "0";
		ss.transition = "border-color 0.15s";

		swatch.addEventListener("mouseenter", () => {
			ss.borderColor = "#fff";
		});
		swatch.addEventListener("mouseleave", () => {
			ss.borderColor = "transparent";
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
	const sepS = sep.style;
	sepS.width = "1px";
	sepS.height = "18px";
	sepS.background = "#555";
	sepS.margin = "0 4px";
	popup.appendChild(sep);

	// "Add to note" button
	const addBtn = doc.createElement("button");
	addBtn.className = "epub-plus-popup-add-btn";
	addBtn.textContent = "Add to note";
	addBtn.title = "Add to active note";

	const bs = addBtn.style;
	bs.background = "none";
	bs.border = "none";
	bs.color = "#ccc";
	bs.cursor = "pointer";
	bs.fontSize = "11px";
	bs.padding = "2px 6px";
	bs.borderRadius = "3px";

	addBtn.addEventListener("mouseenter", () => {
		bs.background = "#444";
	});
	addBtn.addEventListener("mouseleave", () => {
		bs.background = "none";
	});
	addBtn.addEventListener("click", (e) => {
		e.stopPropagation();
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
		if (popup.contains(e.target as Node)) return;
		setTimeout(checkSelection, 50);
	};
	doc.addEventListener("selectionchange", checkSelection);
	doc.addEventListener("mousedown", onMouseDown);

	doc.body.appendChild(popup);
	return popup;
}
