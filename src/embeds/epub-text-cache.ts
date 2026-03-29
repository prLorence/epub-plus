import { TFile, Vault } from "obsidian";
import ePub, { Book } from "epubjs";

const CACHE_FILE = ".epub-text-cache.json";
const POOL_MAX = 3;

type CacheMap = Record<string, Record<string, { text: string; chapter?: string }>>;

interface PoolEntry {
	book: Book;
	lastUsed: number;
}

/**
 * Persistent cache mapping (epubPath, cfiRange) → resolved text.
 * Pools open Book instances (LRU, max 3) to avoid repeatedly
 * decompressing the same EPUB for adjacent CFI resolutions.
 */
export class EpubTextCache {
	private cache: CacheMap = {};
	private dirty = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private bookPool = new Map<string, PoolEntry>();

	constructor(private vault: Vault) {}

	async load(): Promise<void> {
		try {
			if (await this.vault.adapter.exists(CACHE_FILE)) {
				const raw = await this.vault.adapter.read(CACHE_FILE);
				this.cache = JSON.parse(raw) as CacheMap;
			}
		} catch {
			this.cache = {};
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
			await this.vault.adapter.write(CACHE_FILE, data);
		} catch {
			// Give up silently
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
	 * otherwise opens the EPUB (or reuses a pooled instance),
	 * resolves, and caches.
	 */
	async resolve(
		epubPath: string,
		cfiRange: string,
		cfiKey: string,
	): Promise<{ text: string; chapter?: string } | null> {
		const cached = this.getCached(epubPath, cfiKey);
		if (cached) return cached;

		try {
			const book = await this.getOrOpenBook(epubPath);
			if (!book) return null;

			const range = await book.getRange(cfiRange);
			if (!range) return null;

			const text = range.toString();
			const result = { text };

			if (!this.cache[epubPath]) {
				this.cache[epubPath] = {};
			}
			this.cache[epubPath][cfiKey] = result;
			this.dirty = true;
			this.scheduleSave();

			return result;
		} catch {
			return null;
		}
	}

	/**
	 * Batch-resolve multiple CFI ranges from the same book in one go.
	 * Opens the book once and resolves all ranges.
	 */
	async batchResolve(
		epubPath: string,
		items: { cfiRange: string; cfiKey: string }[],
	): Promise<Map<string, { text: string; chapter?: string }>> {
		const results = new Map<string, { text: string; chapter?: string }>();

		// Separate cached from uncached
		const uncached: { cfiRange: string; cfiKey: string }[] = [];
		for (const item of items) {
			const cached = this.getCached(epubPath, item.cfiKey);
			if (cached) {
				results.set(item.cfiKey, cached);
			} else {
				uncached.push(item);
			}
		}

		if (uncached.length === 0) return results;

		try {
			const book = await this.getOrOpenBook(epubPath);
			if (!book) return results;

			for (const item of uncached) {
				try {
					const range = await book.getRange(item.cfiRange);
					if (range) {
						const result = { text: range.toString() };
						results.set(item.cfiKey, result);

						if (!this.cache[epubPath]) {
							this.cache[epubPath] = {};
						}
						this.cache[epubPath][item.cfiKey] = result;
						this.dirty = true;
					}
				} catch {
					// Skip individual failures
				}
			}

			if (this.dirty) this.scheduleSave();
		} catch {
			// Book open failed
		}

		return results;
	}

	/**
	 * Get a book from the pool or open a new one.
	 * Evicts the least-recently-used entry if pool is full.
	 */
	private async getOrOpenBook(epubPath: string): Promise<Book | null> {
		const pooled = this.bookPool.get(epubPath);
		if (pooled) {
			pooled.lastUsed = Date.now();
			return pooled.book;
		}

		const file = this.vault.getAbstractFileByPath(epubPath);
		if (!(file instanceof TFile)) return null;

		const data = await this.vault.readBinary(file);
		const book = ePub();
		await book.open(data, "binary");
		await book.loaded.navigation;

		// Evict LRU if pool is full
		if (this.bookPool.size >= POOL_MAX) {
			let oldestKey = "";
			let oldestTime = Infinity;
			for (const [key, entry] of this.bookPool) {
				if (entry.lastUsed < oldestTime) {
					oldestTime = entry.lastUsed;
					oldestKey = key;
				}
			}
			if (oldestKey) {
				this.bookPool.get(oldestKey)?.book.destroy();
				this.bookPool.delete(oldestKey);
			}
		}

		this.bookPool.set(epubPath, { book, lastUsed: Date.now() });
		return book;
	}

	/**
	 * Destroy all pooled book instances. Call on plugin unload.
	 */
	destroyPool(): void {
		for (const entry of this.bookPool.values()) {
			entry.book.destroy();
		}
		this.bookPool.clear();
	}
}
