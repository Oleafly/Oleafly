"use client";
import { useMarkdownComponents } from "../../hooks/useMarkdown/useMarkdownComponents.mjs";
import { useMarkdownContent } from "../../hooks/useMarkdown/useMarkdownContent.mjs";
import { useMarkdownRehypePlugins } from "../../hooks/useMarkdown/useMarkdownRehypePlugins.mjs";
import { useMarkdownRemarkPlugins } from "../../hooks/useMarkdown/useMarkdownRemarkPlugins.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import Markdown from "react-markdown";
//#region src/Markdown/SyntaxMarkdown/MarkdownRender.tsx
const MarkdownRenderer = memo(({ children, ...rest }) => {
	const escapedContent = useMarkdownContent(children || "");
	const components = useMarkdownComponents();
	const rehypePluginsList = useMarkdownRehypePlugins();
	const remarkPluginsList = useMarkdownRemarkPlugins();
	return /* @__PURE__ */ jsx(Markdown, {
		...rest,
		components,
		rehypePlugins: rehypePluginsList,
		remarkPlugins: remarkPluginsList,
		children: escapedContent
	});
}, (prevProps, nextProps) => prevProps.children === nextProps.children);
//#endregion
export { MarkdownRenderer as default };

//# sourceMappingURL=MarkdownRender.mjs.map