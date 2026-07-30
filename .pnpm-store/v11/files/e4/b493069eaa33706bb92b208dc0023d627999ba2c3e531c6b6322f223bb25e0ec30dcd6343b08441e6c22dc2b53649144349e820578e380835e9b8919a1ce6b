import { RegisteredCustomLanguages, ResolvedLanguages, ResolvingLanguages } from "./constants.js";
import { isWorkerContext } from "../../utils/isWorkerContext.js";
import { bundledLanguages } from "shiki";
//#region src/highlighter/languages/resolveLanguage.ts
async function resolveLanguage(lang) {
	if (isWorkerContext()) throw new Error(`resolveLanguage("${lang}") cannot be called from a worker context. Languages must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.`);
	const resolver = ResolvingLanguages.get(lang);
	if (resolver != null) return resolver;
	try {
		let loader = RegisteredCustomLanguages.get(lang);
		if (loader == null && Object.prototype.hasOwnProperty.call(bundledLanguages, lang)) loader = bundledLanguages[lang];
		if (loader == null) throw new Error(`resolveLanguage: "${lang}" not found in bundled or custom languages`);
		const resolver = loader().then(({ default: data }) => {
			const resolvedLang = {
				name: lang,
				data
			};
			if (!ResolvedLanguages.has(lang)) ResolvedLanguages.set(lang, resolvedLang);
			return resolvedLang;
		});
		ResolvingLanguages.set(lang, resolver);
		return await resolver;
	} finally {
		ResolvingLanguages.delete(lang);
	}
}
//#endregion
export { resolveLanguage };

//# sourceMappingURL=resolveLanguage.js.map