import { App, Vault } from "obsidian";
import { READING_STATE_FILE } from "../constants";
import { FrontmatterProgressStore } from "./frontmatter-store";
import type { ReadingProgress, ReadingStateMap } from "../types";

type StorageMethod = "frontmatter" | "json";

export class ProgressStore {
	private state: ReadingStateMap = {};
	private dirty = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private savePromise: Promise<void> | null = null;
	private frontmatterStore: FrontmatterProgressStore;
	private storageMethod: StorageMethod;

	constructor(
		private vault: Vault,
		app: App,
		storageMethod: StorageMethod = "frontmatter",
	) {
		this.storageMethod = storageMethod;
		this.frontmatterStore = new FrontmatterProgressStore(app);
	}

	setStorageMethod(method: StorageMethod): void {
		this.storageMethod = method;
	}

	setCompanionNote(epubPath: string, notePath: string): void {
		this.frontmatterStore.setCompanionNote(epubPath, notePath);
	}

	getCompanionNotePath(epubPath: string): string {
		return this.frontmatterStore.getCompanionNotePath(epubPath);
	}

	async load(): Promise<void> {
		// Always load the JSON state as in-memory cache
		const adapter = this.vault.adapter;
		try {
			if (await adapter.exists(READING_STATE_FILE)) {
				const raw = await adapter.read(READING_STATE_FILE);
				this.state = JSON.parse(raw) as ReadingStateMap;
				console.debug("[EPUB++] ProgressStore loaded:", Object.keys(this.state).length, "entries");
			}
		} catch (e) {
			this.state = {};
			console.warn("[EPUB++] ProgressStore: failed to load:", e);
		}
	}

	async save(): Promise<void> {
		if (this.savePromise) {
			await this.savePromise;
		}
		if (!this.dirty) return;
		this.dirty = false;
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		if (this.storageMethod === "json") {
			const data = JSON.stringify(this.state, null, 2);
			this.savePromise = this.vault.adapter
				.write(READING_STATE_FILE, data)
				.then(() => {
					console.debug("[EPUB++] ProgressStore saved to disk");
				})
				.catch((e) => {
					console.error("[EPUB++] ProgressStore: failed to save:", e);
				})
				.finally(() => {
					this.savePromise = null;
				});
			await this.savePromise;
		}
		// Frontmatter saves happen immediately in set()
	}

	scheduleSave(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.save();
		}, 2000);
	}

	get(filePath: string): ReadingProgress | undefined {
		return this.state[filePath];
	}

	/**
	 * Load progress for a file, checking frontmatter first if that's
	 * the active storage method. Call this on file open.
	 */
	async getAsync(filePath: string): Promise<ReadingProgress | undefined> {
		// Check in-memory cache first
		const cached = this.state[filePath];

		if (this.storageMethod === "frontmatter") {
			const fm = await this.frontmatterStore.get(filePath);
			if (fm && fm.cfi) {
				// Frontmatter is authoritative — update cache
				this.state[filePath] = fm;
				return fm;
			}
		}

		return cached;
	}

	set(filePath: string, progress: ReadingProgress): void {
		this.state[filePath] = progress;
		this.dirty = true;

		if (this.storageMethod === "frontmatter") {
			// Debounce frontmatter writes to avoid excessive file modifications
			void this.frontmatterStore.set(filePath, progress);
		}
	}

	getMostRecent(): { path: string; progress: ReadingProgress } | null {
		let latest: { path: string; progress: ReadingProgress } | null = null;
		for (const [path, progress] of Object.entries(this.state)) {
			if (!latest || progress.updated > latest.progress.updated) {
				latest = { path, progress };
			}
		}
		return latest;
	}

	/**
	 * Get the most recent, checking frontmatter if active.
	 */
	async getMostRecentAsync(): Promise<{
		path: string;
		progress: ReadingProgress;
	} | null> {
		if (this.storageMethod === "frontmatter") {
			const fm = await this.frontmatterStore.getMostRecent();
			if (fm) return fm;
		}
		return this.getMostRecent();
	}

	async pruneDeleted(adapter: {
		exists: (path: string) => Promise<boolean>;
	}): Promise<void> {
		let pruned = 0;
		for (const path of Object.keys(this.state)) {
			if (!(await adapter.exists(path))) {
				delete this.state[path];
				pruned++;
			}
		}
		if (pruned > 0) {
			this.dirty = true;
			console.debug("[EPUB++] ProgressStore pruned", pruned, "stale entries");
			this.scheduleSave();
		}
	}
}
