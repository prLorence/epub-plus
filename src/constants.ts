import type { PaletteColor } from "./types";

export const EPUB_VIEW_TYPE = "epub-view";
export const READING_STATE_FILE = ".epub-reading-state.json";
export const DEFAULT_HIGHLIGHT_COLOR = "yellow";
export const PLUGIN_ID = "epub-plus";

export const DEFAULT_PALETTE: PaletteColor[] = [
	{ name: "yellow", hex: "#ffd400" },
	{ name: "red", hex: "#ff6b6b" },
	{ name: "green", hex: "#51cf66" },
	{ name: "blue", hex: "#4dabf7" },
	{ name: "purple", hex: "#cc5de8" },
	{ name: "pink", hex: "#f06595" },
	{ name: "orange", hex: "#ff922b" },
];
