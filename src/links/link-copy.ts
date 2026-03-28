import { App, MarkdownView } from "obsidian";
import type { TFile } from "obsidian";
import type { EpubLinkParams } from "../types";
import { buildEpubSubpath, parseCfiRange } from "./epub-link-parser";

export interface LinkCopyContext {
	file: TFile;
	cfiRange: string;
	selectedText: string;
	chapterTitle: string;
	color: string;
	template: string;
	bookTitle?: string;
	bookAuthor?: string;
}

export async function copyLinkToSelection(ctx: LinkCopyContext): Promise<string> {
	const formatted = buildFormattedLink(ctx);
	await navigator.clipboard.writeText(formatted);
	return formatted;
}

export function appendLinkToActiveNote(
	app: App,
	ctx: LinkCopyContext,
	mode: "append" | "cursor",
): boolean {
	const formatted = buildFormattedLink(ctx);
	const mdView = app.workspace.getActiveViewOfType(MarkdownView);
	if (!mdView) return false;

	const editor = mdView.editor;
	if (mode === "cursor") {
		editor.replaceSelection(formatted + "\n");
	} else {
		const lastLine = editor.lastLine();
		const lastLineText = editor.getLine(lastLine);
		const insertPos = { line: lastLine, ch: lastLineText.length };
		editor.replaceRange("\n" + formatted, insertPos);
	}
	return true;
}

function buildFormattedLink(ctx: LinkCopyContext): string {
	const { start, end } = parseCfiRange(ctx.cfiRange);

	const params: EpubLinkParams = {
		cfi: start,
		end: end,
		color: ctx.color,
		text: ctx.selectedText.slice(0, 100),
		chapter: ctx.chapterTitle || undefined,
	};

	const subpath = buildEpubSubpath(params);
	const title = ctx.bookTitle ?? ctx.file.basename;

	// Display alias uses the selected text (truncated) for a clean look
	const displayText = ctx.selectedText.length > 60
		? ctx.selectedText.slice(0, 60) + "..."
		: ctx.selectedText;

	// Link with short display alias
	const link = `[[${ctx.file.path}${subpath}|${displayText}]]`;
	// Raw link without alias
	const rawLink = `[[${ctx.file.path}${subpath}]]`;
	// Full selection text as a clickable link
	const linkedSelection = `[[${ctx.file.path}${subpath}|${ctx.selectedText}]]`;

	return applyTemplate(ctx.template, {
		fileName: ctx.file.basename,
		title,
		author: ctx.bookAuthor ?? "",
		chapter: ctx.chapterTitle,
		selection: ctx.selectedText,
		linkedSelection,
		link,
		rawLink,
		color: ctx.color,
	});
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
