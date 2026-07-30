"use client";
import { useHighlight } from "../../hooks/useHighlight.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Highlighter/SyntaxHighlighter/StaticRenderer.tsx
const escapeHtml = (str) => str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#039;");
/**
* Static renderer for syntax highlighting without animation
* Uses useHighlight hook to generate HTML and renders it directly
*/
const StaticRenderer = memo(({ children, className, enableTransformer, fallbackClassName, language, style, theme }) => {
	const safeChildren = children ?? "";
	const data = useHighlight(safeChildren, {
		enableTransformer,
		language,
		theme
	});
	return /* @__PURE__ */ jsx("div", {
		className: typeof data === "string" && data.length > 0 ? className : fallbackClassName,
		dir: "ltr",
		style,
		dangerouslySetInnerHTML: { __html: data || `<pre><code>${escapeHtml(safeChildren)}</code></pre>` }
	});
});
StaticRenderer.displayName = "StaticRenderer";
//#endregion
export { StaticRenderer as default };

//# sourceMappingURL=StaticRenderer.mjs.map