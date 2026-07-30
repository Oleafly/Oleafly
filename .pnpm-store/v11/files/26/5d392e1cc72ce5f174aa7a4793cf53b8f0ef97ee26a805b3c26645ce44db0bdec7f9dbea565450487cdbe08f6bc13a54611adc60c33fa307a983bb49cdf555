import { AttachedLanguages } from "./constants.js";
//#region src/highlighter/languages/areLanguagesAttached.ts
function areLanguagesAttached(languages) {
	for (const language of Array.isArray(languages) ? languages : [languages]) {
		if (language === "text" || language === "ansi") continue;
		if (!AttachedLanguages.has(language)) return false;
	}
	return true;
}
//#endregion
export { areLanguagesAttached };

//# sourceMappingURL=areLanguagesAttached.js.map