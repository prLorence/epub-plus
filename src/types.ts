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
