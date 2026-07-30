"use client";
import StaticRenderer from "./StaticRenderer.mjs";
import StreamRenderer from "./StreamRenderer.mjs";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Highlighter/SyntaxHighlighter/index.tsx
const SyntaxHighlighter = memo(({ animated, children, className, enableTransformer, language, style, theme, variant = "borderless" }) => {
	const isDefaultTheme = theme === "lobe-theme" || !theme;
	const showBackground = !isDefaultTheme && variant === "filled";
	const resolvedTheme = isDefaultTheme ? void 0 : theme;
	const shikiClassName = cx(variants({
		animated,
		shiki: true,
		showBackground,
		variant
	}), className);
	const fallbackClassName = cx(variants({
		animated,
		shiki: false,
		showBackground,
		variant
	}), className);
	if (animated) return /* @__PURE__ */ jsx(StreamRenderer, {
		className: shikiClassName,
		enableTransformer,
		fallbackClassName,
		language,
		style,
		theme: resolvedTheme,
		children
	});
	return /* @__PURE__ */ jsx(StaticRenderer, {
		className: shikiClassName,
		enableTransformer,
		fallbackClassName,
		language,
		style,
		theme: resolvedTheme,
		children
	});
}, (prevProps, nextProps) => prevProps.children === nextProps.children && prevProps.language === nextProps.language);
SyntaxHighlighter.displayName = "SyntaxHighlighter";
//#endregion
export { SyntaxHighlighter as default };

//# sourceMappingURL=index.mjs.map