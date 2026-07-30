"use client";
import { safeReadableColor } from "../utils/safeReadableColor.mjs";
import { colorsPreset, colorsPresetSystem, presetColors, presetSystemColors } from "./utils.mjs";
import { variants } from "./styles.mjs";
import { useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { Tag } from "antd";
import { cssVar, cx } from "antd-style";
//#region src/Tag/Tag.tsx
const Tag$1 = ({ className, ref, shape = "normal", size = "middle", color, variant = "filled", children, onClick, style, ...rest }) => {
	const colors = useMemo(() => {
		const resolveActualColor = (colorValue) => {
			if (!colorValue || !colorValue.startsWith("var(")) return colorValue;
			if (typeof window === "undefined") return colorValue;
			const matched = colorValue.match(/var\((--[^,\s)]+)/);
			if (!matched?.[1]) return colorValue;
			return window.getComputedStyle(document.documentElement).getPropertyValue(matched[1]).trim() || colorValue;
		};
		let textColor = cssVar.colorTextSecondary;
		let backgroundColor;
		let borderColor;
		const isBorderless = variant === "borderless";
		const isFilled = variant === "filled";
		const isSolid = variant === "solid";
		const isPresetColor = color && presetColors.includes(color);
		const isPresetSystemColors = color && presetSystemColors.has(color);
		const isHexColor = color && color.startsWith("#");
		if (isPresetColor) {
			const solidBgColor = colorsPreset(color);
			textColor = isSolid ? safeReadableColor(resolveActualColor(solidBgColor) || solidBgColor) : colorsPreset(color, "active");
			backgroundColor = isSolid ? solidBgColor : isBorderless ? "transparent" : colorsPreset(color, "fillTertiary");
			borderColor = isSolid ? solidBgColor : colorsPreset(color, isFilled ? "fillQuaternary" : "fillTertiary");
		}
		if (isPresetSystemColors) {
			const solidBgColor = colorsPresetSystem(color);
			textColor = isSolid ? safeReadableColor(resolveActualColor(solidBgColor) || solidBgColor) : colorsPresetSystem(color);
			backgroundColor = isSolid ? solidBgColor : isBorderless ? "transparent" : colorsPresetSystem(color, "fillTertiary");
			borderColor = isSolid ? solidBgColor : colorsPresetSystem(color, isFilled ? "fillQuaternary" : "fillTertiary");
		}
		if (isHexColor) {
			textColor = isSolid ? safeReadableColor(color) : cssVar.colorBgLayout;
			backgroundColor = isSolid ? color : isBorderless ? "transparent" : color;
			borderColor = isSolid ? color : borderColor;
		}
		return {
			backgroundColor,
			borderColor,
			textColor
		};
	}, [color, variant]);
	return /* @__PURE__ */ jsx(Tag, {
		className: cx(variants({
			shape,
			size,
			variant
		}), className),
		color,
		ref,
		variant: variant === "borderless" ? "outlined" : variant === "solid" ? "filled" : variant,
		style: {
			background: colors?.backgroundColor,
			borderColor: colors?.borderColor,
			color: colors?.textColor,
			cursor: onClick ? "pointer" : void 0,
			...style
		},
		onClick,
		...rest,
		children
	});
};
Tag$1.displayName = "Tag";
//#endregion
export { Tag$1 as default };

//# sourceMappingURL=Tag.mjs.map