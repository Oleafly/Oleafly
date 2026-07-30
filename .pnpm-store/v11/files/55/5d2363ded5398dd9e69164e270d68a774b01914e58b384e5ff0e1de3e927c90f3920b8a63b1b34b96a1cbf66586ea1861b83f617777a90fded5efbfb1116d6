"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { styles, variants } from "./style.mjs";
import SyntaxHighlighter from "../Highlighter/SyntaxHighlighter/index.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx } from "antd-style";
import useMergeState from "use-merge-value";
//#region src/CodeEditor/CodeEditor.tsx
const CodeEditor = memo(({ autoFocus, classNames, styles: customStyles, defaultValue = "", onChange, placeholder = "", style, className, onValueChange, value, language = "markdown", variant = "borderless", width, height, flex, ref, ...rest }) => {
	const [code, setCode] = useMergeState(defaultValue, {
		defaultValue,
		onChange: onValueChange,
		value
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({ variant }), className),
		flex,
		height,
		style,
		width,
		children: [value ? /* @__PURE__ */ jsx(SyntaxHighlighter, {
			className: cx(styles.highlight, classNames?.highlight),
			language,
			style: customStyles?.highlight,
			variant,
			children: value
		}) : /* @__PURE__ */ jsx("pre", {
			className: cx(styles.highlight, classNames?.highlight),
			style: { color: cssVar.colorTextDescription },
			children: placeholder || " "
		}), /* @__PURE__ */ jsx("textarea", {
			autoCapitalize: "off",
			autoComplete: "off",
			autoCorrect: "off",
			autoFocus,
			className: cx(styles.textarea, classNames?.textarea),
			"data-gramm": false,
			ref,
			style: customStyles?.textarea,
			value: code,
			onChange: (e) => {
				onChange?.(e);
				setCode(e.target.value);
			},
			...rest
		})]
	});
});
CodeEditor.displayName = "CodeEditor";
//#endregion
export { CodeEditor as default };

//# sourceMappingURL=CodeEditor.mjs.map