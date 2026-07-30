import { themeResolver } from "./themeResolver.js";
import { prepareThemeResolution, validateResolvedThemeName } from "./themeResolution.js";
//#region src/highlighter/themes/resolveTheme.ts
async function resolveTheme(themeName) {
	prepareThemeResolution(themeName);
	const theme = await themeResolver.resolveTheme(themeName);
	validateResolvedThemeName(themeName, theme);
	return theme;
}
//#endregion
export { resolveTheme };

//# sourceMappingURL=resolveTheme.js.map