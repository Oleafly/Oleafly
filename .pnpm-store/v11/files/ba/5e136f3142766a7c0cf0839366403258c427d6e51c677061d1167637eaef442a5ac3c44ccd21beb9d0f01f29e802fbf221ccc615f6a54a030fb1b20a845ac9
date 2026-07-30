import { AttachedLanguages, ResolvedLanguages } from "./constants.js";
//#region src/highlighter/languages/attachResolvedLanguages.ts
function attachResolvedLanguages(resolvedLanguages, highlighter) {
	resolvedLanguages = Array.isArray(resolvedLanguages) ? resolvedLanguages : [resolvedLanguages];
	for (const resolvedLang of resolvedLanguages) {
		if (AttachedLanguages.has(resolvedLang.name)) continue;
		let lang = ResolvedLanguages.get(resolvedLang.name);
		if (lang == null) {
			lang = resolvedLang;
			ResolvedLanguages.set(resolvedLang.name, lang);
		}
		AttachedLanguages.add(lang.name);
		highlighter.loadLanguageSync(lang.data);
	}
}
//#endregion
export { attachResolvedLanguages };

//# sourceMappingURL=attachResolvedLanguages.js.map