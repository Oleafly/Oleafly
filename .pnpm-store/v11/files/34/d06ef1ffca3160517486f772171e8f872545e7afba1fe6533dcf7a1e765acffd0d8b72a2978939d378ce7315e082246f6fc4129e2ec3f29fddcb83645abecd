"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Icon from "../../Icon/Icon.mjs";
import Collapse from "../../Collapse/Collapse.mjs";
import { groupStyles, titleVariants } from "../style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
import { isUndefined } from "es-toolkit/compat";
//#region src/Form/components/FormGroup.tsx
const FormGroup = memo(({ className, icon, title, children, extra, variant = "borderless", defaultActive = true, collapsible, active, keyValue = "group", onCollapse, desc, ...rest }) => {
	const { mobile } = useResponsive();
	const styles = groupStyles;
	const isBorderless = variant === "borderless";
	const defaultCollapsible = isUndefined(collapsible) ? !isBorderless : collapsible;
	const titleContent = /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		className: cx(titleVariants({ variant }), styles.titleMobile),
		gap: 8,
		children: [icon && /* @__PURE__ */ jsx(Icon, { icon }), title]
	});
	if (mobile) return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className,
		children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			className: styles.mobileGroupHeader,
			justify: "space-between",
			children: [titleContent, extra]
		}), /* @__PURE__ */ jsx("div", {
			className: styles.mobileGroupBody,
			children
		})]
	});
	return /* @__PURE__ */ jsx(Collapse, {
		activeKey: isUndefined(active) ? void 0 : active ? [keyValue] : [],
		className,
		collapsible: defaultCollapsible,
		defaultActiveKey: defaultActive ? [keyValue] : void 0,
		variant,
		classNames: {
			header: isBorderless ? styles.titleBorderless : void 0,
			title: isBorderless ? styles.titleBorderless : void 0
		},
		items: [{
			children,
			desc,
			extra,
			icon,
			key: keyValue,
			label: title
		}],
		onChange: (v) => onCollapse?.(v.length > 0),
		...rest
	});
});
FormGroup.displayName = "FormGroup";
//#endregion
export { FormGroup as default };

//# sourceMappingURL=FormGroup.mjs.map