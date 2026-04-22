import { Notice, Plugin, TFile, parseLinktext, WorkspaceLeaf } from "obsidian";
import type { PaneType, OpenViewState } from "obsidian";
import { EPUB_VIEW_TYPE } from "./constants";
import {
	DEFAULT_SETTINGS,
	EpubPlusSettingTab,
	migrateSettings,
} from "./settings";
import type { EpubPlusSettings } from "./settings";
import { EpubView } from "./reader/epub-view";
import { ProgressStore } from "./progress/progress-store";
import { EpubTextCache } from "./embeds/epub-text-cache";
import { registerEpubEmbedProcessor } from "./embeds/epub-embed-processor";
import { KoSyncManager } from "./sync/kosync-manager";

export default class EpubPlusPlugin extends Plugin {
	settings: EpubPlusSettings = DEFAULT_SETTINGS;
	progressStore: ProgressStore = null!;
	textCache: EpubTextCache = null!;
	kosyncManager: KoSyncManager | null = null;
	private originalOpenLinkText:
		| ((
				linktext: string,
				sourcePath: string,
				newLeaf?: PaneType | boolean,
				openViewState?: OpenViewState,
		  ) => Promise<void>)
		| null = null;

	async onload(): Promise<void> {
		const loaded = migrateSettings(
			(await this.loadData()) as Partial<EpubPlusSettings> ?? {},
		);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		this.progressStore = new ProgressStore(
			this.app.vault,
			this.app,
			this.settings.progressStorage,
			this.settings.companionNoteLinks,
		);
		await this.progressStore.load();

		// Prune stale entries after layout is ready (vault fully indexed)
		this.app.workspace.onLayoutReady(() => {
			void this.progressStore.pruneDeleted(this.app.vault.adapter);
		});

		this.textCache = new EpubTextCache(this.app.vault);
		await this.textCache.load();

		this.registerView(
			EPUB_VIEW_TYPE,
			(leaf) => new EpubView(leaf, this),
		);
		this.registerExtensions(["epub"], EPUB_VIEW_TYPE);

		this.patchOpenLinkText();
		registerEpubEmbedProcessor(this);

		// Generate a stable device ID on first run
		if (!this.settings.kosyncDeviceId) {
			this.settings.kosyncDeviceId = this.generateDeviceId();
			await this.saveData(this.settings);
		}

		this.initKoSync();

		this.addCommand({
			id: "continue-reading",
			name: "Continue reading",
			callback: () => this.continueReading(),
		});

		this.addCommand({
			id: "kosync-pull",
			name: "Pull reading progress from KOSync server",
			checkCallback: (checking) => {
				const view = this.getActiveEpubView();
				if (!view || !this.kosyncManager) return false;
				if (checking) return true;
				void this.pullKosyncProgress(view);
				return true;
			},
		});

		this.addCommand({
			id: "kosync-scan-calibre",
			name: "Scan for KOReader progress (Calibre filename variants)",
			checkCallback: (checking) => {
				const view = this.getActiveEpubView();
				if (!view || !this.kosyncManager) return false;
				if (checking) return true;
				void this.scanAndPullCalibre(view);
				return true;
			},
		});

		this.addSettingTab(new EpubPlusSettingTab(this.app, this));
	}

	onunload(): void {
		this.unpatchOpenLinkText();
		this.kosyncManager?.clearCache();
		this.kosyncManager = null;
		void this.progressStore.save().catch((e) =>
			console.error("[EPUB++] Failed to save progress on unload:", e),
		);
		void this.textCache.save().catch((e) =>
			console.error("[EPUB++] Failed to save text cache on unload:", e),
		);
		this.textCache.destroyPool();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Find an existing workspace leaf that has a given epub file open.
	 */
	findExistingEpubLeaf(
		filePath: string,
		excludeLeaf?: WorkspaceLeaf,
	): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType(EPUB_VIEW_TYPE);
		for (const leaf of leaves) {
			if (excludeLeaf && leaf === excludeLeaf) continue;
			if (
				leaf.view instanceof EpubView &&
				leaf.view.file?.path === filePath
			) {
				return leaf;
			}
		}
		return null;
	}

	initKoSync(): void {
		if (
			this.settings.kosyncEnabled &&
			this.settings.kosyncUsername &&
			this.settings.kosyncPassword
		) {
			if (this.kosyncManager) {
				this.kosyncManager.updateCredentials(this.settings);
			} else {
				this.kosyncManager = new KoSyncManager(
					this.progressStore,
					this.app.vault,
					this.settings,
				);
			}
		} else {
			this.kosyncManager?.clearCache();
			this.kosyncManager = null;
		}
	}

	private generateDeviceId(): string {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
			"",
		);
	}

	private patchOpenLinkText(): void {
		this.originalOpenLinkText =
			this.app.workspace.openLinkText.bind(this.app.workspace);

		this.app.workspace.openLinkText = async (
			linktext: string,
			sourcePath: string,
			newLeaf?: PaneType | boolean,
			openViewState?: OpenViewState,
		): Promise<void> => {
			const { path, subpath } = parseLinktext(linktext);
			const resolved =
				this.app.metadataCache.getFirstLinkpathDest(
					path,
					sourcePath,
				);

			if (resolved && resolved.extension === "epub") {
				const existingLeaf = this.findExistingEpubLeaf(
					resolved.path,
				);

				if (existingLeaf) {
					this.app.workspace.setActiveLeaf(existingLeaf, {
						focus: true,
					});
					if (subpath) {
						existingLeaf.view.setEphemeralState({
							subpath,
						});
					}
					return;
				}

				const leaf = this.app.workspace.getLeaf("tab");
				await leaf.openFile(resolved, {
					eState: subpath ? { subpath } : undefined,
				});
				return;
			}

			return this.originalOpenLinkText!(
				linktext,
				sourcePath,
				newLeaf,
				openViewState,
			);
		};
	}

	private unpatchOpenLinkText(): void {
		if (this.originalOpenLinkText) {
			this.app.workspace.openLinkText =
				this.originalOpenLinkText;
			this.originalOpenLinkText = null;
		}
	}

	private async continueReading(): Promise<void> {
		const recent = this.progressStore.getMostRecent();
		if (!recent) return;

		const file = this.app.vault.getAbstractFileByPath(recent.path);
		if (!(file instanceof TFile)) return;

		const existingLeaf = this.findExistingEpubLeaf(file.path);

		if (existingLeaf) {
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
			existingLeaf.view.setEphemeralState({
				subpath: `#cfi=${recent.progress.cfi}`,
			});
		} else {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file, {
				eState: { subpath: `#cfi=${recent.progress.cfi}` },
			});
		}
	}

	private getActiveEpubView(): EpubView | null {
		const leaf = this.app.workspace.activeLeaf;
		if (leaf?.view instanceof EpubView) return leaf.view;
		return null;
	}

	private async scanAndPullCalibre(view: EpubView): Promise<void> {
		if (!this.kosyncManager || !view.file) return;

		const sp = await this.kosyncManager.scanForCalibreProgress(
			view.file.path,
		);
		if (!sp) return;

		// Now do a full pull which will include the newly discovered hash
		const fileData = view.getFileData();
		if (!fileData) return;

		const result = await this.kosyncManager.syncOnOpen(
			view.file.path,
			fileData,
		);

		if (result.action === "pulled" && result.progress) {
			if (result.progress.cfi) {
				view.setEphemeralState({
					subpath: `#cfi=${result.progress.cfi}`,
				});
			} else if (result.progress.percent > 0) {
				view.navigateToPercent(result.progress.percent / 100);
			}
			new Notice(
				`Synced to ${result.progress.percent}% from KOReader`,
			);
		}
	}

	private async pullKosyncProgress(view: EpubView): Promise<void> {
		if (!this.kosyncManager) {
			new Notice("Enable KOSync and enter credentials first");
			return;
		}

		const file = view.file;
		const fileData = view.getFileData();
		if (!file || !fileData) {
			new Notice("No book is currently open");
			return;
		}

		const result = await this.kosyncManager.syncOnOpen(
			file.path,
			fileData,
		);

		if (result.action === "pulled" && result.progress) {
			if (result.progress.cfi) {
				view.setEphemeralState({
					subpath: `#cfi=${result.progress.cfi}`,
				});
			} else if (result.progress.percent > 0) {
				view.navigateToPercent(result.progress.percent / 100);
			}
			new Notice(
				`Synced to ${result.progress.percent}% from ${result.progress.updated}`,
			);
		} else if (result.action === "pushed") {
			new Notice("Local progress is newer — pushed to server");
		} else if (result.action === "error") {
			new Notice("Failed to sync — check the console for details");
		} else {
			new Notice("Already in sync");
		}
	}
}
