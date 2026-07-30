//#region src/modules/color.ts
/**
* Canonical color/contrast primitives
*/
const MIN_READABLE_RATIO = 3;
const MIN_MUTED_RATIO = 4.5;
const HEX_TRANSPARENT_RE = /^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i;
const ALPHA_ZERO_RE = /^0(?:\.0+)?%?$/;
function getFunctionalAlpha(color) {
	const openParen = color.indexOf("(");
	if (openParen <= 0 || !color.endsWith(")")) return;
	const fn = color.slice(0, openParen).trim();
	if (!/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)$/i.test(fn)) return;
	const inner = color.slice(openParen + 1, -1).trim();
	if (inner.length === 0) return;
	const slashIndex = inner.lastIndexOf("/");
	if (slashIndex !== -1) return inner.slice(slashIndex + 1).trim();
	if (/^(?:rgba|hsla)$/i.test(fn)) {
		const parts = inner.split(",");
		if (parts.length === 4) return parts[3]?.trim();
	}
}
function parseHexRgba(color) {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i.exec(color.trim());
	if (match == null) return null;
	const hex = match[1];
	let expanded;
	let alpha = 1;
	if (hex.length === 3) expanded = hex.split("").map((c) => c + c).join("");
	else if (hex.length === 6) expanded = hex;
	else {
		expanded = hex.slice(0, 6);
		alpha = parseInt(hex.slice(6, 8), 16) / 255;
	}
	return [
		parseInt(expanded.slice(0, 2), 16),
		parseInt(expanded.slice(2, 4), 16),
		parseInt(expanded.slice(4, 6), 16),
		alpha
	];
}
function relativeLuminance(color) {
	if (color == null) return null;
	const rgba = parseHexRgba(color);
	if (rgba == null) return null;
	const r = rgba[0] / 255;
	const g = rgba[1] / 255;
	const b = rgba[2] / 255;
	const channel = (v) => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
	return .2126 * channel(r) + .7152 * channel(g) + .0722 * channel(b);
}
function contrastRatio(a, b) {
	const [hi, lo] = a > b ? [a, b] : [b, a];
	return (hi + .05) / (lo + .05);
}
function compositeOverBg(fgColor, bgColor) {
	if (bgColor == null) return void 0;
	const fgParts = parseHexRgba(fgColor);
	const bgParts = parseHexRgba(bgColor);
	if (fgParts == null || bgParts == null) return void 0;
	const [fr, fg, fb, fa] = fgParts;
	const [br, bg, bb] = bgParts;
	return "#" + [
		Math.round(fr * fa + br * (1 - fa)),
		Math.round(fg * fa + bg * (1 - fa)),
		Math.round(fb * fa + bb * (1 - fa))
	].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function isFullyTransparent(color) {
	if (color == null) return false;
	const normalized = color.trim().toLowerCase();
	if (normalized === "transparent") return true;
	if (HEX_TRANSPARENT_RE.test(normalized)) return true;
	const alpha = getFunctionalAlpha(normalized);
	return alpha != null && ALPHA_ZERO_RE.test(alpha);
}
function isDarkSurface(bg, fgHint) {
	const fromBg = relativeLuminance(bg);
	if (fromBg != null) return fromBg < .4;
	const fromFg = relativeLuminance(fgHint);
	return fromFg != null ? fromFg > .6 : false;
}
function surfacesMatch(a, b) {
	if (a == null || b == null) return false;
	if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	if (la == null || lb == null) return false;
	return Math.abs(la - lb) < .06;
}
function hoverWouldEraseText(hover, bg, fg) {
	if (bg == null || fg == null) return false;
	const hoverL = relativeLuminance(hover);
	const bgL = relativeLuminance(bg);
	const fgL = relativeLuminance(fg);
	if (hoverL == null || bgL == null || fgL == null) return false;
	return Math.abs(hoverL - fgL) < Math.abs(hoverL - bgL);
}
function pickReadableForeground(bg, candidates) {
	const bgL = relativeLuminance(bg);
	const firstDefined = candidates.find((candidate) => candidate != null && candidate !== "");
	if (bgL == null) return firstDefined;
	let best;
	let bestRatio = -1;
	for (const candidate of candidates) {
		if (candidate == null || candidate === "") continue;
		const candidateL = relativeLuminance(candidate);
		if (candidateL == null) continue;
		const ratio = contrastRatio(bgL, candidateL);
		if (ratio >= 3) return candidate;
		if (ratio > bestRatio) {
			best = candidate;
			bestRatio = ratio;
		}
	}
	return best ?? firstDefined;
}
function deriveMutedFg(primaryFg, bg) {
	if (bg == null) return primaryFg;
	const fgParts = parseHexRgba(primaryFg);
	const bgParts = parseHexRgba(bg);
	const bgL = relativeLuminance(bg);
	if (fgParts == null || bgParts == null || bgL == null) return `color-mix(in srgb, ${primaryFg} 70%, ${bg})`;
	const [fr, fg2, fb] = fgParts;
	const [br, bg3, bb] = bgParts;
	for (const weight of [
		.6,
		.7,
		.8,
		.9
	]) {
		const hex = "#" + [
			Math.round(fr * weight + br * (1 - weight)),
			Math.round(fg2 * weight + bg3 * (1 - weight)),
			Math.round(fb * weight + bb * (1 - weight))
		].map((v) => v.toString(16).padStart(2, "0")).join("");
		const L = relativeLuminance(hex);
		if (L != null && contrastRatio(bgL, L) >= 4.5) return hex;
	}
	return primaryFg;
}
//#endregion
export { MIN_MUTED_RATIO, MIN_READABLE_RATIO, compositeOverBg, contrastRatio, deriveMutedFg, hoverWouldEraseText, isDarkSurface, isFullyTransparent, parseHexRgba, pickReadableForeground, relativeLuminance, surfacesMatch };

//# sourceMappingURL=color.js.map