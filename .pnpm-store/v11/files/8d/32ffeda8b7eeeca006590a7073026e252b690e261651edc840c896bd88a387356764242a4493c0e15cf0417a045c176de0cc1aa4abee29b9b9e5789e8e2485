"use client";
import lobe_theme_default from "../Highlighter/theme/lobe-theme.mjs";
import { getCodeLanguageByInput } from "../Highlighter/const.mjs";
import { shikiModulePromise } from "./useHighlight.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShikiStreamTokenizer } from "@shikijs/stream";
//#region src/hooks/useStreamHighlight.ts
const tokensToLineTokens = (tokens) => {
	if (!tokens.length) return [[]];
	const lines = [];
	let currentLine = [];
	for (const token of tokens) {
		const content = token.content ?? "";
		if (content === "\n") {
			lines.push(currentLine);
			currentLine = [];
			continue;
		}
		if (content.indexOf("\n") === -1) currentLine.push(token);
		else {
			const segments = content.split("\n");
			for (const [j, segment] of segments.entries()) {
				if (segment) currentLine.push(j === 0 && segment === content ? token : {
					...token,
					content: segment
				});
				if (j < segments.length - 1) {
					lines.push(currentLine);
					currentLine = [];
				}
			}
		}
	}
	if (currentLine.length > 0 || lines.length === 0) lines.push(currentLine);
	return lines.length > 0 ? lines : [[]];
};
const createPreStyle = (bg, fg) => {
	if (!bg && !fg) return void 0;
	return {
		backgroundColor: bg,
		color: fg
	};
};
const useStreamingHighlighter = (text, options) => {
	const { customThemes, enabled, language, theme } = options;
	const [result, setResult] = useState();
	const tokenizerRef = useRef(null);
	const previousTextRef = useRef("");
	const safeText = text ?? "";
	const latestTextRef = useRef(safeText);
	const preStyleRef = useRef(void 0);
	const linesRef = useRef([[]]);
	useEffect(() => {
		latestTextRef.current = safeText;
	}, [safeText]);
	const setStreamingResultRef = useRef((rawLines) => {
		const previousLines = linesRef.current;
		const newLinesLength = rawLines.length;
		if (newLinesLength !== previousLines.length || newLinesLength === 0) {
			linesRef.current = rawLines;
			setResult({
				lines: rawLines,
				preStyle: preStyleRef.current
			});
			return;
		}
		let hasChanges = false;
		const mergedLines = [];
		for (let i = 0; i < newLinesLength; i++) {
			const newLine = rawLines[i];
			const prevLine = previousLines[i];
			if (prevLine === newLine) {
				mergedLines[i] = prevLine;
				continue;
			}
			if (!prevLine || prevLine.length !== newLine.length) {
				mergedLines[i] = newLine;
				hasChanges = true;
				continue;
			}
			let lineChanged = false;
			for (const [j, newToken] of newLine.entries()) if (prevLine[j] !== newToken) {
				lineChanged = true;
				break;
			}
			if (lineChanged) {
				mergedLines[i] = newLine;
				hasChanges = true;
			} else mergedLines[i] = prevLine;
		}
		if (hasChanges) {
			linesRef.current = mergedLines;
			setResult({
				lines: mergedLines,
				preStyle: preStyleRef.current
			});
		}
	});
	const updateTokens = useCallback(async (nextText, forceReset = false) => {
		const tokenizer = tokenizerRef.current;
		if (!tokenizer) return;
		if (forceReset) {
			tokenizer.clear();
			previousTextRef.current = "";
		}
		const previousText = previousTextRef.current;
		let chunk = nextText;
		if (!forceReset && nextText.startsWith(previousText)) chunk = nextText.slice(previousText.length);
		else if (!forceReset) tokenizer.clear();
		previousTextRef.current = nextText;
		if (!chunk) {
			const stableTokens = tokenizer.tokensStable;
			const unstableTokens = tokenizer.tokensUnstable;
			if (stableTokens.length + unstableTokens.length === 0) {
				setStreamingResultRef.current([[]]);
				return;
			}
			const mergedTokens = stableTokens.length === 0 ? unstableTokens : unstableTokens.length === 0 ? stableTokens : [...stableTokens, ...unstableTokens];
			setStreamingResultRef.current(tokensToLineTokens(mergedTokens));
			return;
		}
		try {
			await tokenizer.enqueue(chunk);
			const stableTokens = tokenizer.tokensStable;
			const unstableTokens = tokenizer.tokensUnstable;
			const mergedTokens = stableTokens.length === 0 ? unstableTokens : unstableTokens.length === 0 ? stableTokens : [...stableTokens, ...unstableTokens];
			setStreamingResultRef.current(tokensToLineTokens(mergedTokens));
		} catch (error) {
			console.error("Streaming highlighting failed:", error);
		}
	}, []);
	const highlighterKeyRef = useRef("");
	useEffect(() => {
		if (!enabled) {
			tokenizerRef.current?.clear();
			tokenizerRef.current = null;
			previousTextRef.current = "";
			preStyleRef.current = void 0;
			linesRef.current = [[]];
			setResult(void 0);
			highlighterKeyRef.current = "";
			return;
		}
		const currentKey = `${language}-${theme}`;
		if (highlighterKeyRef.current === currentKey && tokenizerRef.current) return;
		let cancelled = false;
		(async () => {
			const mod = await shikiModulePromise;
			if (!mod || cancelled) return;
			try {
				let themesToLoad = [theme];
				if (customThemes && theme === "lobe-theme") {
					const customTheme = customThemes[theme];
					if (customTheme) themesToLoad = [customTheme];
				}
				const highlighter = await mod.getSingletonHighlighter({
					langs: language ? [language] : ["plaintext"],
					themes: themesToLoad
				});
				if (!highlighter || cancelled) return;
				if (highlighterKeyRef.current !== currentKey) {
					tokenizerRef.current?.clear();
					const tokenizer = new ShikiStreamTokenizer({
						highlighter,
						lang: language,
						theme
					});
					tokenizerRef.current = tokenizer;
					highlighterKeyRef.current = currentKey;
					previousTextRef.current = "";
					linesRef.current = [[]];
					const themeInfo = highlighter.getTheme(theme);
					preStyleRef.current = createPreStyle(themeInfo?.bg, themeInfo?.fg);
				}
				const currentText = latestTextRef.current;
				if (currentText) await updateTokens(currentText, true);
				else setStreamingResultRef.current([[]]);
			} catch (error) {
				console.error("Streaming highlighter initialization failed:", error);
				highlighterKeyRef.current = "";
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [
		enabled,
		language,
		theme,
		updateTokens,
		customThemes
	]);
	useEffect(() => {
		if (!enabled) return;
		if (!tokenizerRef.current) return;
		const currentText = latestTextRef.current;
		updateTokens(currentText);
	}, [
		enabled,
		safeText,
		updateTokens
	]);
	return result;
};
const useStreamHighlight = (text, { language, theme: builtinTheme, streaming }) => {
	const safeText = text ?? "";
	const lang = (language ?? "plaintext").toLowerCase();
	const matchedLanguage = useMemo(() => getCodeLanguageByInput(lang), [lang]);
	return useStreamingHighlighter(safeText, {
		customThemes: { "lobe-theme": lobe_theme_default },
		enabled: streaming,
		language: matchedLanguage,
		theme: builtinTheme || "lobe-theme"
	});
};
//#endregion
export { useStreamHighlight };

//# sourceMappingURL=useStreamHighlight.mjs.map