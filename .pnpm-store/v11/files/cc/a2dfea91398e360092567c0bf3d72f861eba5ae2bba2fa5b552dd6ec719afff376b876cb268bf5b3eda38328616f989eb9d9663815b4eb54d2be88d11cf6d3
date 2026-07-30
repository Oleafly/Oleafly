import { createThemeCollection } from "../modules/createThemeCollection.js";
import { createTheme } from "../modules/createTheme.js";
//#region src/collections/pierre.ts
const PIERRE_COLLECTION = "pierre";
const DARK_PIERRE_THEMES = [
	"pierre-dark",
	"pierre-dark-soft",
	"pierre-dark-vibrant",
	"pierre-dark-protanopia-deuteranopia",
	"pierre-dark-tritanopia"
];
const LIGHT_PIERRE_THEMES = [
	"pierre-light",
	"pierre-light-soft",
	"pierre-light-vibrant",
	"pierre-light-protanopia-deuteranopia",
	"pierre-light-tritanopia"
];
const PIERRE_THEMES = [...LIGHT_PIERRE_THEMES, ...DARK_PIERRE_THEMES];
const LIGHT_PIERRE_THEME_NAMES = new Set(LIGHT_PIERRE_THEMES);
function pierreColorScheme(name) {
	if (LIGHT_PIERRE_THEME_NAMES.has(name)) return "light";
	return "dark";
}
const PIERRE_THEME_DISPLAY_NAMES = {
	"pierre-dark": "Pierre Dark",
	"pierre-dark-soft": "Pierre Dark Soft",
	"pierre-dark-vibrant": "Pierre Dark Vibrant",
	"pierre-dark-protanopia-deuteranopia": "Pierre Dark Protanopia & Deuteranopia",
	"pierre-dark-tritanopia": "Pierre Dark Tritanopia",
	"pierre-light": "Pierre Light",
	"pierre-light-soft": "Pierre Light Soft",
	"pierre-light-vibrant": "Pierre Light Vibrant",
	"pierre-light-protanopia-deuteranopia": "Pierre Light Protanopia & Deuteranopia",
	"pierre-light-tritanopia": "Pierre Light Tritanopia"
};
const PIERRE_THEME_IMPORTS = {
	"pierre-dark": () => import("@pierre/theme/pierre-dark"),
	"pierre-dark-soft": () => import("@pierre/theme/pierre-dark-soft"),
	"pierre-dark-vibrant": () => import("@pierre/theme/pierre-dark-vibrant"),
	"pierre-dark-protanopia-deuteranopia": () => import("@pierre/theme/pierre-dark-protanopia-deuteranopia"),
	"pierre-dark-tritanopia": () => import("@pierre/theme/pierre-dark-tritanopia"),
	"pierre-light": () => import("@pierre/theme/pierre-light"),
	"pierre-light-soft": () => import("@pierre/theme/pierre-light-soft"),
	"pierre-light-vibrant": () => import("@pierre/theme/pierre-light-vibrant"),
	"pierre-light-protanopia-deuteranopia": () => import("@pierre/theme/pierre-light-protanopia-deuteranopia"),
	"pierre-light-tritanopia": () => import("@pierre/theme/pierre-light-tritanopia")
};
function createPierreTheme(name) {
	return createTheme({
		name,
		collection: PIERRE_COLLECTION,
		colorScheme: pierreColorScheme(name),
		displayName: PIERRE_THEME_DISPLAY_NAMES[name],
		load: PIERRE_THEME_IMPORTS[name]
	});
}
const pierreThemes = createThemeCollection({ themes: PIERRE_THEMES.map((name) => createPierreTheme(name)) });
//#endregion
export { pierreThemes };

//# sourceMappingURL=pierre.js.map