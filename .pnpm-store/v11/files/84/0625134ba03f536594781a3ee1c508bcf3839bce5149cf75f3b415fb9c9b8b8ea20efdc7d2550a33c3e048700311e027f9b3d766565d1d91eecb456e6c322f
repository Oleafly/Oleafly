import { ResolvedLanguages } from "./constants.js";
//#region src/highlighter/languages/getResolvedLanguages.ts
function getResolvedLanguages(languages) {
	const resolvedLanguages = [];
	for (const language of languages) {
		const resolvedLanguage = ResolvedLanguages.get(language);
		if (resolvedLanguage == null) throw new Error(`getResolvedLanguages: ${language} is not resolved. Please resolve languages before calling getResolvedLanguages`);
		resolvedLanguages.push(resolvedLanguage);
	}
	return resolvedLanguages;
}
//#endregion
export { getResolvedLanguages };

//# sourceMappingURL=getResolvedLanguages.js.map