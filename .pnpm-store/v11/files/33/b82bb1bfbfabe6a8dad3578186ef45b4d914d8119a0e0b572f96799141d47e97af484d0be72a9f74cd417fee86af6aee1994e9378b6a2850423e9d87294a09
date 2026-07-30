"use client";
import { getCssValue, getFlexDirection, isHorizontal, isSpaceDistribution } from "./utils.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Flex/FlexBasic.tsx
const FlexBasic = ({ visible, flex, gap, direction, horizontal, align, justify, distribution, height, width, allowShrink, padding, paddingInline, paddingBlock, prefixCls, as: Container = "div", className, style, children, wrap, ref, ...props }) => {
	const justifyContent = justify || distribution;
	const calcWidth = () => {
		if (isHorizontal(direction, horizontal) && !width && isSpaceDistribution(justifyContent)) return "100%";
		return getCssValue(width);
	};
	const finalWidth = calcWidth();
	const mergedStyle = {
		...flex !== void 0 ? { "--lobe-flex": String(flex) } : {},
		...direction || horizontal ? { "--lobe-flex-direction": getFlexDirection(direction, horizontal) } : {},
		...wrap !== void 0 ? { "--lobe-flex-wrap": wrap } : {},
		...justifyContent !== void 0 ? { "--lobe-flex-justify": justifyContent } : {},
		...align !== void 0 ? { "--lobe-flex-align": align } : {},
		...finalWidth !== void 0 ? { "--lobe-flex-width": finalWidth } : {},
		...height !== void 0 ? { "--lobe-flex-height": getCssValue(height) } : {},
		...padding !== void 0 ? { "--lobe-flex-padding": getCssValue(padding) } : {},
		...paddingInline !== void 0 ? { "--lobe-flex-padding-inline": getCssValue(paddingInline) } : {},
		...paddingBlock !== void 0 ? { "--lobe-flex-padding-block": getCssValue(paddingBlock) } : {},
		...gap !== void 0 ? { "--lobe-flex-gap": getCssValue(gap) } : {},
		...allowShrink ? { minWidth: 0 } : {},
		...style
	};
	const baseClassName = "lobe-flex";
	const mergedClassName = [
		baseClassName,
		visible === false ? `${baseClassName}--hidden` : void 0,
		prefixCls ? `${prefixCls}-flex` : void 0,
		className
	].filter(Boolean).join(" ");
	return /* @__PURE__ */ jsx(Container, {
		ref,
		...props,
		className: mergedClassName,
		style: mergedStyle,
		children
	});
};
var FlexBasic_default = memo(FlexBasic);
//#endregion
export { FlexBasic_default as default };

//# sourceMappingURL=FlexBasic.mjs.map