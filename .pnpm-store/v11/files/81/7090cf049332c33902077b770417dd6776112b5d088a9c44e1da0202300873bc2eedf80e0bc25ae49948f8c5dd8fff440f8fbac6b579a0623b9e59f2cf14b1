"use client";
import { useStreamHighlight } from "../../hooks/useStreamHighlight.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { getTokenStyleObject } from "@shikijs/core";
//#region src/Highlighter/SyntaxHighlighter/StreamRenderer.tsx
const normalizeStyleKeys = (style) => {
	const normalized = {};
	Object.entries(style).forEach(([key, value]) => {
		const normalizedKey = key.replaceAll(/-([a-z])/g, (_, char) => char.toUpperCase());
		normalized[normalizedKey] = value;
	});
	return normalized;
};
const getTokenInlineStyle = (token) => {
	const rawStyle = token.htmlStyle || getTokenStyleObject(token);
	return {
		...normalizeStyleKeys(rawStyle),
		whiteSpace: "pre"
	};
};
const TokenSpan = memo(({ token }) => {
	return /* @__PURE__ */ jsx("span", {
		style: getTokenInlineStyle(token),
		children: token.content
	}, token.content);
}, (prev, next) => prev.token === next.token);
const TokenLine = memo(({ line }) => {
	if (!line.length) return /* @__PURE__ */ jsx("span", {
		className: "line",
		children: /* @__PURE__ */ jsx("span", {
			style: { whiteSpace: "pre" },
			children: "\xA0"
		})
	});
	return /* @__PURE__ */ jsx("span", {
		className: "line",
		children: line.map((token, tokenIndex) => /* @__PURE__ */ jsx(TokenSpan, { token }, `token-${tokenIndex}`))
	});
}, (prev, next) => prev.line === next.line);
const StreamRenderer = memo(({ children, className, enableTransformer, fallbackClassName, language, style, theme }) => {
	const safeChildren = children ?? "";
	const streaming = useStreamHighlight(safeChildren, {
		enableTransformer,
		language,
		streaming: true,
		theme
	});
	const lines = streaming?.lines;
	const preStyle = streaming?.preStyle;
	if (!lines || lines.length === 0) return /* @__PURE__ */ jsx("div", {
		className: fallbackClassName,
		dir: "ltr",
		style,
		children: /* @__PURE__ */ jsx("pre", { children: /* @__PURE__ */ jsx("code", { children: safeChildren }) })
	});
	return /* @__PURE__ */ jsx("div", {
		className,
		dir: "ltr",
		style,
		children: /* @__PURE__ */ jsx("pre", {
			className: cx("shiki", theme),
			style: preStyle,
			tabIndex: 0,
			children: /* @__PURE__ */ jsx("code", {
				style: {
					display: "flex",
					flexDirection: "column",
					whiteSpace: "pre"
				},
				children: lines.map((line, index) => /* @__PURE__ */ jsx(TokenLine, { line }, `line-${index}`))
			})
		})
	});
});
StreamRenderer.displayName = "StreamRenderer";
//#endregion
export { StreamRenderer as default };

//# sourceMappingURL=StreamRenderer.mjs.map