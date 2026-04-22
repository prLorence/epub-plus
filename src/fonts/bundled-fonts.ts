// @ts-expect-error esbuild base64 loader
import literataRegular from "./Literata-Regular.woff2";
// @ts-expect-error esbuild base64 loader
import literataBold from "./Literata-Bold.woff2";
// @ts-expect-error esbuild base64 loader
import loraRegular from "./Lora-Regular.woff2";
// @ts-expect-error esbuild base64 loader
import loraBold from "./Lora-Bold.woff2";
// @ts-expect-error esbuild base64 loader
import fastSansRegular from "./FastSans-Regular.woff2";
// @ts-expect-error esbuild base64 loader
import fastSansBold from "./FastSans-Bold.woff2";
// @ts-expect-error esbuild base64 loader
import fastSerifRegular from "./FastSerif-Regular.woff2";
// @ts-expect-error esbuild base64 loader
import fastSerifBold from "./FastSerif-Bold.woff2";

export interface BundledFont {
	name: string;
	label: string;
	css: string;
	family: string;
}

function fontFace(
	family: string,
	base64: string,
	weight: number,
): string {
	return `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('data:font/woff2;base64,${base64 as string}') format('woff2');
}`;
}

export const BUNDLED_FONTS: BundledFont[] = [
	{
		name: "literata",
		label: "Literata",
		family: "'Literata', Georgia, serif",
		css: [
			fontFace("Literata", literataRegular, 400),
			fontFace("Literata", literataBold, 700),
		].join("\n"),
	},
	{
		name: "lora",
		label: "Lora",
		family: "'Lora', Georgia, serif",
		css: [
			fontFace("Lora", loraRegular, 400),
			fontFace("Lora", loraBold, 700),
		].join("\n"),
	},
	{
		name: "fast-sans",
		label: "Fast Sans",
		family: "'Fast Sans', sans-serif",
		css: [
			fontFace("Fast Sans", fastSansRegular, 400),
			fontFace("Fast Sans", fastSansBold, 700),
		].join("\n"),
	},
	{
		name: "fast-serif",
		label: "Fast Serif",
		family: "'Fast Serif', serif",
		css: [
			fontFace("Fast Serif", fastSerifRegular, 400),
			fontFace("Fast Serif", fastSerifBold, 700),
		].join("\n"),
	},
];

export function getBundledFontCss(fontName: string): {
	fontFaceCss: string;
	fontFamily: string;
} | null {
	const font = BUNDLED_FONTS.find((f) => f.name === fontName);
	if (!font) return null;
	return { fontFaceCss: font.css, fontFamily: font.family };
}
