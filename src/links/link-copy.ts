import type { TFile } from "obsidian";
import type { EpubLinkParams } from "../types";
import { buildEpubSubpath, parseCfiRange } from "./epub-link-parser";

export async function copyLinkToSelection(
	file: TFile,
	cfiRange: string,
	selectedText: string,
	chapterTitle: string,
	color: string,
	template: string,
): Promise<void> {
	const { start, end } = parseCfiRange(cfiRange);

	const params: EpubLinkParams = {
		cfi: start,
		end: end,
		color,
		text: selectedText.slice(0, 100),
		chapter: chapterTitle || undefined,
	};

	const subpath = buildEpubSubpath(params);
	const link = `[[${file.path}${subpath}]]`;

	const formatted = applyTemplate(template, {
		fileName: file.basename,
		title: file.basename,
		author: "",
		chapter: chapterTitle,
		selection: selectedText,
		link,
		color,
	});

	await navigator.clipboard.writeText(formatted);
}

function applyTemplate(
	template: string,
	vars: Record<string, string>,
): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replace(
			new RegExp(`\\{\\{${key}\\}\\}`, "g"),
			value,
		);
	}
	return result;
}
