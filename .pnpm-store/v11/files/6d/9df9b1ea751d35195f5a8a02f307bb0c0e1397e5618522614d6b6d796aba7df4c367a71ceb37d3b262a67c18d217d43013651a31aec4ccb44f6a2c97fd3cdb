"use client";
import SkeletonBlock from "./SkeletonBlock.mjs";
import { jsx } from "react/jsx-runtime";
import { cssVar } from "antd-style";
//#region src/Skeleton/SkeletonTitle.tsx
const SkeletonTitle = ({ active, fontSize, lineHeight, height, width = "60%", style, className, ...rest }) => {
	const resolvedLineHeight = lineHeight ?? 1.6;
	const baseFontSize = fontSize !== void 0 ? `${fontSize}px` : cssVar.fontSize;
	const heightMultiplier = 1 + (resolvedLineHeight - 1) * .5;
	const marginMultiplier = (resolvedLineHeight - 1) * .25;
	return /* @__PURE__ */ jsx(SkeletonBlock, {
		active,
		className,
		height: height ?? `round(calc(${baseFontSize} * ${heightMultiplier}), 1px)`,
		width,
		style: {
			marginBlock: `round(calc(${baseFontSize} * ${marginMultiplier}), 1px)`,
			...style
		},
		...rest
	});
};
SkeletonTitle.displayName = "SkeletonTitle";
//#endregion
export { SkeletonTitle as default };

//# sourceMappingURL=SkeletonTitle.mjs.map