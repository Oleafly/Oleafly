import { createThemeCollection } from "./createThemeCollection.js";
//#region src/modules/createThemeCatalog.ts
function createThemeCatalog(options) {
	const collection = createThemeCollection({ themes: options.themes });
	if (!collection.hasTheme(options.defaultLightThemeName)) throw new Error(`Default light theme "${options.defaultLightThemeName}" is not in the catalog`);
	if (!collection.hasTheme(options.defaultDarkThemeName)) throw new Error(`Default dark theme "${options.defaultDarkThemeName}" is not in the catalog`);
	return {
		...collection,
		defaultLightThemeName: options.defaultLightThemeName,
		defaultDarkThemeName: options.defaultDarkThemeName
	};
}
//#endregion
export { createThemeCatalog };

//# sourceMappingURL=createThemeCatalog.js.map