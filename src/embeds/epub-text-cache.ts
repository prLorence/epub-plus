import { TFile, Vault } from "obsidian";
import ePub from "epubjs";

const CACHE_FILE = ".epub-text-cache.json";

type CacheMap = Record<string, Record<string, { text: string; chapter?: string }>>;

/**
 * Persistent cache mapping (epubPath, cfiRange) → resolved text.
 * Avoids re-opening EPUBs to resolve the same CFI multiple times.
 */
export class EpubTextCache {
	private cache: CacheMap = {};
	private dirty = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private vault: Vault) {}

	async load(): Promise<void> {
		const file = this.vault.getAbstractFileByPath(CACHE_FILE);
		if (file instanceof TFile) {
			try {
				const raw = await this.vault.read(file);
				this.cache = JSON.parse(raw) as CacheMap;
			} catch {
				this.cache = {};
			}
		}
	}

	async save(): Promise<void> {
		if (!this.dirty) return;
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		const data = JSON.stringify(this.cache, null, 2);
		try {
			const file = this.vault.getAbstractFileByPath(CACHE_FILE);
			if (file instanceof TFile) {
				await this.vault.modify(file, data);
			} else {
				await this.vault.create(CACHE_FILE, data);
			}
		} catch {
			try {
				const file = this.vault.getAbstractFileByPath(CACHE_FILE);
				if (file instanceof TFile) {
					await this.vault.modify(file, data);
				}
			} catch {
				// Give up silently
			}
		}
		this.dirty = false;
	}

	private scheduleSave(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.save();
		}, 2000);
	}

	getCached(
		epubPath: string,
		cfiKey: string,
	): { text: string; chapter?: string } | undefined {
		return this.cache[epubPath]?.[cfiKey];
	}

	/**
	 * Resolve a CFI range to text. Uses cache if available,
	 * otherwise opens the EPUB, resolves, caches, and destroys the book.
	 */
	async resolve(
		epubPath: string,
		cfiRange: string,
		cfiKey: string,
	): Promise<{ text: string; chapter?: string } | null> {
		// Check cache
		const cached = this.getCached(epubPath, cfiKey);
		if (cached) return cached;

		// Need to open the EPUB
		const file = this.vault.getAbstractFileByPath(epubPath);
		if (!(file instanceof TFile)) return null;

		try {
			const data = await this.vault.readBinary(file);
			const book = ePub();
			await book.open(data, "binary");
			await book.loaded.navigation;

			const range = await book.getRange(cfiRange);
			if (!range) {
				book.destroy();
				return null;
			}

			const text = range.toString();
			const result = { text };

			// Cache it
			if (!this.cache[epubPath]) {
				this.cache[epubPath] = {};
			}
			this.cache[epubPath][cfiKey] = result;
			this.dirty = true;
			this.scheduleSave();

			book.destroy();
			return result;
		} catch {
			return null;
		}
	}
}
