/**
 * Shared interfaces for the EPUB rendering engine abstraction.
 *
 * All consumer code should depend only on these interfaces,
 * never on engine-specific imports (epubjs, readium, etc.).
 */

// ── Book Engine ──

export interface IBookEngine {
	open(data: ArrayBuffer): Promise<void>;
	renderTo(el: HTMLElement, options: RenderOptions): IRendition;
	getToc(): Promise<TocItem[]>;
	getMetadata(): Promise<BookMetadata>;
	getRange(cfiRange: string): Promise<Range | null>;
	destroy(): void;
}

export interface RenderOptions {
	width: number;
	height: number;
	spread: "none" | "auto";
	flow: "paginated" | "scrolled";
}

export interface TocItem {
	id: string;
	href: string;
	label: string;
	children: TocItem[];
}

export interface BookMetadata {
	title: string;
	author: string;
	language?: string;
}

// ── Rendition ──

export interface IRendition {
	display(target?: string): Promise<void>;
	next(): Promise<void>;
	prev(): Promise<void>;
	resize(width: number, height: number): void;
	destroy(): void;

	// Themes & styling
	setTheme(theme: Record<string, Record<string, string>>): void;
	injectStylesheet(css: string, key: string): void;

	// Annotations
	addHighlight(
		cfiRange: string,
		data: unknown,
		color: string,
		opacity: number,
		onClick?: (e: MouseEvent) => void,
	): void;
	removeHighlight(cfiRange: string): void;
	clearHighlights(): void;

	// State
	getCurrentLocation(): ReaderLocation | null;
	getContents(): ContentAccessor[];
	/** Get the href of the last spine item (for "go to end" navigation). */
	getSpineEndHref(): string | null;

	// Locations
	generateLocations(chars: number): Promise<void>;
	areLocationsReady(): boolean;
	percentageFromCfi(cfi: string): number | null;
	cfiFromPercentage(pct: number): string | null;

	// Events — overloads for type safety, generic fallback for extensibility
	on(event: "relocated", cb: (location: ReaderLocation) => void): void;
	on(event: "selected", cb: (cfiRange: string, selection: SelectionInfo) => void): void;
	on(event: "rendered", cb: () => void): void;
	on(event: "keydown", cb: (e: KeyboardEvent) => void): void;
	on(event: "click", cb: () => void): void;
	off(event: string, cb: unknown): void;
}

export interface ReaderLocation {
	cfi: string;
	href: string;
	percentage: number;
	displayed?: { page: number; total: number };
}

export interface SelectionInfo {
	text: string;
	window: Window;
	document: Document;
	clearSelection(): void;
}

export interface ContentAccessor {
	document: Document;
	window: Window;
}

// ── Text Resolver (for embed extraction) ──

export interface ITextResolver {
	resolve(data: ArrayBuffer, cfiRange: string): Promise<string | null>;
}
