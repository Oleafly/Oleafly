import { unwrapDefault } from "./unwrapDefault.js";
import { normalizeTheme } from "shiki/core";
//#region src/modules/createTheme.ts
function createTheme({ name, load, colorScheme, collection, displayName }) {
	return {
		name,
		colorScheme,
		collection,
		displayName,
		load: normalizingLoader(load)
	};
}
function normalizingLoader(loader) {
	return async () => {
		return normalizeTheme(unwrapDefault(await loader()));
	};
}
//#endregion
export { createTheme };

//# sourceMappingURL=createTheme.js.map