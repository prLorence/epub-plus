import { TFile, Vault } from "obsidian";
import { READING_STATE_FILE } from "../constants";
import type { ReadingProgress, ReadingStateMap } from "../types";

export class ProgressStore {
	private state: ReadingStateMap = {};
	private dirty = false;
	private saving = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private vault: Vault) {}

	async load(): Promise<void> {
		const file = this.vault.getAbstractFileByPath(READING_STATE_FILE);
		if (file instanceof TFile) {
			try {
				const raw = await this.vault.read(file);
				this.state = JSON.parse(raw) as ReadingStateMap;
				console.debug("[EPUB++] ProgressStore loaded:", Object.keys(this.state).length, "entries");
				for (const [path, progress] of Object.entries(this.state)) {
					console.debug("[EPUB++]   ", path, "→", progress.percent + "%", progress.cfi);
				}
			} catch {
				this.state = {};
				console.debug("[EPUB++] ProgressStore: failed to parse, starting empty");
			}
		} else {
			console.debug("[EPUB++] ProgressStore: no state file found");
		}
	}

	async save(): Promise<void> {
		if (!this.dirty || this.saving) return;
		this.saving = true;
		console.debug("[EPUB++] ProgressStore saving...");
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}

		const data = JSON.stringify(this.state, null, 2);
		try {
			const file = this.vault.getAbstractFileByPath(READING_STATE_FILE);
			if (file instanceof TFile) {
				await this.vault.modify(file, data);
			} else {
				await this.vault.create(READING_STATE_FILE, data);
			}
		} catch {
			// File may have been created by another instance, retry as modify
			try {
				const file = this.vault.getAbstractFileByPath(READING_STATE_FILE);
				if (file instanceof TFile) {
					await this.vault.modify(file, data);
				}
			} catch {
				// Give up silently
			}
		}
		this.dirty = false;
		this.saving = false;
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
}
