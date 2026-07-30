import { resolveLanguage } from "./resolveLanguage.js";
import { getResolvedOrResolveLanguage } from "./getResolvedOrResolveLanguage.js";
//#region src/highlighter/languages/resolveLanguages.ts
async function resolveLanguages(languages) {
	const resolvedLanguages = [];
	const languagesToResolve = [];
	for (const language of languages) {
		if (language === "text" || language === "ansi") continue;
		const maybeResolvedLanguage = getResolvedOrResolveLanguage(language) ?? resolveLanguage(language);
		if ("then" in maybeResolvedLanguage) languagesToResolve.push(maybeResolvedLanguage);
		else resolvedLanguages.push(maybeResolvedLanguage);
	}
	if (languagesToResolve.length > 0) await Promise.all(languagesToResolve).then((_resolvedLanguages) => {
		for (const resolvedLanguage of _resolvedLanguages) {
			if (resolvedLanguage == null) throw new Error("resolvedLanguages: unable to resolve language");
			resolvedLanguages.push(resolvedLanguage);
		}
	});
	return resolvedLanguages;
}
//#endregion
export { resolveLanguages };

//# sourceMappingURL=resolveLanguages.js.map