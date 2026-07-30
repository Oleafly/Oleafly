"use client";
import Icon from "../../../Icon/Icon.mjs";
import { groupStyles, groupVariants } from "../style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
import { ChevronDown } from "lucide-react";
import { Collapsible } from "@base-ui/react/collapsible";
//#region src/base-ui/Form/components/FormGroup.tsx
const GroupTitle = memo(({ icon, title, desc, variant, mobile }) => /* @__PURE__ */ jsxs("div", {
	className: cx(groupStyles.title, variant === "borderless" && !mobile && groupStyles.titleBorderless, mobile && groupStyles.mobileTitle),
	children: [icon && /* @__PURE__ */ jsx(Icon, { icon }), /* @__PURE__ */ jsxs("div", { children: [title, desc && /* @__PURE__ */ jsx("div", {
		className: groupStyles.desc,
		children: desc
	})] })]
}));
GroupTitle.displayName = "GroupTitle";
const FormGroup = memo(({ className, icon, title, children, extra, variant = "borderless", defaultActive = true, collapsible, active, onCollapse, desc, keyValue: _keyValue, ...rest }) => {
	const { mobile } = useResponsive();
	const isBorderless = variant === "borderless";
	const isCollapsible = collapsible === void 0 ? !isBorderless : collapsible;
	if (mobile) return /* @__PURE__ */ jsxs("div", {
		className,
		...rest,
		children: [/* @__PURE__ */ jsxs("div", {
			className: cx(groupStyles.header, groupStyles.mobileHeader),
			children: [/* @__PURE__ */ jsx(GroupTitle, {
				mobile: true,
				desc,
				icon,
				title
			}), extra]
		}), /* @__PURE__ */ jsx("div", {
			className: groupStyles.mobileBody,
			children
		})]
	});
	if (!isCollapsible) return /* @__PURE__ */ jsxs("div", {
		className: cx(groupVariants({ variant }), className),
		...rest,
		children: [title && /* @__PURE__ */ jsxs("div", {
			className: cx(groupStyles.header, isBorderless ? groupStyles.headerBorderless : groupStyles.headerBoxed),
			children: [/* @__PURE__ */ jsx(GroupTitle, {
				desc,
				icon,
				title,
				variant
			}), extra]
		}), /* @__PURE__ */ jsx("div", {
			className: cx(groupStyles.body, !isBorderless && groupStyles.bodyBoxed),
			children
		})]
	});
	return /* @__PURE__ */ jsxs(Collapsible.Root, {
		className: cx(groupVariants({ variant }), className),
		defaultOpen: defaultActive,
		open: active,
		onOpenChange: onCollapse,
		...rest,
		children: [/* @__PURE__ */ jsxs("div", {
			className: cx(groupStyles.header, isBorderless ? groupStyles.headerBorderless : groupStyles.headerBoxed),
			children: [/* @__PURE__ */ jsxs(Collapsible.Trigger, {
				className: groupStyles.trigger,
				children: [/* @__PURE__ */ jsx(GroupTitle, {
					desc,
					icon,
					title,
					variant
				}), /* @__PURE__ */ jsx(Icon, {
					className: groupStyles.chevron,
					icon: ChevronDown
				})]
			}), extra]
		}), /* @__PURE__ */ jsx(Collapsible.Panel, {
			className: groupStyles.panel,
			children: /* @__PURE__ */ jsx("div", {
				className: cx(groupStyles.body, !isBorderless && groupStyles.bodyBoxed),
				children
			})
		})]
	});
});
FormGroup.displayName = "FormGroup";
//#endregion
export { FormGroup as default };

//# sourceMappingURL=FormGroup.mjs.map