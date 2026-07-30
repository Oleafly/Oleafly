import { preprocessLaTeX } from "./latex.mjs";
//#region src/hooks/useMarkdown/utils.ts
const CACHE_SIZE = 50;
/**
* Cache for storing processed content to avoid redundant processing
*/
const contentCache = /* @__PURE__ */ new Map();
/**
* Adds content to the cache with size limitation
* Removes oldest entry if cache size limit is reached
*
* @param key The cache key
* @param value The processed content to store
*/
const addToCache = (key, value) => {
	if (contentCache.size >= CACHE_SIZE) {
		const firstKey = contentCache.keys().next().value;
		if (firstKey) contentCache.delete(firstKey);
	}
	contentCache.set(key, value);
};
/**
* Transforms citation references in the format [n] to markdown links
*
* @param rawContent The markdown content with citation references
* @param length The number of citations
* @returns The content with citations transformed to markdown links
*/
const transformCitations = (rawContent, length = 0) => {
	if (length === 0) return rawContent;
	const citationIndices = Array.from({ length }).fill("").map((_, index) => index + 1);
	const pattern = new RegExp(`\\[(${citationIndices.join("|")})\\]`, "g");
	const matches = [];
	let match;
	while ((match = pattern.exec(rawContent)) !== null) matches.push({
		id: match[1],
		index: match.index,
		length: match[0].length
	});
	const excludedRanges = [];
	const latexBlockRegex = /\$\$([\s\S]*?)\$\$/g;
	while ((match = latexBlockRegex.exec(rawContent)) !== null) excludedRanges.push({
		end: match.index + match[0].length - 1,
		start: match.index
	});
	const inlineLatexRegex = /\$([^$]*)\$/g;
	while ((match = inlineLatexRegex.exec(rawContent)) !== null) excludedRanges.push({
		end: match.index + match[0].length - 1,
		start: match.index
	});
	const codeBlockRegex = /```([\s\S]*?)```/g;
	while ((match = codeBlockRegex.exec(rawContent)) !== null) excludedRanges.push({
		end: match.index + match[0].length - 1,
		start: match.index
	});
	const inlineCodeRegex = /`([^`]*)`/g;
	while ((match = inlineCodeRegex.exec(rawContent)) !== null) excludedRanges.push({
		end: match.index + match[0].length - 1,
		start: match.index
	});
	const validMatches = matches.filter((citation) => {
		return !excludedRanges.some((range) => citation.index >= range.start && citation.index <= range.end);
	});
	let result = rawContent;
	for (let i = validMatches.length - 1; i >= 0; i--) {
		const citation = validMatches[i];
		const before = result.slice(0, Math.max(0, citation.index));
		const after = result.slice(Math.max(0, citation.index + citation.length));
		result = before + `[#citation-${citation.id}](citation-${citation.id})` + after;
	}
	return result.replaceAll("][", "] [");
};
const preprocessMarkdownContent = (str, { enableCustomFootnotes, enableLatex, citationsLength } = {}) => {
	let content = str;
	if (enableLatex) content = preprocessLaTeX(content);
	if (enableCustomFootnotes) content = transformCitations(content, citationsLength);
	return content;
};
//#endregion
export { addToCache, contentCache, preprocessMarkdownContent, transformCitations };

//# sourceMappingURL=utils.mjs.map