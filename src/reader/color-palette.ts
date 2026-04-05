import { Platform } from "obsidian";
import type { PaletteColor } from "../types";

export interface PaletteCallbacks {
	onColorSelect: (color: PaletteColor, style?: "highlight" | "underline") => void;
	onAddToNote: (color: PaletteColor, style?: "highlight" | "underline") => void;
	onExtendSelection?: () => void;
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
	// On mobile, show below selection to avoid conflicting with OS selection menu
	s.top = Platform.isMobile
		? `${rect.bottom + 8}px`
		: `${rect.top - 44}px`;
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

	let annotationStyle: "highlight" | "underline" = "highlight";

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
			callbacks.onColorSelect(color, annotationStyle);
			cleanup();
		});
		popup.appendChild(swatch);
	}

	// Underline toggle
	const ulBtn = doc.createElement("button");
	ulBtn.className = "epub-plus-popup-swatch";
	ulBtn.title = "Toggle underline";
	const ubs = ulBtn.style;
	ubs.width = "22px";
	ubs.height = "22px";
	ubs.borderRadius = "50%";
	ubs.border = "2px solid transparent";
	ubs.background = "transparent";
	ubs.cursor = "pointer";
	ubs.padding = "0";
	ubs.margin = "0";
	ubs.fontSize = "14px";
	ubs.lineHeight = "22px";
	ubs.textAlign = "center";
	ubs.color = "#ccc";
	ubs.textDecoration = "underline";
	ulBtn.textContent = "U";
	ulBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		annotationStyle = annotationStyle === "highlight" ? "underline" : "highlight";
		ubs.color = annotationStyle === "underline" ? "#fff" : "#ccc";
		ubs.background = annotationStyle === "underline" ? "#555" : "transparent";
	});
	popup.appendChild(ulBtn);

	// Extend selection button (mobile only, for cross-page highlights)
	if (Platform.isMobile && callbacks.onExtendSelection) {
		const extSep = doc.createElement("span");
		extSep.style.width = "1px";
		extSep.style.height = "18px";
		extSep.style.background = "#555";
		extSep.style.margin = "0 4px";
		popup.appendChild(extSep);

		const extBtn = doc.createElement("button");
		extBtn.className = "epub-plus-popup-add-btn";
		extBtn.textContent = "Extend →";
		extBtn.title = "Extend selection to next page";

		const ebs = extBtn.style;
		ebs.background = "none";
		ebs.border = "none";
		ebs.color = "#ccc";
		ebs.cursor = "pointer";
		ebs.fontSize = "11px";
		ebs.padding = "2px 6px";
		ebs.borderRadius = "3px";

		extBtn.addEventListener("mouseenter", () => { ebs.background = "#444"; });
		extBtn.addEventListener("mouseleave", () => { ebs.background = "none"; });
		extBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			callbacks.onExtendSelection!();
			cleanup();
		});
		popup.appendChild(extBtn);
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
		cleanup();
	});
	popup.appendChild(addBtn);

	// Dismiss when the selection is cleared or popup is removed
	const win = doc.defaultView;
	let dismissed = false;
	const cleanup = () => {
		if (dismissed) return;
		dismissed = true;
		popup.remove();
		doc.removeEventListener("selectionchange", checkSelection);
		doc.removeEventListener("mousedown", onMouseDown);
	};
	const checkSelection = () => {
		const sel = win?.getSelection();
		if (!sel || sel.isCollapsed || sel.toString().trim() === "") {
			cleanup();
		}
	};
	const onMouseDown = (e: Event) => {
		if (popup.contains(e.target as Node)) return;
		// Defer check so the selection has time to clear
		setTimeout(checkSelection, 50);
	};
	doc.addEventListener("selectionchange", checkSelection);
	doc.addEventListener("mousedown", onMouseDown);

	doc.body.appendChild(popup);
	return popup;
}
