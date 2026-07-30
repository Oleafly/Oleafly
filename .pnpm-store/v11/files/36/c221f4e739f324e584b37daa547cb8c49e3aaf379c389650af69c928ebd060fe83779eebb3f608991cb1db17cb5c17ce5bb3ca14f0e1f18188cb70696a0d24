"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
//#region src/Header/Header.tsx
const Header = memo(({ actionsClassName, navClassName, logoClassName, nav, logo, actions, actionsStyle, logoStyle, navStyle, className, children, ref, ...rest }) => {
	const { mobile } = useResponsive();
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		as: "section",
		className: cx(styles.root, className),
		distribution: "space-between",
		ref,
		width: "auto",
		...rest,
		children: mobile ? /* @__PURE__ */ jsxs(Fragment$1, { children: [
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				className: actionsClassName,
				style: {
					flex: 0,
					...navStyle
				},
				children: [nav, children]
			}),
			/* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				className: cx(styles.left, logoClassName),
				style: {
					flex: 1,
					overflow: "hidden",
					...logoStyle
				},
				children: logo
			}),
			/* @__PURE__ */ jsx(FlexBasic_default, {
				className: actionsClassName,
				style: {
					flex: 0,
					...actionsStyle
				},
				children: actions
			})
		] }) : /* @__PURE__ */ jsxs(Fragment$1, { children: [
			/* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				className: cx(styles.left, logoClassName),
				style: {
					flex: 0,
					...logoStyle
				},
				children: logo
			}),
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				className: navClassName,
				style: {
					flex: 1,
					marginLeft: 48,
					overflow: "hidden",
					...navStyle
				},
				children: [nav, children]
			}),
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				className: cx(styles.right, actionsClassName),
				flex: 1,
				justify: "space-between",
				style: actionsStyle,
				children: [/* @__PURE__ */ jsx("div", {}), /* @__PURE__ */ jsx(FlexBasic_default, {
					horizontal: true,
					align: "center",
					gap: 8,
					children: actions
				})]
			})
		] })
	});
});
Header.displayName = "Header";
//#endregion
export { Header as default };

//# sourceMappingURL=Header.mjs.map