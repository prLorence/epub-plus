import { Notice, Vault } from "obsidian";
import { KoSyncClient } from "./kosync-client";
import type { KoSyncProgress } from "./kosync-client";
import { partialMD5, filenameMD5 } from "./document-hash";
import { xpathToCfi, cfiToXpath } from "./xpath-to-cfi";
import type { ProgressStore } from "../progress/progress-store";
import type { ReadingProgress } from "../types";
import type { EpubPlusSettings } from "../settings";
import type Book from "epubjs/types/book";

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
		this.hashCache.clear(); // Settings may change the hash method
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
		book?: Book,
	): Promise<SyncResult> {
		if (!this.settings.kosyncEnabled || !this.settings.kosyncSyncOnOpen) {
			return { action: "none" };
		}

		try {
			const { primary, all } = this.computeHashes(filePath, fileData);
			const localProgress = this.progressStore.get(filePath);

			// Pull from ALL hashes in parallel, pick the most recent entry.
			// The KOSync API stores one entry per hash — after we push,
			// only our own entry remains. So we use whatever the server
			// has (from any device) as the source of truth.
			const results = await Promise.all(
				all.map((hash) => this.client.getProgress(hash)),
			);

			let best: KoSyncProgress | null = null;
			for (const sp of results) {
				if (!sp || sp.percentage === 0) continue;
				if (
					!best ||
					(sp.timestamp ?? 0) > (best.timestamp ?? 0)
				) {
					best = sp;
				}
			}

			if (best) {
				const converted = await this.serverToLocal(best, book);
				console.info(
					"[EPUB++] KoSync: pulled progress →",
					converted.percent + "%",
					"from",
					best.device,
					"cfi:",
					converted.cfi ? "yes" : "no (percent fallback)",
				);
				return { action: "pulled", progress: converted };
			}

			// Server has nothing — push local if we have it
			if (localProgress) {
				await this.pushToHash(primary, localProgress);
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
		book?: Book,
	): Promise<void> {
		if (
			!this.settings.kosyncEnabled ||
			!this.settings.kosyncSyncOnProgress
		) {
			return;
		}

		try {
			const { primary } = this.computeHashes(filePath, fileData);

			// Convert CFI to KOReader XPath so KOReader can parse it
			let progressStr = progress.cfi ?? "";
			if (progressStr.startsWith("epubcfi(") && book) {
				const xpath = await cfiToXpath(progressStr, book);
				if (xpath) {
					console.info(
						"[EPUB++] KoSync: converted CFI to XPath:",
						xpath,
					);
					progressStr = xpath;
				}
			}

			await this.client.putProgress({
				document: primary,
				progress: progressStr,
				percentage: progress.percent / 100,
				device: this.settings.kosyncDeviceName,
				device_id: this.settings.kosyncDeviceId,
			});
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

	private async pushToHash(
		hash: string,
		progress: ReadingProgress,
	): Promise<void> {
		await this.client.putProgress({
			document: hash,
			progress: progress.cfi ?? "",
			percentage: progress.percent / 100,
			device: this.settings.kosyncDeviceName,
			device_id: this.settings.kosyncDeviceId,
		});
	}

	private async serverToLocal(
		server: KoSyncProgress,
		book?: Book,
	): Promise<ReadingProgress> {
		const timestamp = server.timestamp
			? new Date(server.timestamp * 1000).toISOString()
			: new Date().toISOString();

		const progress = server.progress || "";
		let cfi = "";

		if (progress.startsWith("epubcfi(")) {
			// Already a valid CFI
			cfi = progress;
		} else if (progress && book) {
			// Try to convert KOReader XPath to CFI
			const converted = await xpathToCfi(progress, book);
			if (converted) {
				// cfiFromRange can return range CFIs with commas —
				// extract just the start point for navigation
				cfi = converted.includes(",")
					? converted.replace(/,.*\)$/, ")")
					: converted;
				console.debug(
					"[EPUB++] KoSync: converted XPath to CFI:",
					progress,
					"→",
					cfi,
				);
			} else {
				console.debug(
					"[EPUB++] KoSync: XPath conversion returned null for:",
					progress,
				);
			}
		}

		return {
			cfi,
			percent: Math.round(server.percentage * 100),
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
