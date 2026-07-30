import { bundledLanguagesInfo, bundledThemesInfo } from "shiki";
//#region src/Highlighter/const.ts
const highlighterThemes = [{
	displayName: "Lobe Theme",
	id: "lobe-theme"
}, ...bundledThemesInfo.map((item) => ({
	displayName: item.displayName,
	id: item.id
}))];
const FALLBACK_LANG = "plaintext";
const getCodeLanguageByInput = (input) => {
	if (!input) return "plaintext";
	const inputLang = input.toLocaleLowerCase();
	return bundledLanguagesInfo.find((lang) => lang.id === inputLang || lang.aliases?.includes(inputLang))?.id || "plaintext";
};
const getCodeLanguageFilename = (input) => {
	if (!input) return "Plaintext";
	const inputLang = input.toLocaleLowerCase();
	const matchLang = bundledLanguagesInfo.find((lang) => lang.id === inputLang || lang.aliases?.includes(inputLang));
	return `*.${matchLang?.aliases?.[0] || matchLang?.id || "txt"}`;
};
const getCodeLanguageDisplayName = (input) => {
	if (!input) return "Plaintext";
	const inputLang = input.toLocaleLowerCase();
	return bundledLanguagesInfo.find((lang) => lang.id === inputLang || lang.aliases?.includes(inputLang))?.name || "Plaintext";
};
//#endregion
export { FALLBACK_LANG, getCodeLanguageByInput, getCodeLanguageDisplayName, getCodeLanguageFilename, highlighterThemes };

//# sourceMappingURL=const.mjs.map