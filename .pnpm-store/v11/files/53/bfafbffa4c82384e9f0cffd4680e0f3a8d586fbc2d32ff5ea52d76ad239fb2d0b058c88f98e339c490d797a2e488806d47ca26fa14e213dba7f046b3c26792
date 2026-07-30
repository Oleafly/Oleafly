"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Center from "../Flex/Center.mjs";
import { safeReadableColor } from "../utils/safeReadableColor.mjs";
import Icon from "../Icon/Icon.mjs";
import { Tooltip } from "../base-ui/Tooltip/Tooltip.mjs";
import { styles } from "./style.mjs";
import { useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { ColorPicker } from "antd";
import { cssVar, cx } from "antd-style";
import useMergeState from "use-merge-value";
import { rgba } from "polished";
import { CheckIcon } from "lucide-react";
import chroma from "chroma-js";
//#region src/ColorSwatches/ColorSwatches.tsx
const ColorSwatches = ({ enableColorPicker, enableColorSwatches = true, defaultValue, value, style, colors, onChange, size = 24, shape = "circle", texts, ref, ...rest }) => {
	const [active, setActive] = useMergeState(defaultValue, {
		defaultValue,
		onChange,
		value
	});
	const cssVariables = useMemo(() => ({ "--color-swatches-size": `${size}px` }), [size]);
	const isCustomActive = useMemo(() => active && active !== cssVar.colorPrimary && !colors.some((c) => c.color === active), [active, colors]);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		gap: 6,
		ref,
		style: {
			...cssVariables,
			flexWrap: "wrap",
			...style
		},
		...rest,
		children: [enableColorSwatches && colors.map((c, i) => {
			const color = c.color || cssVar.colorPrimary;
			const isActive = !active && !c.color || color === active;
			const isTransparent = c.color === "transparent" || c.color && !c.color.startsWith("var(") && (() => {
				try {
					return chroma(c.color).alpha() === 0;
				} catch {
					return false;
				}
			})();
			const actualColorForReadable = c.color?.startsWith("var(") ? cssVar.colorPrimary : color;
			return /* @__PURE__ */ jsx(Tooltip, {
				title: c.title,
				children: /* @__PURE__ */ jsx(Center, {
					className: cx(styles.container, isTransparent && styles.transparent, isActive && styles.active),
					style: {
						background: isTransparent ? void 0 : color,
						borderRadius: shape === "circle" ? "50%" : cssVar.borderRadius
					},
					onClick: () => setActive(c.color || void 0),
					children: isActive && /* @__PURE__ */ jsx(Icon, {
						color: rgba(safeReadableColor(actualColorForReadable), .33),
						icon: CheckIcon,
						size: {
							size: 14,
							strokeWidth: 4
						},
						style: { pointerEvents: "none" }
					})
				})
			}, c?.key || i);
		}), enableColorPicker && /* @__PURE__ */ jsx(Tooltip, {
			title: texts?.custom || "Custom",
			children: /* @__PURE__ */ jsx(ColorPicker, {
				disabledAlpha: true,
				arrow: false,
				defaultValue: cssVar.colorPrimary,
				format: "hex",
				value: enableColorSwatches ? void 0 : active,
				className: cx(styles.picker, enableColorSwatches && styles.conic, isCustomActive && styles.active),
				presets: enableColorSwatches ? void 0 : [{
					colors: colors.map((c) => c.color),
					label: texts?.presets || "Presets"
				}],
				style: { borderRadius: shape === "circle" ? "50%" : cssVar.borderRadius },
				onChangeComplete: (c) => {
					if (c.toHexString() === cssVar.colorPrimary) setActive("");
					else setActive(c.toHexString());
				}
			})
		})]
	});
};
ColorSwatches.displayName = "ColorSwatches";
//#endregion
export { ColorSwatches as default };

//# sourceMappingURL=ColorSwatches.mjs.map