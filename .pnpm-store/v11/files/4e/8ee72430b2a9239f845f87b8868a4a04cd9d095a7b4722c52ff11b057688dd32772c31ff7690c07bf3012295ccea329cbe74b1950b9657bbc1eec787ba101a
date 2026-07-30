"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Tag from "../Tag/Tag.mjs";
import CopyButton from "../CopyButton/CopyButton.mjs";
import { styles, variants } from "../Highlighter/style.mjs";
import { MermaidFullFeatured } from "./FullFeatured.mjs";
import SyntaxMermaid from "./SyntaxMermaid/index.mjs";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Mermaid/Mermaid.tsx
const Mermaid = memo(({ actionIconSize, animated, bodyRender, children, classNames, className, copyable = true, defaultExpand = true, fileName, fullFeatured, language = "mermaid", actionsRender, shadow, showLanguage = true, style, styles: customStyles, theme, variant = "filled", ...rest }) => {
	const tirmedChildren = children.trim();
	const copyContentRef = useRef(tirmedChildren);
	useEffect(() => {
		copyContentRef.current = tirmedChildren;
	}, [tirmedChildren]);
	const getCopyContent = useCallback(() => copyContentRef.current, []);
	const originalActions = useMemo(() => {
		if (!copyable) return null;
		return /* @__PURE__ */ jsx(CopyButton, {
			content: getCopyContent,
			size: actionIconSize || {
				blockSize: 28,
				size: 16
			}
		});
	}, [
		actionIconSize,
		copyable,
		getCopyContent
	]);
	const actions = useMemo(() => {
		if (!actionsRender) return originalActions;
		return actionsRender({
			actionIconSize,
			content: tirmedChildren,
			getContent: getCopyContent,
			originalNode: originalActions
		});
	}, [
		actionIconSize,
		actionsRender,
		getCopyContent,
		originalActions,
		tirmedChildren
	]);
	const defaultBody = useMemo(() => /* @__PURE__ */ jsx(SyntaxMermaid, {
		animated,
		className: classNames?.content,
		style: customStyles?.content,
		theme,
		variant,
		children: tirmedChildren
	}), [
		animated,
		theme,
		tirmedChildren,
		variant,
		classNames?.content,
		customStyles?.content
	]);
	const body = useMemo(() => {
		if (!bodyRender) return defaultBody;
		return bodyRender({
			content: tirmedChildren,
			originalNode: defaultBody
		});
	}, [
		bodyRender,
		defaultBody,
		tirmedChildren
	]);
	if (fullFeatured) return /* @__PURE__ */ jsx(MermaidFullFeatured, {
		actionsRender,
		className,
		classNames,
		content: tirmedChildren,
		copyable,
		defaultExpand,
		fileName,
		language,
		shadow,
		showLanguage,
		style,
		styles: customStyles,
		variant,
		...rest,
		children: body
	});
	return /* @__PURE__ */ jsxs("div", {
		className: cx(variants({
			shadow,
			variant
		}), className),
		"data-code-type": "mermaid",
		style,
		...rest,
		children: [
			/* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: styles.actions,
				flex: "none",
				gap: 4,
				children: actions
			}),
			showLanguage && /* @__PURE__ */ jsx(Tag, {
				className: styles.lang,
				children: language.toLowerCase()
			}),
			body
		]
	});
});
Mermaid.displayName = "Mermaid";
//#endregion
export { Mermaid as default };

//# sourceMappingURL=Mermaid.mjs.map