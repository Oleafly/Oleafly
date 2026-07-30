import { DEFAULT_THEMES } from "../constants.js";
import { areObjectsEqual } from "./areObjectsEqual.js";
import { areThemesEqual } from "./areThemesEqual.js";
//#region src/utils/areOptionsEqual.ts
function areOptionsEqual(optionsA, optionsB) {
	const themeA = optionsA?.theme ?? DEFAULT_THEMES;
	const themeB = optionsB?.theme ?? DEFAULT_THEMES;
	const diffOptsA = getParseDiffOptions(optionsA);
	const diffOptsB = getParseDiffOptions(optionsB);
	return areThemesEqual(themeA, themeB) && areObjectsEqual(optionsA, optionsB, ["theme", "parseDiffOptions"]) && areObjectsEqual(diffOptsA, diffOptsB);
}
function getParseDiffOptions(options) {
	if (options != null && "parseDiffOptions" in options) return options.parseDiffOptions;
}
//#endregion
export { areOptionsEqual };

//# sourceMappingURL=areOptionsEqual.js.map