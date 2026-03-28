import { App, PluginSettingTab, Setting } from "obsidian";
import type EpubPlusPlugin from "./main";

export interface EpubPlusSettings {
	readingMode: "paginated" | "scrolled";
	fontSize: number;
	fontFamily: string;
	lineHeight: number;
	theme: "auto" | "light" | "dark" | "sepia";
	defaultHighlightColor: string;
	copyTemplate: string;
	autoSaveProgress: boolean;
	showTocOnOpen: boolean;
}

export const DEFAULT_SETTINGS: EpubPlusSettings = {
	readingMode: "paginated",
	fontSize: 16,
	fontFamily: "",
	lineHeight: 1.5,
	theme: "auto",
	defaultHighlightColor: "yellow",
	copyTemplate:
		"> [!quote|{{color}}] {{chapter}}\n> {{selection}}\n> — {{link}}",
	autoSaveProgress: true,
	showTocOnOpen: false,
};

export class EpubPlusSettingTab extends PluginSettingTab {
	plugin: EpubPlusPlugin;

	constructor(app: App, plugin: EpubPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Reader").setHeading();

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
						this.plugin.settings.readingMode = v as EpubPlusSettings["readingMode"];
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
						this.plugin.settings.theme = v as EpubPlusSettings["theme"];
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

		new Setting(containerEl).setName("Links and highlights").setHeading();

		new Setting(containerEl)
			.setName("Default highlight color")
			.setDesc("Color name used when copying a link to selection.")
			.addText((t) =>
				t
					.setPlaceholder("Yellow")
					.setValue(this.plugin.settings.defaultHighlightColor)
					.onChange(async (v) => {
						this.plugin.settings.defaultHighlightColor = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Copy template")
			.setDesc(
				"Template for copied links. Variables: {{fileName}}, {{title}}, {{author}}, {{chapter}}, {{selection}}, {{link}}, {{color}}.",
			)
			.addTextArea((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.copyTemplate)
					.setValue(this.plugin.settings.copyTemplate)
					.onChange(async (v) => {
						this.plugin.settings.copyTemplate = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Progress").setHeading();

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
	}
}
