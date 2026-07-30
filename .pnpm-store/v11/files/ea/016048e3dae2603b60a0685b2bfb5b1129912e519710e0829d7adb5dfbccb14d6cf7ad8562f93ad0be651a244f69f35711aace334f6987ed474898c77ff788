"use client";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Slider } from "@base-ui/react/slider";
//#region src/base-ui/Slider/Slider.tsx
const Slider$1 = memo(({ className, classNames, styles: customStyles, style, onChange, onChangeComplete, ...rest }) => /* @__PURE__ */ jsx(Slider.Root, {
	className: cx(styles.root, className),
	style,
	onValueChange: (value) => onChange?.(value),
	onValueCommitted: (value) => onChangeComplete?.(value),
	...rest,
	children: /* @__PURE__ */ jsx(Slider.Control, {
		className: cx(styles.control, classNames?.control),
		style: customStyles?.control,
		children: /* @__PURE__ */ jsxs(Slider.Track, {
			className: cx(styles.track, classNames?.track),
			style: customStyles?.track,
			children: [/* @__PURE__ */ jsx(Slider.Indicator, {
				className: cx(styles.indicator, classNames?.indicator),
				style: customStyles?.indicator
			}), /* @__PURE__ */ jsx(Slider.Thumb, {
				className: cx(styles.thumb, classNames?.thumb),
				style: customStyles?.thumb
			})]
		})
	})
}));
Slider$1.displayName = "Slider";
//#endregion
export { Slider$1 as default };

//# sourceMappingURL=Slider.mjs.map