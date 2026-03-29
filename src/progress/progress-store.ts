import { Vault } from "obsidian";
import { READING_STATE_FILE } from "../constants";
import type { ReadingProgress, ReadingStateMap } from "../types";

export class ProgressStore {
	private state: ReadingStateMap = {};
	private dirty = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private vault: Vault) {}

	async load(): Promise<void> {
		const adapter = this.vault.adapter;
		try {
			if (await adapter.exists(READING_STATE_FILE)) {
				const raw = await adapter.read(READING_STATE_FILE);
				this.state = JSON.parse(raw) as ReadingStateMap;
				console.debug("[EPUB++] ProgressStore loaded:", Object.keys(this.state).length, "entries");
			} else {
				console.debug("[EPUB++] ProgressStore: no state file found");
			}
		} catch (e) {
			this.state = {};
			console.warn("[EPUB++] ProgressStore: failed to load:", e);
		}
	}

	private savePromise: Promise<void> | null = null;

	async save(): Promise<void> {
		// Wait for any in-flight save to finish first
		if (this.savePromise) {
			await this.savePromise;
		}
		if (!this.dirty) return;
		this.dirty = false;
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		const data = JSON.stringify(this.state, null, 2);
		this.savePromise = this.vault.adapter
			.write(READING_STATE_FILE, data)
			.then(() => {
				console.debug("[EPUB++] ProgressStore saved to disk");
			})
			.catch((e) => {
				console.error(
					"[EPUB++] ProgressStore: failed to save:",
					e,
				);
			})
			.finally(() => {
				this.savePromise = null;
			});
		await this.savePromise;
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

	set(filePath: string, progress: ReadingProgress): void {
		this.state[filePath] = progress;
		this.dirty = true;
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
	 * Remove entries for files that no longer exist on disk.
	 * Uses adapter.exists() to check each path directly,
	 * since vault.getFiles() may not include binary files like .epub.
	 */
	async pruneDeleted(adapter: { exists: (path: string) => Promise<boolean> }): Promise<void> {
		let pruned = 0;
		for (const path of Object.keys(this.state)) {
			if (!(await adapter.exists(path))) {
				delete this.state[path];
				pruned++;
			}
		}
		if (pruned > 0) {
			this.dirty = true;
			console.debug(
				"[EPUB++] ProgressStore pruned",
				pruned,
				"stale entries",
			);
			this.scheduleSave();
		}
	}
}
