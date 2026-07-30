"use client";
import { useMarkdownContext } from "../../Markdown/components/MarkdownProvider.mjs";
import { remarkBr } from "../../Markdown/plugins/remarkBr.mjs";
import { remarkCustomFootnotes } from "../../Markdown/plugins/remarkCustomFootnotes.mjs";
import { remarkGfmPlus } from "../../Markdown/plugins/remarkGfmPlus.mjs";
import { remarkVideo } from "../../Markdown/plugins/remarkVideo.mjs";
import { useMemo } from "react";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
//#region src/hooks/useMarkdown/useMarkdownRemarkPlugins.ts
const useMarkdownRemarkPlugins = () => {
	const { enableLatex, enableCustomFootnotes, remarkPlugins = [], remarkPluginsAhead = [], variant, allowHtml } = useMarkdownContext();
	const isChatMode = variant === "chat";
	const memoPlugins = useMemo(() => [
		remarkCjkFriendly,
		enableLatex && remarkMath,
		[remarkGfm, { singleTilde: false }],
		!allowHtml && remarkBr,
		!allowHtml && remarkGfmPlus,
		!allowHtml && remarkVideo,
		enableCustomFootnotes && remarkCustomFootnotes,
		isChatMode && remarkBreaks
	].filter(Boolean), [
		allowHtml,
		isChatMode,
		enableLatex,
		enableCustomFootnotes
	]);
	return useMemo(() => [
		...remarkPluginsAhead,
		...memoPlugins,
		...remarkPlugins
	], [
		remarkPlugins,
		memoPlugins,
		remarkPluginsAhead
	]);
};
//#endregion
export { useMarkdownRemarkPlugins };

//# sourceMappingURL=useMarkdownRemarkPlugins.mjs.map