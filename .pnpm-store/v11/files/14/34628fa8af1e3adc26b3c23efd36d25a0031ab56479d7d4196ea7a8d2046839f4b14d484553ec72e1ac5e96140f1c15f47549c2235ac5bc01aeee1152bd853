"use client";
import { useTextOverflow } from "../hooks/useTextOverflow.mjs";
import { Tooltip } from "../base-ui/Tooltip/Tooltip.mjs";
import { variants } from "./styles.mjs";
import { useRef } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Text/Text.tsx
const Text = ({ as: Container = "div", align, className, children, style, type, disabled, strong, italic, underline, delete: deleteStyle, fontSize, lineClamp, lineHeight, mark, code, color, weight, ellipsis, noWrap, textDecoration, textTransform, whiteSpace, wordBreak, ...rest }) => {
	const textRef = useRef(null);
	const isOverflow = useTextOverflow(textRef, ellipsis, children);
	const isMultiEllipsis = typeof ellipsis === "object" && !!ellipsis.rows && ellipsis.rows > 1;
	const tooltipWhenOverflow = typeof ellipsis === "object" && ellipsis.tooltipWhenOverflow;
	const content = /* @__PURE__ */ jsx(Container, {
		ref: textRef,
		style: {
			...color && { color },
			...weight && { fontWeight: weight },
			...lineHeight && { lineHeight },
			...textTransform && { textTransform },
			...textDecoration && { textDecoration },
			...wordBreak && { wordBreak },
			...typeof ellipsis === "object" && ellipsis.rows && { WebkitLineClamp: ellipsis.rows },
			...!ellipsis && !!lineClamp && {
				WebkitBoxOrient: "vertical",
				WebkitLineClamp: lineClamp,
				display: "-webkit-box",
				overflow: "hidden",
				textOverflow: "ellipsis"
			},
			...fontSize && { fontSize },
			...align && { textAlign: align },
			...!isMultiEllipsis && noWrap && { whiteSpace: "nowrap" },
			...whiteSpace && { whiteSpace },
			...style
		},
		className: cx(variants({
			as: [
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"p"
			].includes(Container) ? Container : void 0,
			code,
			delete: deleteStyle,
			disabled,
			ellipsis: ellipsis ? typeof ellipsis === "object" && ellipsis.rows ? "multi" : true : void 0,
			italic,
			mark,
			strong,
			type,
			underline
		}), className),
		...rest,
		children
	});
	if (ellipsis && typeof ellipsis === "object" && (ellipsis.tooltip || ellipsis.tooltipWhenOverflow)) {
		if (tooltipWhenOverflow && !isOverflow) return content;
		const title = typeof ellipsis.tooltip === "string" ? ellipsis.tooltip : children;
		if (ellipsis.tooltip && typeof ellipsis.tooltip === "object") return /* @__PURE__ */ jsx(Tooltip, {
			...ellipsis.tooltip,
			title: ellipsis.tooltip?.title || title,
			children: content
		});
		return /* @__PURE__ */ jsx(Tooltip, {
			title,
			children: content
		});
	}
	return content;
};
Text.displayName = "Text";
//#endregion
export { Text as default };

//# sourceMappingURL=Text.mjs.map