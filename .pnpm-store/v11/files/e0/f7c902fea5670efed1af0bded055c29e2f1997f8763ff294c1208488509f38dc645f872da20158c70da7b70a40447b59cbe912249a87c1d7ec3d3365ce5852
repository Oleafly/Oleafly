"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Icon from "../Icon/Icon.mjs";
import { DEFAULT_PADDING, getPadding, styles, variants } from "./style.mjs";
import { isValidElement, memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Collapse, ConfigProvider } from "antd";
import { cx, useThemeMode } from "antd-style";
import { ChevronDown } from "lucide-react";
//#region src/Collapse/Collapse.tsx
const Collapse$1 = memo(({ style, variant = "filled", gap = 0, className, padding = DEFAULT_PADDING, size, collapsible = true, items, styles: customStyles, classNames, ref, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const antdItems = useMemo(() => items.map(({ icon, desc, label, ...itemRest }) => {
		let content = /* @__PURE__ */ jsx("div", {
			className: cx(styles.title, !icon && !desc && classNames?.header, classNames?.title),
			style: {
				...!icon && !desc ? customStyles?.header : {},
				...customStyles?.title
			},
			children: label
		});
		if (icon) content = /* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			className: cx(styles.title, !desc && classNames?.header),
			gap: 8,
			style: desc ? void 0 : customStyles?.header,
			children: [isValidElement(icon) ? icon : /* @__PURE__ */ jsx(Icon, {
				icon,
				size: { size: "1.1em" }
			}), content]
		});
		if (desc) content = /* @__PURE__ */ jsxs(FlexBasic_default, {
			className: classNames?.header,
			style: customStyles?.header,
			children: [content, /* @__PURE__ */ jsx("div", {
				className: cx(styles.desc, classNames?.desc),
				style: customStyles?.desc,
				children: desc
			})]
		});
		return {
			label: content,
			...itemRest
		};
	}), [
		items,
		classNames,
		customStyles,
		styles
	]);
	return /* @__PURE__ */ jsx(ConfigProvider, {
		theme: { components: { Collapse: {
			contentPadding: getPadding(typeof padding === "object" ? padding?.body : padding),
			headerPadding: getPadding(typeof padding === "object" ? padding?.header : padding)
		} } },
		children: /* @__PURE__ */ jsx(Collapse, {
			ghost: true,
			className: cx(variants({
				collapsible,
				gap: !!gap,
				isDarkMode,
				variant
			}), className),
			collapsible: collapsible ? "header" : "icon",
			items: antdItems,
			ref,
			size,
			expandIcon: ({ isActive }) => /* @__PURE__ */ jsx(Icon, {
				className: styles.icon,
				icon: ChevronDown,
				size: 16,
				style: { rotate: isActive ? void 0 : "-90deg" }
			}),
			style: {
				gap,
				...style
			},
			...rest
		})
	});
});
Collapse$1.displayName = "Collapse";
//#endregion
export { Collapse$1 as default };

//# sourceMappingURL=Collapse.mjs.map