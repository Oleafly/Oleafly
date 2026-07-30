"use client";
import "../../Highlighter/const.mjs";
import { Pre, PreMermaid, PreSingleLine } from "./Pre.mjs";
import { jsx } from "react/jsx-runtime";
//#region src/mdx/mdxComponents/CodeBlock.tsx
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
const CodeBlock = ({ children, fullFeatured, enableMermaid, mermaid }) => {
	const code = useCode(children);
	if (!code) return;
	if (enableMermaid && code.lang === "mermaid") return /* @__PURE__ */ jsx(PreMermaid, {
		fullFeatured,
		...mermaid,
		children: code.content
	});
	if (code.isSingleLine) return /* @__PURE__ */ jsx(PreSingleLine, {
		language: code.lang,
		children: code.content
	});
	return /* @__PURE__ */ jsx(Pre, {
		allowChangeLanguage: false,
		fullFeatured,
		language: code.lang,
		children: code.content
	});
};
CodeBlock.displayName = "MdxCodeBlock";
//#endregion
export { CodeBlock as default };

//# sourceMappingURL=CodeBlock.mjs.map