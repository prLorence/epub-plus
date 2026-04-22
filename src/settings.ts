import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import SparkMD5 from "spark-md5";
import type EpubPlusPlugin from "./main";
import type { PaletteColor } from "./types";
import { DEFAULT_PALETTE } from "./constants";

export interface CopyTemplate {
	name: string;
	template: string;
}

export interface EpubPlusSettings {
	// Reader
	engineType: "epubjs" | "native" | "zotero";
	readingMode: "paginated" | "scrolled";
	fontSize: number;
	fontFamily: string;
	lineHeight: number;
	marginSize: number;
	maxContentWidth: number; // 0 = no limit
	theme: "auto" | "light" | "dark" | "sepia";
	showTocOnOpen: boolean;
	autoSaveProgress: boolean;
	progressSyncPages: number;
	progressStorage: "frontmatter" | "json";

	// Backlink highlighting
	enableBacklinkHighlighting: boolean;
	highlightOpacity: number;
	colorPalette: PaletteColor[];

	// Copy & templates
	defaultHighlightColor: string;
	copyTemplate: string;
	copyTemplates: CopyTemplate[];
	defaultTemplateName: string;
	autoCopyOnHighlight: boolean;
	addToNoteMode: "append" | "cursor";

	// Hover & navigation
	hoverAction: "preview" | "open" | "disabled";
	hoverSyncMode:
		| "both"
		| "epub-to-backlinks"
		| "backlinks-to-epub"
		| "disabled";

	// Chapter filter
	filterBacklinksByChapter: boolean;
	showBacklinkPanel: boolean;

	// Keyboard & navigation
	enableVimBindings: boolean;

	// Companion note links (epub path → note path, persisted)
	companionNoteLinks: Record<string, string>;

	// KOReader Sync
	kosyncEnabled: boolean;
	kosyncServer: string;
	kosyncUsername: string;
	kosyncPassword: string; // MD5-hashed
	kosyncDeviceName: string;
	kosyncDeviceId: string;
	kosyncChecksumMethod: "binary" | "filename";
	kosyncSyncOnOpen: boolean;
	kosyncSyncOnProgress: boolean;
}

const DEFAULT_TEMPLATE =
	"> [!quote|{{color}}] {{chapter}}\n> {{linkedSelection}}";

export const DEFAULT_SETTINGS: EpubPlusSettings = {
	engineType: "epubjs",
	readingMode: "paginated",
	fontSize: 18,
	fontFamily: "",
	lineHeight: 1.6,
	marginSize: 40,
	maxContentWidth: 0,
	theme: "auto",
	showTocOnOpen: false,
	autoSaveProgress: true,
	progressSyncPages: 5,
	progressStorage: "frontmatter",

	enableBacklinkHighlighting: true,
	highlightOpacity: 0.3,
	colorPalette: [...DEFAULT_PALETTE],

	defaultHighlightColor: "yellow",
	copyTemplate: DEFAULT_TEMPLATE,
	copyTemplates: [{ name: "Default", template: DEFAULT_TEMPLATE }],
	defaultTemplateName: "Default",
	autoCopyOnHighlight: false,
	addToNoteMode: "append",

	hoverAction: "preview",
	hoverSyncMode: "both",

	filterBacklinksByChapter: false,
	showBacklinkPanel: false,

	enableVimBindings: false,

	companionNoteLinks: {},

	kosyncEnabled: false,
	kosyncServer: "https://sync.koreader.rocks",
	kosyncUsername: "",
	kosyncPassword: "",
	kosyncDeviceName: "Obsidian",
	kosyncDeviceId: "",
	kosyncChecksumMethod: "binary",
	kosyncSyncOnOpen: true,
	kosyncSyncOnProgress: true,
};

/**
 * Migrate old single-template settings to multi-template format.
 */
export function migrateSettings(
	loaded: Partial<EpubPlusSettings>,
): Partial<EpubPlusSettings> {
	if (
		loaded.copyTemplate &&
		(!loaded.copyTemplates || loaded.copyTemplates.length === 0)
	) {
		loaded.copyTemplates = [
			{ name: "Default", template: loaded.copyTemplate },
		];
		loaded.defaultTemplateName = "Default";
	}
	return loaded;
}

export class EpubPlusSettingTab extends PluginSettingTab {
	plugin: EpubPlusPlugin;

	constructor(app: App, plugin: EpubPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderReaderSection(containerEl);
		this.renderBacklinkSection(containerEl);
		this.renderCopySection(containerEl);
		this.renderHoverSection(containerEl);
		this.renderKeyboardSection(containerEl);
		this.renderProgressSection(containerEl);
		this.renderKoSyncSection(containerEl);
	}

	private renderReaderSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Reader").setHeading();

		new Setting(containerEl)
			.setName("Rendering engine")
			.setDesc(
				"Choose between the stable engine or the experimental native engine that preserves book styling better. Requires reopening the book.",
			)
			.addDropdown((d) =>
				d
					.addOptions({
						epubjs: "epub.js (stable)",
						native: "Native (experimental)",
						zotero: "Zotero reader (coming soon)",
					})
					.setValue(this.plugin.settings.engineType)
					.onChange(async (v) => {
						this.plugin.settings.engineType =
							v as EpubPlusSettings["engineType"];
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Reading mode")
			.setDesc("How content is laid out in the reader.")
			.addDropdown((d) =>
				d
					.addOptions({
						paginated: "Paginated",
						scrolled: "Scrolled",
					})
					.setValue(this.plugin.settings.readingMode)
					.onChange(async (v) => {
						this.plugin.settings.readingMode =
							v as EpubPlusSettings["readingMode"];
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Font size")
			.setDesc("Base font size in pixels.")
			.addSlider((s) =>
				s
					.setLimits(10, 32, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.fontSize = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Font family")
			.setDesc("Leave blank to use the book's default font.")
			.addText((t) =>
				t
					.setPlaceholder("E.g. Georgia, serif")
					.setValue(this.plugin.settings.fontFamily)
					.onChange(async (v) => {
						this.plugin.settings.fontFamily = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Line height")
			.setDesc("Line height multiplier.")
			.addSlider((s) =>
				s
					.setLimits(1, 2.5, 0.1)
					.setValue(this.plugin.settings.lineHeight)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.lineHeight = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Margin")
			.setDesc("Horizontal margin in pixels.")
			.addSlider((s) =>
				s
					.setLimits(0, 100, 5)
					.setValue(this.plugin.settings.marginSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.marginSize = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Max content width")
			.setDesc(
				"Maximum width of the reading area in pixels. Set to 0 for no limit.",
			)
			.addText((t) =>
				t
					.setValue(
						String(this.plugin.settings.maxContentWidth),
					)
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (!isNaN(n) && n >= 0) {
							this.plugin.settings.maxContentWidth = n;
							await this.plugin.saveSettings();
						}
					}),
			)
			.then((s) => {
				const input = s.controlEl.querySelector("input");
				if (input) {
					input.type = "number";
					input.min = "0";
					input.placeholder = "0 (no limit)";
					input.addClass("epub-plus-narrow-input");
				}
			});

		new Setting(containerEl)
			.setName("Theme")
			.setDesc("Color theme for the reader.")
			.addDropdown((d) =>
				d
					.addOptions({
						auto: "Match Obsidian",
						light: "Light",
						dark: "Dark",
						sepia: "Sepia",
					})
					.setValue(this.plugin.settings.theme)
					.onChange(async (v) => {
						this.plugin.settings.theme =
							v as EpubPlusSettings["theme"];
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show table of contents on open")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showTocOnOpen)
					.onChange(async (v) => {
						this.plugin.settings.showTocOnOpen = v;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderBacklinkSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Backlink highlighting")
			.setHeading();

		new Setting(containerEl)
			.setName("Enable backlink highlighting")
			.setDesc("Render backlinks as colored highlights in the reader.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.enableBacklinkHighlighting)
					.onChange(async (v) => {
						this.plugin.settings.enableBacklinkHighlighting = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Highlight opacity")
			.setDesc("Opacity of backlink highlights (0.1 to 1.0).")
			.addSlider((s) =>
				s
					.setLimits(0.1, 1.0, 0.05)
					.setValue(this.plugin.settings.highlightOpacity)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.highlightOpacity = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show backlink panel")
			.setDesc("Show a panel listing backlinks for the current book.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showBacklinkPanel)
					.onChange(async (v) => {
						this.plugin.settings.showBacklinkPanel = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Filter backlinks by chapter")
			.setDesc(
				"Only show backlinks pointing to the currently visible chapter.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.filterBacklinksByChapter)
					.onChange(async (v) => {
						this.plugin.settings.filterBacklinksByChapter = v;
						await this.plugin.saveSettings();
					}),
			);

		// Color palette editor
		new Setting(containerEl)
			.setName("Color palette")
			.setDesc("Colors available for highlighting. Click + to add.");

		const paletteContainer = containerEl.createDiv({
			cls: "epub-plus-palette-editor",
		});
		this.renderPaletteEditor(paletteContainer);
	}

	private renderPaletteEditor(container: HTMLElement): void {
		container.empty();
		const palette = this.plugin.settings.colorPalette;

		for (let i = 0; i < palette.length; i++) {
			const color = palette[i]!;
			const row = container.createDiv({
				cls: "epub-plus-palette-row",
			});

			const swatch = row.createEl("span", {
				cls: "epub-plus-palette-swatch",
			});
			swatch.style.backgroundColor = color.hex;

			const nameInput = row.createEl("input", {
				type: "text",
				value: color.name,
				cls: "epub-plus-palette-name",
			});
			nameInput.addEventListener("change", () => {
				palette[i] = { ...color, name: nameInput.value };
				void this.plugin.saveSettings();
			});

			const hexInput = row.createEl("input", {
				type: "color",
				value: color.hex,
				cls: "epub-plus-palette-hex",
			});
			hexInput.addEventListener("input", () => {
				palette[i] = { ...color, hex: hexInput.value };
				swatch.style.backgroundColor = hexInput.value;
				void this.plugin.saveSettings();
			});

			const deleteBtn = row.createEl("button", {
				text: "\u00d7",
				cls: "epub-plus-palette-delete",
				title: "Remove color",
			});
			deleteBtn.addEventListener("click", () => {
				palette.splice(i, 1);
				void this.plugin.saveSettings();
				this.renderPaletteEditor(container);
			});
		}

		const addBtn = container.createEl("button", {
			text: "Add color",
			cls: "epub-plus-palette-add",
		});
		addBtn.addEventListener("click", () => {
			palette.push({ name: "new", hex: "#cccccc" });
			void this.plugin.saveSettings();
			this.renderPaletteEditor(container);
		});
	}

	private renderCopySection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Copy and templates").setHeading();

		new Setting(containerEl)
			.setName("Default highlight color")
			.setDesc("Color name used when copying a link to selection.")
			.addDropdown((d) => {
				for (const c of this.plugin.settings.colorPalette) {
					d.addOption(c.name, c.name);
				}
				d.setValue(this.plugin.settings.defaultHighlightColor);
				d.onChange(async (v) => {
					this.plugin.settings.defaultHighlightColor = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Copy template")
			.setDesc(
				"Template for copied links. Variables: {{fileName}}, {{title}}, {{author}}, {{chapter}}, {{selection}}, {{link}}, {{color}}.",
			)
			.addTextArea((t) =>
				t
					.setPlaceholder(DEFAULT_TEMPLATE)
					.setValue(this.plugin.settings.copyTemplate)
					.onChange(async (v) => {
						this.plugin.settings.copyTemplate = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-copy on highlight")
			.setDesc("Automatically copy the link when selecting a color.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoCopyOnHighlight)
					.onChange(async (v) => {
						this.plugin.settings.autoCopyOnHighlight = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Add to note mode")
			.setDesc(
				"When adding a link to the active note, append at end or insert at cursor.",
			)
			.addDropdown((d) =>
				d
					.addOptions({
						append: "Append to end",
						cursor: "Insert at cursor",
					})
					.setValue(this.plugin.settings.addToNoteMode)
					.onChange(async (v) => {
						this.plugin.settings.addToNoteMode =
							v as EpubPlusSettings["addToNoteMode"];
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderHoverSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Hover and navigation").setHeading();

		new Setting(containerEl)
			.setName("Hover action")
			.setDesc("What happens when hovering over a highlight.")
			.addDropdown((d) =>
				d
					.addOptions({
						preview: "Show preview",
						open: "Open note",
						disabled: "Disabled",
					})
					.setValue(this.plugin.settings.hoverAction)
					.onChange(async (v) => {
						this.plugin.settings.hoverAction =
							v as EpubPlusSettings["hoverAction"];
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Hover sync")
			.setDesc(
				"Synchronize hover between highlights and backlink panel.",
			)
			.addDropdown((d) =>
				d
					.addOptions({
						both: "Both directions",
						"epub-to-backlinks": "EPUB to backlinks only",
						"backlinks-to-epub": "Backlinks to EPUB only",
						disabled: "Disabled",
					})
					.setValue(this.plugin.settings.hoverSyncMode)
					.onChange(async (v) => {
						this.plugin.settings.hoverSyncMode =
							v as EpubPlusSettings["hoverSyncMode"];
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderKeyboardSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Keyboard").setHeading();

		new Setting(containerEl)
			.setName("Vim keybindings")
			.setDesc(
				"Use vim-style keys for page navigation. Requires reopening the book.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.enableVimBindings)
					.onChange(async (v) => {
						this.plugin.settings.enableVimBindings = v;
						await this.plugin.saveSettings();
					}),
			);
	}

	private renderProgressSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Progress").setHeading();

		new Setting(containerEl)
			.setName("Storage method")
			.setDesc(
				"Frontmatter: stores progress in a companion note next to the book. JSON: stores in a single .epub-reading-state.json file.",
			)
			.addDropdown((d) =>
				d
					.addOptions({
						frontmatter: "Companion note (frontmatter)",
						json: "Central JSON file",
					})
					.setValue(this.plugin.settings.progressStorage)
					.onChange(async (v) => {
						this.plugin.settings.progressStorage =
							v as EpubPlusSettings["progressStorage"];
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-save reading progress")
			.setDesc("Automatically save your reading position.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoSaveProgress)
					.onChange(async (v) => {
						this.plugin.settings.autoSaveProgress = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync every n pages")
			.setDesc(
				"Write progress to disk every n page turns. Lower values save more often but increase disk writes.",
			)
			.addText((t) =>
				t
					.setValue(
						String(this.plugin.settings.progressSyncPages),
					)
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						if (!isNaN(n) && n >= 1) {
							this.plugin.settings.progressSyncPages = n;
							await this.plugin.saveSettings();
						}
					}),
			)
			.then((s) => {
				const input = s.controlEl.querySelector("input");
				if (input) {
					input.type = "number";
					input.min = "1";
					input.addClass("epub-plus-narrow-input");
				}
			});
	}

	private renderKoSyncSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("KOReader sync").setHeading();

		new Setting(containerEl)
			.setName("Enable KOReader sync")
			.setDesc(
				"Sync reading progress with KOReader devices via the KOSync server.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.kosyncEnabled)
					.onChange(async (v) => {
						this.plugin.settings.kosyncEnabled = v;
						await this.plugin.saveSettings();
						this.plugin.initKoSync();
					}),
			);

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("KOSync server address.")
			.addText((t) =>
				t
					.setPlaceholder("https://sync.koreader.rocks")
					.setValue(this.plugin.settings.kosyncServer)
					.onChange(async (v) => {
						this.plugin.settings.kosyncServer = v;
						await this.plugin.saveSettings();
						this.plugin.initKoSync();
					}),
			);

		new Setting(containerEl)
			.setName("Username")
			.addText((t) =>
				t
					.setPlaceholder("username")
					.setValue(this.plugin.settings.kosyncUsername)
					.onChange(async (v) => {
						this.plugin.settings.kosyncUsername = v;
						await this.plugin.saveSettings();
						this.plugin.initKoSync();
					}),
			);

		new Setting(containerEl)
			.setName("Password")
			.setDesc(
				"Your KOSync password. Stored as MD5 hash (same as KOReader).",
			)
			.addText((t) => {
				t.inputEl.type = "password";
				if (this.plugin.settings.kosyncPassword) {
					t.setPlaceholder("••••••••");
				}
				t.onChange(async (v) => {
					if (v) {
						this.plugin.settings.kosyncPassword =
							SparkMD5.hash(v);
						await this.plugin.saveSettings();
						this.plugin.initKoSync();
					}
				});
			});

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Verify your credentials against the server.")
			.addButton((b) =>
				b.setButtonText("Test").onClick(async () => {
					if (!this.plugin.kosyncManager) {
						new Notice(
							"Enable sync and enter credentials first",
						);
						return;
					}
					await this.plugin.kosyncManager.testConnection();
				}),
			);

		new Setting(containerEl)
			.setName("Device name")
			.setDesc("How this device identifies itself to the sync server.")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.kosyncDeviceName)
					.onChange(async (v) => {
						this.plugin.settings.kosyncDeviceName = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Document matching method")
			.setDesc(
				"Binary: partial file hash (default, matches KOReader). Filename: hash of filename only (use if files are modified between devices).",
			)
			.addDropdown((d) =>
				d
					.addOptions({
						binary: "Binary (file content)",
						filename: "Filename",
					})
					.setValue(this.plugin.settings.kosyncChecksumMethod)
					.onChange(async (v) => {
						this.plugin.settings.kosyncChecksumMethod =
							v as EpubPlusSettings["kosyncChecksumMethod"];
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync on open")
			.setDesc(
				"Pull latest progress from the server when opening a book.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.kosyncSyncOnOpen)
					.onChange(async (v) => {
						this.plugin.settings.kosyncSyncOnOpen = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync on progress")
			.setDesc(
				"Push progress to the server as you read (uses the same interval as disk sync).",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.kosyncSyncOnProgress)
					.onChange(async (v) => {
						this.plugin.settings.kosyncSyncOnProgress = v;
						await this.plugin.saveSettings();
					}),
			);
	}
}
