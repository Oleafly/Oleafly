"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Text from "../Text/Text.mjs";
import { stopPropagation } from "../utils/dom.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import MaterialFileTypeIcon from "../MaterialFileTypeIcon/MaterialFileTypeIcon.mjs";
import CopyButton from "../CopyButton/CopyButton.mjs";
import { bodyVariants, headerVariants, variants } from "../Highlighter/style.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ChevronDown, ChevronRight } from "lucide-react";
//#region src/Mermaid/FullFeatured.tsx
const MermaidHeaderLanguage = memo(({ fileName, language, showLanguage }) => {
	if (!showLanguage) return null;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: "languageTitle",
		flex: 1,
		gap: 4,
		justify: "flex-start",
		paddingInline: 8,
		children: [/* @__PURE__ */ jsx(MaterialFileTypeIcon, {
			fallbackUnknownType: false,
			filename: fileName || language,
			size: 18,
			type: "file",
			variant: "raw"
		}), /* @__PURE__ */ jsx(Text, {
			ellipsis: true,
			fontSize: 13,
			children: fileName || "Mermaid"
		})]
	});
}, (prev, next) => prev.fileName === next.fileName && prev.language === next.language && prev.showLanguage === next.showLanguage);
const MermaidFullFeatured = memo(({ showLanguage, styles: customStyles, classNames, content, children, className, copyable, actionsRender, style, variant, shadow, language = "mermaid", fileName, defaultExpand = true, ...rest }) => {
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
			originalNode: originalActions
		});
	}, [
		actionsRender,
		content,
		getContent,
		originalActions
	]);
	const handleToggleExpand = useCallback(() => {
		setExpand((prev) => !prev);
	}, []);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({
			shadow,
			variant
		}), className),
		"data-code-type": "mermaid",
		style,
		...rest,
		children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: cx(headerVariants({ variant }), classNames?.header),
			justify: "space-between",
			style: customStyles?.header,
			onClick: handleToggleExpand,
			children: [/* @__PURE__ */ jsx(MermaidHeaderLanguage, {
				fileName,
				language,
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
export { MermaidFullFeatured, MermaidFullFeatured as default };

//# sourceMappingURL=FullFeatured.mjs.map