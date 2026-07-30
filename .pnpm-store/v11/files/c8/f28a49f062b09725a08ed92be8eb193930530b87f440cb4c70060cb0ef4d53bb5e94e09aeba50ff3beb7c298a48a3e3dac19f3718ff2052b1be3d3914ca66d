"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Text from "../Text/Text.mjs";
import { stopPropagation } from "../utils/dom.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import MaterialFileTypeIcon from "../MaterialFileTypeIcon/MaterialFileTypeIcon.mjs";
import { getCodeLanguageDisplayName, getCodeLanguageFilename } from "./const.mjs";
import CopyButton from "../CopyButton/CopyButton.mjs";
import { LangSelect } from "./LangSelect.mjs";
import { bodyVariants, headerVariants, variants } from "./style.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ChevronDown, ChevronRight } from "lucide-react";
//#region src/Highlighter/FullFeatured.tsx
const HeaderLanguage = memo(({ allowChangeLanguage, displayName, fileName, filetype, icon, language, setLanguage, showLanguage }) => {
	if (!showLanguage) return null;
	if (allowChangeLanguage && !fileName) return /* @__PURE__ */ jsx(LangSelect, {
		value: language.toLowerCase(),
		onSelect: setLanguage
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: "languageTitle",
		flex: 1,
		gap: 4,
		justify: "flex-start",
		paddingInline: 8,
		children: [icon || /* @__PURE__ */ jsx(MaterialFileTypeIcon, {
			fallbackUnknownType: false,
			filename: filetype,
			size: 18,
			type: "file",
			variant: "raw"
		}), /* @__PURE__ */ jsx(Text, {
			ellipsis: true,
			fontSize: 13,
			children: displayName
		})]
	});
}, (prev, next) => prev.allowChangeLanguage === next.allowChangeLanguage && prev.displayName === next.displayName && prev.fileName === next.fileName && prev.filetype === next.filetype && prev.icon === next.icon && prev.language === next.language && prev.setLanguage === next.setLanguage && prev.showLanguage === next.showLanguage);
const HighlighterFullFeatured = memo(({ content, language, setLanguage, showLanguage, className, classNames, styles: customStyles, style, allowChangeLanguage = false, fileName, icon, actionsRender, copyable, variant, shadow, wrap, defaultExpand = true, children, ...rest }) => {
	const [expand, setExpand] = useState(defaultExpand);
	const contentRef = useRef(content);
	useEffect(() => {
		contentRef.current = content;
	}, [content]);
	const getContent = useCallback(() => contentRef.current, []);
	const originalActions = useMemo(() => {
		if (!copyable) return null;
		return /* @__PURE__ */ jsx(CopyButton, {
			content: getContent,
			size: "small"
		});
	}, [copyable, getContent]);
	const actions = useMemo(() => {
		if (!actionsRender) return originalActions;
		return actionsRender({
			actionIconSize: "small",
			content,
			getContent,
			language,
			originalNode: originalActions
		});
	}, [
		actionsRender,
		content,
		getContent,
		language,
		originalActions
	]);
	const displayName = useMemo(() => {
		if (fileName) return fileName;
		return getCodeLanguageDisplayName(language);
	}, [fileName, language]);
	const filetype = useMemo(() => {
		if (fileName) return fileName;
		return getCodeLanguageFilename(language);
	}, [fileName, language]);
	const handleToggleExpand = useCallback(() => {
		setExpand((prev) => !prev);
	}, []);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({
			shadow,
			variant,
			wrap
		}), className),
		"data-code-type": "highlighter",
		style,
		...rest,
		children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: cx(headerVariants({ variant }), classNames?.header),
			justify: "space-between",
			style: customStyles?.header,
			onClick: handleToggleExpand,
			children: [/* @__PURE__ */ jsx(HeaderLanguage, {
				allowChangeLanguage,
				displayName,
				fileName,
				filetype,
				icon,
				language,
				setLanguage,
				showLanguage
			}), /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				flex: "none",
				gap: 4,
				onClick: stopPropagation,
				children: [/* @__PURE__ */ jsx(FlexBasic_default, {
					horizontal: true,
					align: "center",
					className: "panel-actions",
					flex: "none",
					gap: 4,
					children: actions
				}), /* @__PURE__ */ jsx(ActionIcon, {
					icon: expand ? ChevronDown : ChevronRight,
					size: "small",
					onClick: handleToggleExpand
				})]
			})]
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			className: cx(bodyVariants({ expand }), classNames?.body),
			style: customStyles?.body,
			children
		})]
	});
});
//#endregion
export { HighlighterFullFeatured, HighlighterFullFeatured as default };

//# sourceMappingURL=FullFeatured.mjs.map