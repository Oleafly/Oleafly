"use client";
import { isLastFormulaRenderable } from "./latex.mjs";
import { addToCache, contentCache, preprocessMarkdownContent } from "./utils.mjs";
import { useMarkdownContext } from "../../Markdown/components/MarkdownProvider.mjs";
import { useMemo, useRef, useState } from "react";
//#region src/hooks/useMarkdown/useMarkdownContent.ts
const useMarkdownContent = (children) => {
	const { animated, enableLatex = true, enableCustomFootnotes, citations } = useMarkdownContext();
	const [validContent, setValidContent] = useState("");
	const prevProcessedContent = useRef("");
	const citationsLength = citations?.length || 0;
	const cacheKey = useMemo(() => `${children}|${enableLatex ? 1 : 0}|${enableCustomFootnotes ? 1 : 0}|${citationsLength}`, [
		children,
		enableLatex,
		enableCustomFootnotes,
		citationsLength
	]);
	return useMemo(() => {
		if (contentCache.has(cacheKey)) return contentCache.get(cacheKey);
		let processedContent = preprocessMarkdownContent(children, {
			citationsLength,
			enableCustomFootnotes,
			enableLatex
		});
		if (animated && enableLatex) {
			if (!isLastFormulaRenderable(processedContent) && validContent) processedContent = validContent;
		}
		if (processedContent !== prevProcessedContent.current) {
			setValidContent(processedContent);
			prevProcessedContent.current = processedContent;
		}
		addToCache(cacheKey, processedContent);
		return processedContent;
	}, [
		cacheKey,
		children,
		enableLatex,
		enableCustomFootnotes,
		citationsLength,
		animated,
		validContent
	]);
};
//#endregion
export { useMarkdownContent };

//# sourceMappingURL=useMarkdownContent.mjs.map