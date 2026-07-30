"use client";
import lobe_theme_default from "../Highlighter/theme/lobe-theme.mjs";
import { getCodeLanguageByInput } from "../Highlighter/const.mjs";
import { useEffect, useMemo, useState } from "react";
import { transformerNotationDiff, transformerNotationErrorLevel, transformerNotationFocus, transformerNotationHighlight, transformerNotationWordHighlight } from "@shikijs/transformers";
import { Md5 } from "ts-md5";
//#region src/hooks/useHighlight.ts
const MD5_LENGTH_THRESHOLD = 1e4;
const highlightCache = /* @__PURE__ */ new Map();
const MAX_CACHE_SIZE = 1e3;
const cleanupCache = () => {
	if (highlightCache.size > MAX_CACHE_SIZE) {
		const entriesToRemove = Math.floor(MAX_CACHE_SIZE * .2);
		const keysToRemove = Array.from(highlightCache.keys()).slice(0, entriesToRemove);
		for (const key of keysToRemove) highlightCache.delete(key);
	}
};
let codeToHtmlPromise = null;
const loadCodeToHtml = () => {
	if (typeof window === "undefined") return Promise.resolve(null);
	if (!codeToHtmlPromise) codeToHtmlPromise = import("shiki").then((mod) => mod.codeToHtml ?? null);
	return codeToHtmlPromise;
};
const loadShikiModule = () => {
	if (typeof window === "undefined") return Promise.resolve(null);
	return import("shiki");
};
const shikiModulePromise = loadShikiModule();
const escapeHtml = (str) => {
	return str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#039;");
};
const customThemes = { "lobe-theme": lobe_theme_default };
const useHighlight = (text, { language, enableTransformer, theme: builtinTheme, streaming }) => {
	const safeText = text ?? "";
	const lang = (language ?? "plaintext").toLowerCase();
	const matchedLanguage = useMemo(() => getCodeLanguageByInput(lang), [lang]);
	const transformers = useMemo(() => {
		if (!enableTransformer) return;
		return [
			transformerNotationDiff(),
			transformerNotationHighlight(),
			transformerNotationWordHighlight(),
			transformerNotationFocus(),
			transformerNotationErrorLevel()
		];
	}, [enableTransformer]);
	const cacheKey = useMemo(() => {
		if (streaming) return null;
		const hash = safeText.length < 1e4 ? safeText : Md5.hashStr(safeText);
		return [
			matchedLanguage,
			builtinTheme,
			hash
		].filter(Boolean).join("-");
	}, [
		safeText,
		matchedLanguage,
		builtinTheme,
		streaming
	]);
	const [data, setData] = useState();
	useEffect(() => {
		if (!cacheKey) {
			setData(void 0);
			return;
		}
		const cachedPromise = highlightCache.get(cacheKey);
		if (cachedPromise) {
			cachedPromise.then((html) => {
				setData(html);
			}).catch(() => {});
			return;
		}
		const highlightPromise = (async () => {
			try {
				const shikiModule = await shikiModulePromise;
				if (!shikiModule) return safeText;
				const effectiveTheme = builtinTheme || "lobe-theme";
				if (!builtinTheme && effectiveTheme === "lobe-theme") {
					const customTheme = customThemes[effectiveTheme];
					if (customTheme) return await (await shikiModule.getSingletonHighlighter({
						langs: [matchedLanguage],
						themes: [customTheme]
					})).codeToHtml(safeText, {
						lang: matchedLanguage,
						theme: effectiveTheme,
						transformers
					});
				}
				const codeToHtml = await loadCodeToHtml();
				if (!codeToHtml) return safeText;
				return await codeToHtml(safeText, {
					lang: matchedLanguage,
					theme: effectiveTheme,
					transformers
				});
			} catch (error_) {
				console.error("Advanced rendering failed:", error_);
				try {
					const codeToHtml = await loadCodeToHtml();
					if (!codeToHtml) return safeText;
					return await codeToHtml(safeText, {
						lang: matchedLanguage,
						theme: "lobe-theme"
					});
				} catch {
					return `<pre class="fallback"><code>${escapeHtml(safeText)}</code></pre>`;
				}
			}
		})();
		highlightCache.set(cacheKey, highlightPromise);
		cleanupCache();
		highlightPromise.then((html) => {
			if (highlightCache.get(cacheKey) === highlightPromise) setData(html);
		}).catch(() => {
			if (highlightCache.get(cacheKey) === highlightPromise) highlightCache.delete(cacheKey);
		});
	}, [
		cacheKey,
		safeText,
		matchedLanguage,
		builtinTheme,
		transformers,
		customThemes
	]);
	return data || "";
};
//#endregion
export { MD5_LENGTH_THRESHOLD, escapeHtml, shikiModulePromise, useHighlight };

//# sourceMappingURL=useHighlight.mjs.map