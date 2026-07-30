import { isWorkerContext } from "../../utils/isWorkerContext.js";
import { themeResolver } from "./themeResolver.js";
import { shikiThemes } from "@pierre/theming/themes";
//#region src/highlighter/themes/themeResolution.ts
function prepareThemeResolution(themeName) {
	if (isWorkerContext()) throw new Error(`Theme "${themeName}" cannot be resolved from a worker context. Themes must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.`);
	if (themeResolver.hasRegisteredTheme(themeName)) return;
	const descriptor = shikiThemes.getTheme(themeName);
	if (descriptor != null) {
		themeResolver.registerThemeIfAbsent(descriptor.name, descriptor.load);
		return;
	}
	throw new Error(`No valid theme loader registered for "${themeName}"`);
}
function validateResolvedThemeName(themeName, theme) {
	if (theme.name !== themeName) throw new Error(`resolvedTheme: themeName: ${themeName} does not match theme.name: ${theme.name}`);
}
//#endregion
export { prepareThemeResolution, validateResolvedThemeName };

//# sourceMappingURL=themeResolution.js.map