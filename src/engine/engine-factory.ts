import type { IBookEngine, ITextResolver } from "./types";
import { EpubJsEngine, EpubJsTextResolver } from "./epubjs-engine";
import { NativeEngine } from "./native-engine";

export type EngineType = "epubjs" | "native" | "zotero";

export function createEngine(type: EngineType): IBookEngine {
	switch (type) {
		case "native":
			return new NativeEngine();
		case "zotero":
			// TODO: implement Zotero reader embedding
			console.debug("[EPUB++] Zotero engine not yet implemented, using epub.js");
			return new EpubJsEngine();
		case "epubjs":
		default:
			return new EpubJsEngine();
	}
}

export function createTextResolver(type: EngineType): ITextResolver {
	switch (type) {
		case "native":
		case "epubjs":
		default:
			return new EpubJsTextResolver();
	}
}
