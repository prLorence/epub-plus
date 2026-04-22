import { Notice, Vault } from "obsidian";
import { KoSyncClient } from "./kosync-client";
import type { KoSyncProgress } from "./kosync-client";
import { partialMD5, filenameMD5 } from "./document-hash";
import type { ProgressStore } from "../progress/progress-store";
import type { ReadingProgress } from "../types";
import type { EpubPlusSettings } from "../settings";

export interface SyncResult {
	action: "pulled" | "pushed" | "none" | "error";
	progress?: ReadingProgress;
}

export class KoSyncManager {
	private client: KoSyncClient;
	/** Cache document hashes for the session to avoid recomputation. */
	private hashCache = new Map<string, string>();

	constructor(
		private progressStore: ProgressStore,
		private vault: Vault,
		private settings: EpubPlusSettings,
	) {
		this.client = new KoSyncClient({
			server: settings.kosyncServer,
			username: settings.kosyncUsername,
			password: settings.kosyncPassword,
		});
	}

	/**
	 * Recompute the client if credentials change.
	 */
	updateCredentials(settings: EpubPlusSettings): void {
		this.settings = settings;
		this.client = new KoSyncClient({
			server: settings.kosyncServer,
			username: settings.kosyncUsername,
			password: settings.kosyncPassword,
		});
	}

	/**
	 * Sync progress when an EPUB is opened.
	 * Pulls from server if newer, pushes local if newer.
	 */
	async syncOnOpen(
		filePath: string,
		fileData: ArrayBuffer,
	): Promise<SyncResult> {
		if (!this.settings.kosyncEnabled || !this.settings.kosyncSyncOnOpen) {
			return { action: "none" };
		}

		try {
			const hash = this.computeHash(filePath, fileData);
			const serverProgress = await this.client.getProgress(hash);
			const localProgress = this.progressStore.get(filePath);

			if (!serverProgress && !localProgress) {
				return { action: "none" };
			}

			if (!serverProgress && localProgress) {
				await this.pushToServer(hash, localProgress);
				return { action: "pushed" };
			}

			if (serverProgress && !localProgress) {
				const converted = this.serverToLocal(serverProgress);
				this.progressStore.set(filePath, converted);
				this.progressStore.scheduleSave();
				return { action: "pulled", progress: converted };
			}

			// Both exist — compare timestamps
			const serverTime = serverProgress!.timestamp ?? 0;
			const localTime = Math.floor(
				new Date(localProgress!.updated).getTime() / 1000,
			);

			if (serverTime > localTime) {
				const converted = this.serverToLocal(serverProgress!);
				this.progressStore.set(filePath, converted);
				this.progressStore.scheduleSave();
				return { action: "pulled", progress: converted };
			}

			if (localTime > serverTime) {
				await this.pushToServer(hash, localProgress!);
				return { action: "pushed" };
			}

			return { action: "none" };
		} catch (e) {
			console.warn("[EPUB++] KoSync: sync on open failed:", e);
			return { action: "error" };
		}
	}

	/**
	 * Push current progress to the server.
	 * Called on page turns (debounced) and on file close.
	 */
	async pushProgress(
		filePath: string,
		fileData: ArrayBuffer,
		progress: ReadingProgress,
	): Promise<void> {
		if (
			!this.settings.kosyncEnabled ||
			!this.settings.kosyncSyncOnProgress
		) {
			return;
		}

		try {
			const hash = this.computeHash(filePath, fileData);
			await this.pushToServer(hash, progress);
		} catch (e) {
			console.warn("[EPUB++] KoSync: push progress failed:", e);
		}
	}

	/**
	 * Test the current credentials.
	 */
	async testConnection(): Promise<boolean> {
		try {
			const ok = await this.client.authorize();
			if (ok) {
				new Notice("Sync server: connection successful");
			} else {
				new Notice(
					"Sync server: authentication failed — check your credentials",
				);
			}
			return ok;
		} catch {
			new Notice("Sync server: could not reach server");
			return false;
		}
	}

	private computeHash(filePath: string, fileData: ArrayBuffer): string {
		const cached = this.hashCache.get(filePath);
		if (cached) return cached;

		let hash: string;
		if (this.settings.kosyncChecksumMethod === "filename") {
			const basename = filePath.split("/").pop() ?? filePath;
			hash = filenameMD5(basename);
		} else {
			hash = partialMD5(fileData);
		}

		this.hashCache.set(filePath, hash);
		return hash;
	}

	private async pushToServer(
		hash: string,
		progress: ReadingProgress,
	): Promise<void> {
		const result = await this.client.putProgress({
			document: hash,
			progress: progress.cfi ?? "",
			percentage: progress.percent / 100, // local stores 0-100, server expects 0-1
			device: this.settings.kosyncDeviceName,
			device_id: this.settings.kosyncDeviceId,
		});

		if (result) {
			console.debug(
				"[EPUB++] KoSync: pushed progress, server timestamp:",
				result.timestamp,
			);
		}
	}

	private serverToLocal(server: KoSyncProgress): ReadingProgress {
		const timestamp = server.timestamp
			? new Date(server.timestamp * 1000).toISOString()
			: new Date().toISOString();

		// Only store the progress string as CFI if it's actually an EPUB CFI.
		// KOReader sends XPointers (e.g. "/body/DocFragment[20]/body/p[22]/img.0")
		// which are NOT valid CFIs and will crash EPUB.js if passed to display().
		const progress = server.progress || "";
		const cfi =
			progress.startsWith("epubcfi(") ? progress : "";

		return {
			cfi,
			percent: Math.round(server.percentage * 100), // server stores 0-1, local uses 0-100
			updated: timestamp,
		};
	}

	/**
	 * Clear the hash cache (e.g. on plugin unload).
	 */
	clearCache(): void {
		this.hashCache.clear();
	}
}
