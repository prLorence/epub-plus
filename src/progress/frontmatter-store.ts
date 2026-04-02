/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Frontmatter is Record<string, any> */
import { App, TFile, TFolder } from "obsidian";
import type { ReadingProgress } from "../types";

/**
 * Stores reading progress in the frontmatter of a companion markdown note.
 *
 * The companion note can be:
 * - Auto-detected: "Books/Example.epub" → "Books/Example.md"
 * - Manually linked via the toolbar button (stored in noteLinks map)
 *
 * Frontmatter format:
 * ---
 * epub-progress:
 *   cfi: "epubcfi(/6/14!/4/2/1:0)"
 *   percent: 42.3
 *   updated: "2025-03-27T10:30:00Z"
 * source: "Books/Example.epub"
 * ---
 */
export class FrontmatterProgressStore {
	/** Maps epub path → custom companion note path */
	private noteLinks = new Map<string, string>();

	constructor(private app: App) {}

	setCompanionNote(epubPath: string, notePath: string): void {
		this.noteLinks.set(epubPath, notePath);
	}

	getCompanionNotePath(epubPath: string): string {
		return this.noteLinks.get(epubPath) ?? epubPath.replace(/\.epub$/i, "");
	}

	async get(epubPath: string): Promise<ReadingProgress | undefined> {
		const notePath = this.getCompanionNotePath(epubPath) + ".md";
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) return undefined;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) return undefined;

const progress = fm["epub-progress"] as Record<string, string | number> | undefined;
		if (!progress) return undefined;

		return {
			cfi: String(progress["cfi"] || ""),
			percent: Number(progress["percent"] || 0),
			updated: String(progress["updated"] || ""),
		};
	}

	async set(epubPath: string, progress: ReadingProgress): Promise<void> {
		const notePath = this.getCompanionNotePath(epubPath) + ".md";
		let file = this.app.vault.getAbstractFileByPath(notePath);

		if (!(file instanceof TFile)) {
			// Create companion note
			const folder = notePath.split("/").slice(0, -1).join("/");
			if (folder) {
				const folderObj = this.app.vault.getAbstractFileByPath(folder);
				if (!(folderObj instanceof TFolder)) {
					await this.app.vault.createFolder(folder);
				}
			}
			file = await this.app.vault.create(notePath, "");
		}

		if (!(file instanceof TFile)) return;

		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm["epub-progress"] = {
				cfi: progress.cfi,
				percent: progress.percent,
				updated: progress.updated,
			};
			fm["source"] = epubPath;
		});
	}

	async getMostRecent(): Promise<{
		path: string;
		progress: ReadingProgress;
	} | null> {
		let latest: { path: string; progress: ReadingProgress } | null = null;

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			if (!fm) continue;

		const progress = fm["epub-progress"] as Record<string, string | number> | undefined;
			if (!progress) continue;

		const source = fm["source"] as string | undefined;
			const epubPath = source ?? file.path.replace(/\.md$/, ".epub");
			const rp: ReadingProgress = {
				cfi: String(progress["cfi"] || ""),
				percent: Number(progress["percent"] || 0),
				updated: String(progress["updated"] || ""),
			};

			if (!latest || rp.updated > latest.progress.updated) {
				latest = { path: epubPath, progress: rp };
			}
		}

		return latest;
	}
}
