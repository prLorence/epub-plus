import type Book from "epubjs/types/book";
import type Section from "epubjs/types/section";

/**
 * Parses a KOReader XPath/XPointer string into its components.
 *
 * KOReader format examples:
 *   /body/DocFragment[8]/body/section/div[3]/p[11]/text().554
 *   /body/DocFragment[20]/body/p[22]/img.0
 *   /body/DocFragment[5]/body/div/p[3]/text().0
 */
interface KoReaderXPath {
	/** 0-based spine index (DocFragment[N] → N-1) */
	spineIndex: number;
	/** DOM path segments after the section's body, e.g. ["section", "div[3]", "p[11]"] */
	domPath: string[];
	/** Character offset in a text node, if the path ends with text().N */
	textOffset: number | null;
}

function parseKoReaderXPath(xpath: string): KoReaderXPath | null {
	// Match DocFragment[N]
	const fragMatch = /DocFragment\[(\d+)\]/.exec(xpath);
	if (!fragMatch) return null;

	const spineIndex = parseInt(fragMatch[1]!, 10) - 1;

	// Get the part after DocFragment[N]/body/
	// The xpath looks like: /body/DocFragment[N]/body/...rest...
	const afterFrag = xpath.slice(
		xpath.indexOf(fragMatch[0]!) + fragMatch[0]!.length,
	);
	// Remove leading /body/ (the section's root body element)
	const bodyMatch = /^\/body\//.exec(afterFrag);
	if (!bodyMatch) return { spineIndex, domPath: [], textOffset: null };

	let rest = afterFrag.slice(bodyMatch[0].length);

	// Check for text().N or text()[N].M at the end
	let textOffset: number | null = null;
	const textMatch = /\/text\(\)(?:\[\d+\])?\.(\d+)$/.exec(rest);
	if (textMatch) {
		textOffset = parseInt(textMatch[1]!, 10);
		rest = rest.slice(0, -textMatch[0].length);
	}

	// Check for img.N at the end (treat as element, no text offset)
	const imgMatch = /\/img\.(\d+)$/.exec(rest);
	if (imgMatch) {
		rest = rest.slice(0, -imgMatch[0].length);
	}

	// Split remaining path into segments
	const domPath = rest.split("/").filter((s) => s.length > 0);

	return { spineIndex, domPath, textOffset };
}

/**
 * Walk a DOM tree following KOReader's path segments to find the target element.
 *
 * Path segments are like "section", "div[3]", "p[11]".
 * The index [N] is 1-based and counts only siblings with the same tag name.
 */
function walkDomPath(body: Element, segments: string[]): Element | null {
	let current: Element = body;

	for (const seg of segments) {
		const match = /^(\w+)(?:\[(\d+)\])?$/.exec(seg);
		if (!match) return null;

		const tagName = match[1]!.toLowerCase();
		const nthIndex = match[2] ? parseInt(match[2], 10) : 1;

		// Count children with matching tag name
		let count = 0;
		let found: Element | null = null;
		for (let i = 0; i < current.children.length; i++) {
			const child = current.children[i]!;
			if (child.tagName.toLowerCase() === tagName) {
				count++;
				if (count === nthIndex) {
					found = child;
					break;
				}
			}
		}

		if (!found) return null;
		current = found;
	}

	return current;
}

/**
 * Find a text node at a given character offset within an element.
 * Walks all text node descendants in document order, accumulating
 * character counts until the offset is reached.
 *
 * Returns the text node and the offset within that node.
 */
function findTextNodeAtOffset(
	element: Element,
	targetOffset: number,
): { node: Text; offset: number } | null {
	const walker = element.ownerDocument.createTreeWalker(
		element,
		NodeFilter.SHOW_TEXT,
	);

	let charCount = 0;
	let lastNode: Text | null = null;
	let current: Node | null;
	while ((current = walker.nextNode())) {
		const node = current as Text;
		lastNode = node;
		const len = node.textContent?.length ?? 0;
		if (charCount + len > targetOffset) {
			return { node, offset: targetOffset - charCount };
		}
		charCount += len;
	}

	// If offset is beyond all text, return end of last text node
	if (lastNode) {
		return { node: lastNode, offset: lastNode.textContent?.length ?? 0 };
	}
	return null;
}

/**
 * Convert a KOReader XPath/XPointer string to an EPUB CFI.
 *
 * Loads the target spine section, walks the DOM to the element
 * specified by the XPath, and uses epub.js to generate the CFI.
 *
 * @returns A valid EPUB CFI string, or null if conversion fails.
 */
export async function xpathToCfi(
	xpath: string,
	book: Book,
): Promise<string | null> {
	const parsed = parseKoReaderXPath(xpath);
	if (!parsed) return null;

	try {
		const section: Section = book.spine.get(parsed.spineIndex);
		if (!section) return null;

		// Use the archive's request function to load the section.
		// section.load() needs a function that fetches the section URL
		// and returns a parsed XML document.
		const archive = book.archive;
		if (!archive) return null;

		const requestFn = archive.request.bind(archive);
		await (section.load(requestFn) as unknown as Promise<unknown>);

		const doc = section.document;
		if (!doc?.body) {
			section.unload();
			return null;
		}

		let cfi: string | null = null;

		if (parsed.domPath.length === 0) {
			// Just the body — return CFI for the section start
			cfi = section.cfiFromElement(doc.body);
		} else {
			const targetEl = walkDomPath(doc.body, parsed.domPath);
			if (!targetEl) {
				section.unload();
				return null;
			}

			if (parsed.textOffset !== null) {
				// Navigate to a specific character offset
				const textPos = findTextNodeAtOffset(
					targetEl,
					parsed.textOffset,
				);
				if (textPos) {
					const range = doc.createRange();
					range.setStart(textPos.node, textPos.offset);
					range.setEnd(textPos.node, textPos.offset);
					cfi = section.cfiFromRange(range);
				}
			}

			// Fall back to element-level CFI
			if (!cfi) {
				cfi = section.cfiFromElement(targetEl);
			}
		}

		section.unload();
		return cfi || null;
	} catch (e) {
		console.warn("[EPUB++] XPath→CFI conversion failed:", e);
		return null;
	}
}

/**
 * Build a KOReader-style XPath from a DOM node up to the section body.
 *
 * Produces paths like: section/div[3]/p[11]
 * Each segment includes a 1-based index counting same-tag siblings.
 */
function buildDomPath(node: Node, body: Element): string {
	const segments: string[] = [];
	let current: Node | null = node;

	while (current && current !== body && current.parentNode) {
		if (current.nodeType === Node.ELEMENT_NODE) {
			const el = current as Element;
			const tag = el.tagName.toLowerCase();

			// Count same-tag siblings before this element (1-based index)
			let idx = 1;
			let sibling = el.previousElementSibling;
			while (sibling) {
				if (sibling.tagName.toLowerCase() === tag) idx++;
				sibling = sibling.previousElementSibling;
			}

			// Count total same-tag siblings to decide if index is needed
			let total = idx;
			let next = el.nextElementSibling;
			while (next) {
				if (next.tagName.toLowerCase() === tag) total++;
				next = next.nextElementSibling;
			}

			segments.unshift(total > 1 ? `${tag}[${idx}]` : tag);
		}
		current = current.parentNode;
	}

	return segments.join("/");
}

/**
 * Count character offset from the start of an element to a specific
 * text node + offset within that element.
 */
function countCharOffset(element: Element, targetNode: Text, targetOffset: number): number {
	const walker = element.ownerDocument.createTreeWalker(
		element,
		NodeFilter.SHOW_TEXT,
	);

	let charCount = 0;
	let current: Node | null;
	while ((current = walker.nextNode())) {
		if (current === targetNode) {
			return charCount + targetOffset;
		}
		charCount += (current as Text).textContent?.length ?? 0;
	}
	return charCount + targetOffset;
}

/**
 * Convert an EPUB CFI to a KOReader XPath/XPointer string.
 *
 * Resolves the CFI to a DOM position using epub.js, then walks the DOM
 * to build the XPath that KOReader expects.
 *
 * @returns A KOReader XPath string, or null if conversion fails.
 */
export async function cfiToXpath(
	cfi: string,
	book: Book,
): Promise<string | null> {
	if (!cfi || !cfi.startsWith("epubcfi(")) return null;

	try {
		// Extract spine index from CFI: epubcfi(/6/N!...) → spine = N/2 - 1
		const spineMatch = /^epubcfi\(\/6\/(\d+)/.exec(cfi);
		if (!spineMatch) return null;
		const spineIndex = Math.floor(parseInt(spineMatch[1]!, 10) / 2) - 1;

		// DocFragment is 1-based
		const docFragment = spineIndex + 1;

		// Resolve CFI to a DOM range
		const range = await book.getRange(cfi);
		if (!range) {
			// Can't resolve — return a basic XPath with just the spine
			return `/body/DocFragment[${docFragment}]/body`;
		}

		const startNode = range.startContainer;
		const startOffset = range.startOffset;

		// Find the section body
		const doc = startNode.ownerDocument;
		const body = doc?.body;
		if (!body) return `/body/DocFragment[${docFragment}]/body`;

		// Find the nearest block-level ancestor — KOReader XPaths
		// point to block elements (p, div, h1-h6, li, blockquote, etc.),
		// never inline elements like <a>, <span>, <em>.
		const INLINE_TAGS = new Set([
			"a", "abbr", "b", "bdo", "br", "cite", "code", "dfn",
			"em", "i", "img", "kbd", "mark", "q", "rp", "rt",
			"ruby", "s", "samp", "small", "span", "strong", "sub",
			"sup", "time", "u", "var", "wbr",
		]);

		let blockEl: Element | null =
			startNode.nodeType === Node.TEXT_NODE
				? startNode.parentElement
				: (startNode as Element);
		while (
			blockEl &&
			blockEl !== body &&
			INLINE_TAGS.has(blockEl.tagName.toLowerCase())
		) {
			blockEl = blockEl.parentElement;
		}
		if (!blockEl || blockEl === body) {
			return `/body/DocFragment[${docFragment}]/body`;
		}

		// Build DOM path from body to the block element
		const domPath = buildDomPath(blockEl, body);
		let xpath = `/body/DocFragment[${docFragment}]/body/${domPath}`;

		// Compute character offset relative to the block element
		if (startNode.nodeType === Node.TEXT_NODE) {
			const charOffset = countCharOffset(
				blockEl,
				startNode as Text,
				startOffset,
			);
			xpath += `/text().${charOffset}`;
		}

		return xpath;
	} catch (e) {
		console.warn("[EPUB++] CFI→XPath conversion failed:", e);
		return null;
	}
}
