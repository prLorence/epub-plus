import type { EpubLinkParams } from "../types";

/**
 * Parse an EPUB subpath like "#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&color=yellow"
 * into structured parameters.
 *
 * We use a custom parser instead of URLSearchParams because CFI strings
 * contain characters (/, !, :) that URLSearchParams would percent-encode.
 */
export function parseEpubSubpath(subpath: string): EpubLinkParams | null {
	if (!subpath.startsWith("#")) return null;
	const raw = subpath.slice(1);
	const params = parseParams(raw);

	const cfi = params.get("cfi");
	const chapter = params.get("chapter");

	if (!cfi && !chapter) return null;

	return {
		cfi: cfi ?? undefined,
		end: params.get("end") ?? undefined,
		color: params.get("color") ?? undefined,
		chapter: chapter ?? undefined,
		text: params.get("text")
			? decodeURIComponent(params.get("text")!)
			: undefined,
	};
}

/**
 * Build a subpath string from EpubLinkParams.
 */
export function buildEpubSubpath(params: EpubLinkParams): string {
	const parts: string[] = [];

	if (params.cfi) parts.push(`cfi=${params.cfi}`);
	if (params.end) parts.push(`end=${params.end}`);
	if (params.color) parts.push(`color=${params.color}`);
	if (params.chapter) parts.push(`chapter=${params.chapter}`);
	if (params.text) parts.push(`text=${encodeURIComponent(params.text)}`);

	return "#" + parts.join("&");
}

/**
 * Parse EPUB.js compact range CFI into separate start and end CFIs.
 *
 * EPUB.js returns ranges like: epubcfi(/6/14!/4/2,/1:0,/1:42)
 * This encodes (commonPrefix, startSuffix, endSuffix).
 * We expand to: start = /6/14!/4/2/1:0, end = /6/14!/4/2/1:42
 */
export function parseCfiRange(rangeCfi: string): {
	start: string;
	end: string;
} {
	let cfi = rangeCfi.trim();
	if (cfi.startsWith("epubcfi(") && cfi.endsWith(")")) {
		cfi = cfi.slice(8, -1);
	}

	const commaIdx1 = cfi.indexOf(",");
	if (commaIdx1 === -1) {
		return { start: cfi, end: cfi };
	}

	const commaIdx2 = cfi.indexOf(",", commaIdx1 + 1);
	if (commaIdx2 === -1) {
		return { start: cfi, end: cfi };
	}

	const prefix = cfi.slice(0, commaIdx1);
	const startSuffix = cfi.slice(commaIdx1 + 1, commaIdx2);
	const endSuffix = cfi.slice(commaIdx2 + 1);

	return {
		start: prefix + startSuffix,
		end: prefix + endSuffix,
	};
}

/**
 * Build a compact EPUB.js range CFI from start and end CFIs.
 *
 * EPUB.js format: epubcfi(prefix,/startSuffix,/endSuffix)
 * The prefix does NOT end with /, the suffixes start with /.
 * Example: epubcfi(/6/14!/4/2,/1:0,/1:42)
 */
export function buildCfiRange(start: string, end: string): string {
	// Find common prefix length
	let i = 0;
	while (i < start.length && i < end.length && start[i] === end[i]) {
		i++;
	}
	// Back up to the last / — keep the / with the suffixes, not the prefix
	while (i > 0 && start[i] !== "/") {
		i--;
	}

	const prefix = start.slice(0, i);
	const startSuffix = start.slice(i);
	const endSuffix = end.slice(i);

	return `epubcfi(${prefix},${startSuffix},${endSuffix})`;
}

/**
 * Custom key=value parser that doesn't encode CFI characters.
 * Splits on & to get pairs, then on first = to get key/value.
 */
function parseParams(raw: string): Map<string, string> {
	const map = new Map<string, string>();
	if (!raw) return map;

	const pairs = raw.split("&");
	for (const pair of pairs) {
		const eqIdx = pair.indexOf("=");
		if (eqIdx === -1) continue;
		const key = pair.slice(0, eqIdx);
		const value = pair.slice(eqIdx + 1);
		map.set(key, value);
	}
	return map;
}
