import { attachResolvedLanguages } from "./languages/attachResolvedLanguages.js";
import { cleanUpResolvedLanguages } from "./languages/cleanUpResolvedLanguages.js";
import { getResolvedOrResolveLanguage } from "./languages/getResolvedOrResolveLanguage.js";
import { themeResolver } from "./themes/themeResolver.js";
import { attachResolvedThemes } from "./themes/attachResolvedThemes.js";
import { cleanUpResolvedThemes } from "./themes/cleanUpResolvedThemes.js";
import { getResolvedOrResolveTheme } from "./themes/getResolvedOrResolveTheme.js";
import { createHighlighter, createJavaScriptRegexEngine, createOnigurumaEngine } from "shiki";
import { pierreThemes } from "@pierre/theming/themes";
//#region src/highlighter/shared_highlighter.ts
let highlighter;
async function getSharedHighlighter({ themes, langs, preferredHighlighter = "shiki-js" }) {
	highlighter ??= createHighlighter({
		themes: [],
		langs: ["text"],
		engine: preferredHighlighter === "shiki-wasm" ? createOnigurumaEngine(import("shiki/wasm")) : createJavaScriptRegexEngine()
	});
	const instance = isHighlighterLoading(highlighter) ? await highlighter : highlighter;
	highlighter = instance;
	const languageLoaders = [];
	for (const language of langs) {
		if (language === "text" || language === "ansi") continue;
		const maybeResolvedLanguage = getResolvedOrResolveLanguage(language);
		if ("then" in maybeResolvedLanguage) languageLoaders.push(maybeResolvedLanguage);
		else attachResolvedLanguages(maybeResolvedLanguage, instance);
	}
	const themeLoaders = [];
	for (const themeName of themes) {
		const maybeResolvedTheme = getResolvedOrResolveTheme(themeName);
		if ("then" in maybeResolvedTheme) themeLoaders.push(maybeResolvedTheme);
		else attachResolvedThemes(maybeResolvedTheme, highlighter);
	}
	if (languageLoaders.length > 0 || themeLoaders.length > 0) await Promise.all([Promise.all(languageLoaders).then((languages) => {
		attachResolvedLanguages(languages, instance);
	}), Promise.all(themeLoaders).then((themes) => {
		attachResolvedThemes(themes, instance);
	})]);
	return instance;
}
function isHighlighterLoaded(h = highlighter) {
	return h != null && !("then" in h);
}
function getHighlighterIfLoaded() {
	if (highlighter != null && !("then" in highlighter)) return highlighter;
}
function isHighlighterLoading(h = highlighter) {
	return h != null && "then" in h;
}
function isHighlighterNull(h = highlighter) {
	return h == null;
}
async function preloadHighlighter(options) {
	await getSharedHighlighter(options);
}
async function disposeHighlighter() {
	if (highlighter == null) return;
	(await highlighter).dispose();
	cleanUpResolvedLanguages();
	cleanUpResolvedThemes();
	highlighter = void 0;
}
for (const descriptor of pierreThemes.getThemes()) themeResolver.registerThemeIfAbsent(descriptor.name, descriptor.load);
//#endregion
export { disposeHighlighter, getHighlighterIfLoaded, getSharedHighlighter, isHighlighterLoaded, isHighlighterLoading, isHighlighterNull, preloadHighlighter };

//# sourceMappingURL=shared_highlighter.js.map