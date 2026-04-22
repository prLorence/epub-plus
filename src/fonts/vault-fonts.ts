import type { App, TFile } from "obsidian";

const blobUrlCache = new Map<string, string>();

/**
 * Load a .woff2 font file from the vault and return @font-face CSS.
 * Caches blob URLs to avoid re-reading on every style rebuild.
 */
export async function loadVaultFontCss(
	app: App,
	fontPath: string,
): Promise<{ fontFaceCss: string; fontFamily: string } | null> {
	if (!fontPath.endsWith(".woff2") && !fontPath.endsWith(".ttf") && !fontPath.endsWith(".otf")) {
		return null;
	}

	const file = app.vault.getAbstractFileByPath(fontPath);
	if (!file || !("extension" in file)) return null;

	let blobUrl = blobUrlCache.get(fontPath);
	if (!blobUrl) {
		const data = await app.vault.readBinary(file as TFile);
		const mimeType = fontPath.endsWith(".woff2")
			? "font/woff2"
			: fontPath.endsWith(".ttf")
				? "font/ttf"
				: "font/otf";
		const blob = new Blob([data], { type: mimeType });
		blobUrl = URL.createObjectURL(blob);
		blobUrlCache.set(fontPath, blobUrl);
	}

	const format = fontPath.endsWith(".woff2")
		? "woff2"
		: fontPath.endsWith(".ttf")
			? "truetype"
			: "opentype";

	const familyName = "VaultFont";

	return {
		fontFaceCss: `@font-face {
  font-family: '${familyName}';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('${blobUrl}') format('${format}');
}`,
		fontFamily: `'${familyName}', Georgia, serif`,
	};
}

/**
 * Revoke cached blob URLs (call on plugin unload).
 */
export function clearVaultFontCache(): void {
	for (const url of blobUrlCache.values()) {
		URL.revokeObjectURL(url);
	}
	blobUrlCache.clear();
}
