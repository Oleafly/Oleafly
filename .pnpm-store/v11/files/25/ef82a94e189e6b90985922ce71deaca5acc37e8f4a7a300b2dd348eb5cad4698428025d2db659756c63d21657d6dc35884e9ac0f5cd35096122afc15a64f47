"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Text from "../Text/Text.mjs";
import { stopPropagation } from "../utils/dom.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import MaterialFileTypeIcon from "../MaterialFileTypeIcon/MaterialFileTypeIcon.mjs";
import Tag from "../Tag/Tag.mjs";
import { bodyVariants, headerVariants, prefix, styles, variants } from "./style.mjs";
import { memo, useCallback, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ChevronDown, ChevronRight } from "lucide-react";
//#region src/CodeDiff/DiffPanel.tsx
const DiffPanel = memo(({ actions, body, className, classNames, dataCodeType, defaultExpand = true, deletions, displayName, fileName, fullFeatured = true, showHeader = true, styles: customStyles, variant = "filled", additions, ...rest }) => {
	const [expand, setExpand] = useState(defaultExpand);
	const handleToggleExpand = useCallback(() => {
		setExpand((prev) => !prev);
	}, []);
	if (!fullFeatured) return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({ variant }), className),
		"data-code-type": dataCodeType,
		...rest,
		children: [
			/* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: styles.actionsCompact,
				flex: "none",
				gap: 4,
				children: actions
			}),
			showHeader && /* @__PURE__ */ jsx(Tag, {
				className: styles.lang,
				children: displayName
			}),
			/* @__PURE__ */ jsx("div", {
				className: cx(styles.body, classNames?.body),
				style: customStyles?.body,
				children: body
			})
		]
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({ variant }), className),
		"data-code-type": dataCodeType,
		...rest,
		children: [showHeader && /* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: cx(headerVariants({ variant }), classNames?.header),
			justify: "space-between",
			style: customStyles?.header,
			onClick: handleToggleExpand,
			children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: "language-title",
				flex: 1,
				gap: 4,
				justify: "flex-start",
				paddingInline: 8,
				children: [/* @__PURE__ */ jsx(MaterialFileTypeIcon, {
					fallbackUnknownType: false,
					filename: fileName || displayName,
					size: 18,
					type: "file",
					variant: "raw"
				}), /* @__PURE__ */ jsx(Text, {
					ellipsis: true,
					fontSize: 13,
					children: displayName
				})]
			}), /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				flex: "none",
				gap: 8,
				onClick: stopPropagation,
				children: [
					actions && /* @__PURE__ */ jsx(FlexBasic_default, {
						horizontal: true,
						align: "center",
						className: cx("panel-actions", `lobe-code-diff-actions`, styles.actions),
						flex: "none",
						gap: 4,
						children: actions
					}),
					(deletions > 0 || additions > 0) && /* @__PURE__ */ jsxs(FlexBasic_default, {
						horizontal: true,
						className: styles.stats,
						gap: 8,
						children: [deletions > 0 && /* @__PURE__ */ jsxs("span", {
							className: styles.deletions,
							children: ["-", deletions]
						}), additions > 0 && /* @__PURE__ */ jsxs("span", {
							className: styles.additions,
							children: ["+", additions]
						})]
					}),
					/* @__PURE__ */ jsx(ActionIcon, {
						icon: expand ? ChevronDown : ChevronRight,
						size: "small",
						onClick: handleToggleExpand
					})
				]
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: cx(bodyVariants({ expand }), `${prefix}-body`, styles.body, classNames?.body),
			style: customStyles?.body,
			children: body
		})]
	});
});
DiffPanel.displayName = "DiffPanel";
//#endregion
export { DiffPanel };

//# sourceMappingURL=DiffPanel.mjs.map