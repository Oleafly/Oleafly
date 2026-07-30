import { RegisteredCustomLanguages } from "./constants.js";
import { setCustomExtension } from "../../utils/getFiletypeFromFileName.js";
//#region src/highlighter/languages/registerCustomLanguage.ts
/**
* Register a custom language loader and optionally map it to
* file names or extensions.
*/
function registerCustomLanguage(lang, loader, extensionsOrFilenames = []) {
	if (lang === "text" || lang === "ansi") throw new Error("registerCustomLanguage: 'text' and 'ansi' are reserved language names");
	if (RegisteredCustomLanguages.has(lang)) {
		console.error(`registerCustomLanguage: lang: ${lang} is already registered`);
		return;
	}
	RegisteredCustomLanguages.set(lang, loader);
	for (const extension of extensionsOrFilenames) setCustomExtension(extension, lang);
}
//#endregion
export { registerCustomLanguage };

//# sourceMappingURL=registerCustomLanguage.js.map