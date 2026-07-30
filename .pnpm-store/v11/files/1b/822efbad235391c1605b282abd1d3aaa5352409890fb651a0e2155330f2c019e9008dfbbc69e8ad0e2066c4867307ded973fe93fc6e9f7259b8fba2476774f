"use client";
import { styles } from "../style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Layout/components/LayoutToc.tsx
const LayoutToc = memo(({ tocWidth, style, className, children, ...rest }) => {
	return /* @__PURE__ */ jsx("nav", {
		className: cx(styles.toc, className),
		style: tocWidth ? {
			width: tocWidth,
			...style
		} : style,
		...rest,
		children
	});
});
LayoutToc.displayName = "LayoutToc";
//#endregion
export { LayoutToc, LayoutToc as default };

//# sourceMappingURL=LayoutToc.mjs.map