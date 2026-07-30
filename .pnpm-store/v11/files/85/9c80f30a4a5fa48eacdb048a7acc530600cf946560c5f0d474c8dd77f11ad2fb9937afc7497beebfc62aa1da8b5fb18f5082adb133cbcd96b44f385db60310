"use client";
import { styles } from "./style.mjs";
import SkeletonBlock from "./SkeletonBlock.mjs";
import { jsx } from "react/jsx-runtime";
import { cssVar, cx } from "antd-style";
//#region src/Skeleton/SkeletonAvatar.tsx
const DEFAULT_SIZE = 40;
const SkeletonAvatar = ({ active, shape = "square", size, width, height, style, className, ...rest }) => {
	const defaultSize = size ?? DEFAULT_SIZE;
	const finalWidth = width ?? defaultSize;
	const finalHeight = height ?? defaultSize;
	const borderRadius = shape === "circle" ? "50%" : cssVar.borderRadius;
	return /* @__PURE__ */ jsx(SkeletonBlock, {
		active,
		className: cx(styles.avatar, className),
		height: finalHeight,
		style: {
			borderRadius,
			...style
		},
		width: finalWidth,
		...rest
	});
};
SkeletonAvatar.displayName = "SkeletonAvatar";
//#endregion
export { SkeletonAvatar as default };

//# sourceMappingURL=SkeletonAvatar.mjs.map