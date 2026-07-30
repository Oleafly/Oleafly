"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import SkeletonBlock from "./SkeletonBlock.mjs";
import { jsx } from "react/jsx-runtime";
import { cssVar } from "antd-style";
//#region src/Skeleton/SkeletonTags.tsx
const DEFAULT_COUNT = 1;
const HEIGHT_MAP = {
	large: 28,
	middle: 22,
	small: 20
};
const DEFAULT_WIDTH_MAP = {
	large: 64,
	middle: 48,
	small: 36
};
const SkeletonTags = ({ active, className, count = DEFAULT_COUNT, gap, height, size = "middle", style, width, ...rest }) => {
	const resolvedGap = gap !== void 0 ? `${gap}px` : cssVar.paddingXS;
	const resolvedCount = Math.max(count, 1);
	const resolvedHeight = height ?? HEIGHT_MAP[size];
	const widthList = Array.isArray(width) ? width : null;
	const defaultWidth = DEFAULT_WIDTH_MAP[size];
	const RADIUS_MAP = {
		large: cssVar.borderRadius,
		middle: cssVar.borderRadiusSM,
		small: cssVar.borderRadiusXS
	};
	const getWidth = (index) => {
		if (widthList) return widthList[index] ?? widthList.at(-1) ?? defaultWidth;
		if (width !== void 0) return width;
		return defaultWidth;
	};
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		className,
		style: {
			gap: resolvedGap,
			...style
		},
		...rest,
		children: Array.from({ length: resolvedCount }).map((_, index) => /* @__PURE__ */ jsx(SkeletonBlock, {
			active,
			height: resolvedHeight,
			width: getWidth(index),
			style: { borderRadius: RADIUS_MAP[size] }
		}, index))
	});
};
SkeletonTags.displayName = "SkeletonTags";
//#endregion
export { SkeletonTags as default };

//# sourceMappingURL=SkeletonTags.mjs.map