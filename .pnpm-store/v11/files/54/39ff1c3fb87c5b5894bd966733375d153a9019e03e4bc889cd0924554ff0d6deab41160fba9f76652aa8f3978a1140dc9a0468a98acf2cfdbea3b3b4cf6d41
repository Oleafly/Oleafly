"use client";
import { itemVariants } from "../style.mjs";
import FormDivider from "./FormDivider.mjs";
import FormTitle from "./FormTitle.mjs";
import { memo, useMemo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { Form } from "antd";
import { cx } from "antd-style";
//#region src/Form/components/FormItem.tsx
const { Item } = Form;
const FormItem = memo(({ desc, tag, minWidth, avatar, className, label, children, divider, layout, variant, ...rest }) => {
	const cssVariables = useMemo(() => ({ "--form-item-min-width": minWidth !== void 0 && minWidth !== null && minWidth !== "" ? typeof minWidth === "number" ? `${minWidth}px` : minWidth : "" }), [minWidth]);
	const hasMinWidth = minWidth !== void 0 && minWidth !== null && minWidth !== "";
	const { style: restStyle, ...restProps } = rest;
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [divider && /* @__PURE__ */ jsx(FormDivider, { visible: variant !== "borderless" }), /* @__PURE__ */ jsx(Item, {
		className: cx(itemVariants({
			divider,
			itemMinWidth: hasMinWidth,
			layout
		}), className),
		label: /* @__PURE__ */ jsx(FormTitle, {
			avatar,
			desc,
			tag,
			title: label
		}),
		layout,
		style: {
			...cssVariables,
			...restStyle
		},
		...restProps,
		children
	})] });
});
FormItem.displayName = "FormItem";
//#endregion
export { FormItem as default };

//# sourceMappingURL=FormItem.mjs.map