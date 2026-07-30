"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/SideNav/SideNav.tsx
const SideNav = memo(({ className, avatar, topActions, bottomActions, ...rest }) => {
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: "center",
		className: cx(styles, className),
		flex: "none",
		justify: "space-between",
		...rest,
		children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
			align: "center",
			direction: "vertical",
			gap: 12,
			children: [avatar, /* @__PURE__ */ jsx(FlexBasic_default, {
				align: "center",
				direction: "vertical",
				gap: 8,
				children: topActions
			})]
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			align: "center",
			direction: "vertical",
			gap: 4,
			children: bottomActions
		})]
	});
});
SideNav.displayName = "SideNav";
//#endregion
export { SideNav as default };

//# sourceMappingURL=SideNav.mjs.map