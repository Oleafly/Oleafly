import { themeResolver } from "./themeResolver.js";
import { createTheme } from "@pierre/theming/themes";
import { DuplicateThemeError } from "@pierre/theming";
//#region src/highlighter/themes/registerCustomTheme.ts
function registerCustomTheme(themeName, loader) {
	try {
		const descriptor = createTheme({
			name: themeName,
			load: loader
		});
		themeResolver.registerTheme(descriptor.name, descriptor.load);
	} catch (error) {
		if (error instanceof DuplicateThemeError) {
			console.error("SharedHighlight.registerCustomTheme: theme name already registered", themeName);
			return;
		}
		throw error;
	}
}
//#endregion
export { registerCustomTheme };

//# sourceMappingURL=registerCustomTheme.js.map