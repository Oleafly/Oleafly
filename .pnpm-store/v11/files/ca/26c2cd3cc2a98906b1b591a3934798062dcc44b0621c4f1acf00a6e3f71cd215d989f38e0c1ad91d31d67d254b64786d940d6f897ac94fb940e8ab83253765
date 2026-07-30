import "../../Highlighter/const.mjs";
import { isFullHtmlDocument } from "../../HtmlPreview/const.mjs";
import { Pre, PreHtmlPreview, PreMermaid, PreSingleLine } from "../../mdx/mdxComponents/Pre.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Markdown/components/CodeBlock.tsx
const countLines = (str) => {
	const matches = str.match(/\n/g);
	return matches ? matches.length : 1;
};
const useCode = (raw) => {
	if (!raw) return;
	const { children = "", className } = raw?.props || { children: "" };
	if (!children) return;
	const content = Array.isArray(children) ? children[0] : children;
	const lang = className?.replace("language-", "") || "plaintext";
	return {
		content,
		isSingleLine: countLines(content) <= 1 && content.length <= 32,
		lang
	};
};
const CodeBlock = memo(({ fullFeatured, enableHtmlPreview, enableMermaid, highlight, html, mermaid, children, animated, ...rest }) => {
	const code = useCode(children);
	if (!code) return;
	if (enableMermaid && code.lang === "mermaid") return /* @__PURE__ */ jsx(PreMermaid, {
		animated,
		fullFeatured,
		...mermaid,
		...rest,
		children: code.content
	});
	if (enableHtmlPreview && code.lang === "html" && isFullHtmlDocument(code.content)) return /* @__PURE__ */ jsx(PreHtmlPreview, {
		animated,
		fullFeatured,
		...html,
		...rest,
		children: code.content
	});
	if (!highlight && code.isSingleLine) return /* @__PURE__ */ jsx(PreSingleLine, {
		language: code.lang,
		children: code.content
	});
	return /* @__PURE__ */ jsx(Pre, {
		animated,
		fullFeatured,
		language: code.lang,
		...highlight,
		...rest,
		children: code.content
	});
}, (prevProps, nextProps) => prevProps.children === nextProps.children);
//#endregion
export { CodeBlock, useCode };

//# sourceMappingURL=CodeBlock.mjs.map