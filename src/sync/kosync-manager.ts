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
			const { all } = this.computeHashes(filePath, fileData);
			const localProgress = this.progressStore.get(filePath);

			// Pull from ALL hashes, pick the most recent
			let bestServer: KoSyncProgress | null = null;
			for (const hash of all) {
				const sp = await this.client.getProgress(hash);
				if (
					sp &&
					(!bestServer ||
						(sp.timestamp ?? 0) > (bestServer.timestamp ?? 0))
				) {
					bestServer = sp;
				}
			}

			if (!bestServer && !localProgress) {
				return { action: "none" };
			}

			if (!bestServer && localProgress) {
				await this.pushToAllHashes(all, localProgress);
				return { action: "pushed" };
			}

			if (bestServer && !localProgress) {
				const converted = this.serverToLocal(bestServer);
				this.progressStore.set(filePath, converted);
				this.progressStore.scheduleSave();
				return { action: "pulled", progress: converted };
			}

			// Both exist — compare timestamps
			const serverTime = bestServer!.timestamp ?? 0;
			const localTime = Math.floor(
				new Date(localProgress!.updated).getTime() / 1000,
			);

			if (serverTime > localTime) {
				const converted = this.serverToLocal(bestServer!);
				this.progressStore.set(filePath, converted);
				this.progressStore.scheduleSave();
				return { action: "pulled", progress: converted };
			}

			if (localTime > serverTime) {
				await this.pushToAllHashes(all, localProgress!);
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
			const { all } = this.computeHashes(filePath, fileData);
			await this.pushToAllHashes(all, progress);
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

	/**
	 * Compute all relevant hashes for a document.
	 * Returns the primary hash (based on settings) plus any additional
	 * hashes to sync with (binary, filename, and KOReader device filename
	 * from the companion note's `koreader-filename` frontmatter property).
	 */
	private computeHashes(
		filePath: string,
		fileData: ArrayBuffer,
	): { primary: string; all: string[] } {
		const cacheKey = `__hashes__${filePath}`;
		const cached = this.hashCache.get(cacheKey);
		if (cached) {
			const all = cached.split(",");
			return { primary: all[0]!, all };
		}

		const basename = filePath.split("/").pop() ?? filePath;
		const binHash = partialMD5(fileData);
		const fnHash = filenameMD5(basename);

		const primary =
			this.settings.kosyncChecksumMethod === "filename"
				? fnHash
				: binHash;

		const hashSet = new Set([primary, binHash, fnHash]);

		// If the companion note has a koreader-filename, hash that too
		const koreaderFn = this.progressStore.getKoreaderFilename(filePath);
		if (koreaderFn) {
			const name = koreaderFn.includes(".")
				? koreaderFn
				: koreaderFn + ".epub";
			hashSet.add(filenameMD5(name));
		}

		const all = [...hashSet];
		this.hashCache.set(cacheKey, all.join(","));
		return { primary, all };
	}

	private async pushToAllHashes(
		hashes: string[],
		progress: ReadingProgress,
	): Promise<void> {
		for (const hash of hashes) {
			const result = await this.client.putProgress({
				document: hash,
				progress: progress.cfi ?? "",
				percentage: progress.percent / 100,
				device: this.settings.kosyncDeviceName,
				device_id: this.settings.kosyncDeviceId,
			});
			if (result) {
				console.debug(
					"[EPUB++] KoSync: pushed to hash",
					hash,
					"timestamp:",
					result.timestamp,
				);
			}
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
