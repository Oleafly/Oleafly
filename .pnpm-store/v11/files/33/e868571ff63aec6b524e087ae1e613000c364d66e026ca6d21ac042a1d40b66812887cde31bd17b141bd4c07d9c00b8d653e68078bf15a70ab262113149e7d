"use client";
import { styles } from "../style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Layout/components/LayoutSidebar.tsx
const LayoutSidebar = memo(({ headerHeight, children, className, style, ...rest }) => {
	return /* @__PURE__ */ jsx("aside", {
		className: cx(styles.aside, className),
		style: {
			top: `var(--layout-header-height, ${headerHeight}px)`,
			...style
		},
		...rest,
		children
	});
});
LayoutSidebar.displayName = "LayoutSidebar";
//#endregion
export { LayoutSidebar, LayoutSidebar as default };

//# sourceMappingURL=LayoutSidebar.mjs.map