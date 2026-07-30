"use client";
import { useMarkdownContext } from "../../Markdown/components/MarkdownProvider.mjs";
import { rehypeCustomFootnotes } from "../../Markdown/plugins/rehypeCustomFootnotes.mjs";
import { rehypeKatexDir } from "../../Markdown/plugins/rehypeKatexDir.mjs";
import { useMemo } from "react";
import { rehypeGithubAlerts } from "rehype-github-alerts";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
//#region src/hooks/useMarkdown/useMarkdownRehypePlugins.ts
const useMarkdownRehypePlugins = () => {
	const { enableLatex, enableCustomFootnotes, enableGithubAlert, allowHtml, rehypePlugins = [], rehypePluginsAhead = [] } = useMarkdownContext();
	const memoPlugins = useMemo(() => [
		allowHtml && rehypeRaw,
		enableGithubAlert && rehypeGithubAlerts,
		enableLatex && rehypeKatex,
		enableLatex && rehypeKatexDir,
		enableCustomFootnotes && rehypeCustomFootnotes
	].filter(Boolean), [
		enableLatex,
		enableGithubAlert,
		enableCustomFootnotes,
		allowHtml
	]);
	return useMemo(() => [
		...rehypePluginsAhead,
		...memoPlugins,
		...rehypePlugins
	], [
		rehypePlugins,
		memoPlugins,
		rehypePluginsAhead
	]);
};
//#endregion
export { useMarkdownRehypePlugins };

//# sourceMappingURL=useMarkdownRehypePlugins.mjs.map