"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Tag from "../Tag/Tag.mjs";
import { getCodeLanguageDisplayName } from "./const.mjs";
import SyntaxHighlighter from "./SyntaxHighlighter/index.mjs";
import CopyButton from "../CopyButton/CopyButton.mjs";
import { styles, variants } from "./style.mjs";
import { HighlighterFullFeatured } from "./FullFeatured.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Highlighter/Highlighter.tsx
const Highlighter = memo(({ animated, fullFeatured, actionIconSize, children, language = "markdown", className, classNames, styles: customStyles, copyable = true, showLanguage = true, variant = "filled", shadow, wrap, bodyRender, actionsRender, enableTransformer, theme, icon, fileName, allowChangeLanguage, defaultExpand = true, ...rest }) => {
	const [lang, setLang] = useState(language);
	const tirmedChildren = useMemo(() => {
		if (children === null || children === void 0) return "";
		if (typeof children !== "string") {
			console.warn("Highlighter: children should be a string, received:", typeof children);
			return String(children);
		}
		return children.trim();
	}, [children]);
	const copyContentRef = useRef(tirmedChildren);
	useEffect(() => {
		copyContentRef.current = tirmedChildren;
	}, [tirmedChildren]);
	const getCopyContent = useCallback(() => copyContentRef.current, []);
	const originalActions = useMemo(() => {
		if (!copyable) return null;
		return /* @__PURE__ */ jsx(CopyButton, {
			glass: true,
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
			language: lang,
			originalNode: originalActions
		});
	}, [
		actionIconSize,
		actionsRender,
		getCopyContent,
		lang,
		originalActions,
		tirmedChildren
	]);
	const originalBody = useMemo(() => /* @__PURE__ */ jsx(SyntaxHighlighter, {
		animated,
		className: classNames?.content,
		enableTransformer,
		language: lang?.toLowerCase(),
		theme,
		variant,
		style: {
			height: "100%",
			...customStyles?.content
		},
		children: tirmedChildren
	}), [
		animated,
		enableTransformer,
		lang,
		theme,
		tirmedChildren,
		variant,
		customStyles?.content,
		customStyles?.content
	]);
	const displayName = useMemo(() => {
		if (fileName) return fileName;
		return getCodeLanguageDisplayName(language);
	}, [fileName, language]);
	const body = useMemo(() => {
		if (!bodyRender) return originalBody;
		return bodyRender({
			content: tirmedChildren,
			language: lang,
			originalNode: originalBody
		});
	}, [
		bodyRender,
		lang,
		originalBody,
		tirmedChildren
	]);
	if (fullFeatured) return /* @__PURE__ */ jsx(HighlighterFullFeatured, {
		actionsRender,
		allowChangeLanguage,
		className,
		classNames,
		content: tirmedChildren,
		copyable,
		defaultExpand,
		fileName,
		icon,
		language,
		setLanguage: setLang,
		shadow,
		showLanguage,
		styles: customStyles,
		variant,
		wrap,
		...rest,
		children: body
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({
			shadow,
			variant,
			wrap
		}), className),
		"data-code-type": "highlighter",
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
			showLanguage && language && /* @__PURE__ */ jsx(Tag, {
				className: styles.lang,
				children: displayName
			}),
			body
		]
	});
});
Highlighter.displayName = "Highlighter";
//#endregion
export { Highlighter, Highlighter as default };

//# sourceMappingURL=Highlighter.mjs.map