"use client";
import Block from "../Block/Block.mjs";
import { styles } from "./style.mjs";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Skeleton/SkeletonBlock.tsx
const SkeletonBlock = ({ width = "100%", height = "1em", active, style, className }) => {
	return /* @__PURE__ */ jsx(Block, {
		className: cx(styles.base, active && styles.active, className),
		height,
		style,
		variant: "filled",
		width
	});
};
SkeletonBlock.displayName = "SkeletonBlock";
//#endregion
export { SkeletonBlock as default };

//# sourceMappingURL=SkeletonBlock.mjs.map