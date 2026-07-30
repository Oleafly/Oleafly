import { AttachedThemes } from "./constants.js";
import { getThemes } from "../../utils/getThemes.js";
//#region src/highlighter/themes/areThemesAttached.ts
function areThemesAttached(themes) {
	for (const theme of getThemes(themes)) if (!AttachedThemes.has(theme)) return false;
	return true;
}
//#endregion
export { areThemesAttached };

//# sourceMappingURL=areThemesAttached.js.map