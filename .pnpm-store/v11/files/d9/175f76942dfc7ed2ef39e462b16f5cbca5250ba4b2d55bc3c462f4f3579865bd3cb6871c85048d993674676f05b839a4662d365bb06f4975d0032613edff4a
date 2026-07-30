//#region src/modules/color.d.ts
/**
 * Canonical color/contrast primitives
 */
declare const MIN_READABLE_RATIO = 3;
declare const MIN_MUTED_RATIO = 4.5;
declare function parseHexRgba(color: string): readonly [number, number, number, number] | null;
declare function relativeLuminance(color?: string): number | null;
declare function contrastRatio(a: number, b: number): number;
declare function compositeOverBg(fgColor: string, bgColor?: string): string | undefined;
declare function isFullyTransparent(color?: string): boolean;
declare function isDarkSurface(bg?: string, fgHint?: string): boolean;
declare function surfacesMatch(a?: string, b?: string): boolean;
declare function hoverWouldEraseText(hover: string, bg: string | undefined, fg: string | undefined): boolean;
declare function pickReadableForeground(bg: string | undefined, candidates: ReadonlyArray<string | undefined>): string | undefined;
declare function deriveMutedFg(primaryFg: string, bg: string | undefined): string;
//#endregion
export { MIN_MUTED_RATIO, MIN_READABLE_RATIO, compositeOverBg, contrastRatio, deriveMutedFg, hoverWouldEraseText, isDarkSurface, isFullyTransparent, parseHexRgba, pickReadableForeground, relativeLuminance, surfacesMatch };
//# sourceMappingURL=color.d.ts.map