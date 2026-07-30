import { compositeOverBg, contrastRatio, deriveMutedFg, hoverWouldEraseText, isDarkSurface, isFullyTransparent, pickReadableForeground, relativeLuminance, surfacesMatch } from "./modules/color.js";
import { normalizeThemeColors } from "./modules/normalizeThemeColors.js";
//#region src/color.ts
/**
* Everything for reading and deriving colors from a resolved Shiki/VS Code theme.
* - `normalizeThemeColors` reads the colors a theme defines, resolving the
*   fallback chains and applying the universal repairs.
* - `colorUtils` is the bag of pure color transforms for deriving new colors
*   from theme colors (a readable foreground for a surface, muted text, mixes,
*   luminance/contrast checks).
*/
const colorUtils = {
	compositeOverBg,
	contrastRatio,
	deriveMutedFg,
	hoverWouldEraseText,
	isDarkSurface,
	isFullyTransparent,
	pickReadableForeground,
	relativeLuminance,
	surfacesMatch
};
//#endregion
export { colorUtils, normalizeThemeColors };

//# sourceMappingURL=color.js.map