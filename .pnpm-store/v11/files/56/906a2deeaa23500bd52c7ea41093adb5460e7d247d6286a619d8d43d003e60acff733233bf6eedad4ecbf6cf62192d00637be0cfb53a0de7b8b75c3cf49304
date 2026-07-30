import { getFiletypeFromFileName } from "./getFiletypeFromFileName.js";
//#region src/utils/isDiffPlainText.ts
function isDiffPlainText(diff) {
	const computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
	const computedPreviousLang = diff.lang ?? (diff.prevName != null ? getFiletypeFromFileName(diff.prevName) : "text");
	return computedLang === "text" && computedPreviousLang === "text";
}
//#endregion
export { isDiffPlainText };

//# sourceMappingURL=isDiffPlainText.js.map