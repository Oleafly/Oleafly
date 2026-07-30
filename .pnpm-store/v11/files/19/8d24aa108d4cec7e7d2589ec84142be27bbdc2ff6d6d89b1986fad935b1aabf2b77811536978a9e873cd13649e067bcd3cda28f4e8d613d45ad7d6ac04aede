import { themeResolver } from "./themeResolver.js";
import { prepareThemeResolution, validateResolvedThemeName } from "./themeResolution.js";
//#region src/highlighter/themes/resolveThemes.ts
async function resolveThemes(themes) {
	for (const themeName of themes) prepareThemeResolution(themeName);
	const resolvedThemes = await themeResolver.resolveThemes(themes);
	for (let i = 0; i < themes.length; i++) validateResolvedThemeName(themes[i], resolvedThemes[i]);
	return resolvedThemes;
}
//#endregion
export { resolveThemes };

//# sourceMappingURL=resolveThemes.js.map