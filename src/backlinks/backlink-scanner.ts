import { App, parseLinktext, debounce } from "obsidian";
import type { EventRef } from "obsidian";
import type { EpubBacklink } from "../types";
import { parseEpubSubpath, buildCfiRange } from "../links/epub-link-parser";

/**
 * Scan the vault's MetadataCache for all links targeting a given EPUB file.
 * Returns structured backlink records with parsed CFI ranges.
 */
export function scanBacklinksForEpub(
	app: App,
	epubPath: string,
	defaultColor: string,
): EpubBacklink[] {
	const backlinks: EpubBacklink[] = [];

	// First try resolvedLinks (fast path)
	const resolved = app.metadataCache.resolvedLinks;
	const sourceFiles = new Set<string>();

	for (const [sourcePath, targets] of Object.entries(resolved)) {
		if (epubPath in targets) {
			sourceFiles.add(sourcePath);
		}
	}

	// Fallback: scan all markdown files for links to this epub
	// (resolvedLinks may not include links to binary/custom file types)
	if (sourceFiles.size === 0) {
		const mdFiles = app.vault.getMarkdownFiles();
		for (const file of mdFiles) {
			const cache = app.metadataCache.getFileCache(file);
			if (!cache?.links) continue;
			for (const linkCache of cache.links) {
				const { path } = parseLinktext(linkCache.link);
				const dest = app.metadataCache.getFirstLinkpathDest(
					path,
					file.path,
				);
				if (dest && dest.path === epubPath) {
					sourceFiles.add(file.path);
					break;
				}
			}
		}
	}

	// Extract backlinks from each source file
	for (const sourcePath of sourceFiles) {
		const cache = app.metadataCache.getCache(sourcePath);
		if (!cache?.links) continue;

		for (const linkCache of cache.links) {
			const { path, subpath } = parseLinktext(linkCache.link);
			const dest = app.metadataCache.getFirstLinkpathDest(
				path,
				sourcePath,
			);
			if (!dest || dest.path !== epubPath) continue;
			if (!subpath) continue;

			const params = parseEpubSubpath(subpath);
			if (!params?.cfi) continue;

			const cfiStart = params.cfi;
			const cfiEnd = params.end ?? params.cfi;

			// Skip point references (no range to highlight)
			if (cfiStart === cfiEnd) continue;

			const cfiRange = buildCfiRange(cfiStart, cfiEnd);

			backlinks.push({
				sourcePath,
				sourceDisplay:
					sourcePath
						.replace(/\.md$/, "")
						.split("/")
						.pop() ?? sourcePath,
				linkOriginal: linkCache.original,
				cfiRange,
				cfiStart,
				cfiEnd,
				color: params.color ?? defaultColor,
				chapter: params.chapter,
				text: params.text,
				position: {
					line: linkCache.position.start.line,
					ch: linkCache.position.start.col,
				},
			});
		}
	}

	return backlinks;
}

/**
 * Watch for MetadataCache changes and re-scan backlinks when relevant.
 * Returns EventRef handles for cleanup.
 */
export function watchBacklinks(
	app: App,
	epubPath: string,
	defaultColor: string,
	onChange: (backlinks: EpubBacklink[]) => void,
): EventRef[] {
	const rescan = debounce(
		() => {
			const backlinks = scanBacklinksForEpub(
				app,
				epubPath,
				defaultColor,
			);
			onChange(backlinks);
		},
		300,
		true,
	);

	// Listen for any metadata change — since resolvedLinks may not track epub targets,
	// we trigger on any file change rather than checking resolvedLinks
	const changedRef = app.metadataCache.on("changed", () => {
		rescan();
	});

	const resolvedRef = app.metadataCache.on("resolved", () => {
		rescan();
	});

	return [changedRef, resolvedRef];
}
