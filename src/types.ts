export interface EpubLinkParams {
	cfi?: string;
	end?: string;
	color?: string;
	chapter?: string;
	text?: string;
}

export interface ReadingProgress {
	cfi: string;
	percent: number;
	updated: string;
}

export type ReadingStateMap = Record<string, ReadingProgress>;

export interface PaletteColor {
	name: string;
	hex: string;
}

export interface EpubBacklink {
	sourcePath: string;
	sourceDisplay: string;
	linkOriginal: string;
	cfiRange: string;
	cfiStart: string;
	cfiEnd: string;
	color: string;
	chapter?: string;
	text?: string;
	position: { line: number; ch: number };
}
