"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import InputNumber$1 from "../Input/InputNumber.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Slider } from "antd";
import { isNull } from "es-toolkit/compat";
//#region src/SliderWithInput/SliderWithInput.tsx
const SliderWithInput = memo(({ step, value, onChange, max, min, defaultValue, size, controls, gap = 16, style, className, classNames, styles, disabled, unlimitedInput = false, changeOnWheel, ...rest }) => {
	const handleOnchange = (value) => {
		if (Number.isNaN(value) || isNull(value)) return;
		onChange?.(value);
	};
	const inputDisabled = Array.isArray(disabled) ? disabled.some(Boolean) : disabled;
	const { slider: sliderClassName, input: inputClassName, ...restClassNames } = classNames || {};
	const { slider: sliderStyle, input: inputStyle, ...restStyles } = styles || {};
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: "center",
		className,
		direction: "horizontal",
		gap,
		style,
		children: [/* @__PURE__ */ jsx(Slider, {
			className: sliderClassName,
			classNames: restClassNames,
			defaultValue,
			disabled,
			max,
			min,
			step,
			style: {
				flex: 1,
				margin: size === "small" ? 0 : void 0,
				...sliderStyle
			},
			styles: restStyles,
			tooltip: { open: false },
			value: typeof value === "number" ? value : 0,
			onChange: handleOnchange,
			...rest
		}), /* @__PURE__ */ jsx(InputNumber$1, {
			changeOnWheel,
			className: inputClassName,
			controls: size !== "small" || controls,
			defaultValue,
			disabled: inputDisabled,
			max: unlimitedInput ? void 0 : max,
			min,
			size,
			step: Number.isNaN(step) || isNull(step) ? void 0 : step,
			style: {
				flex: 1,
				maxWidth: size === "small" ? 40 : 64,
				...inputStyle
			},
			value: typeof value === "number" ? value : 0,
			onChange: (v) => handleOnchange(Number(v))
		})]
	});
});
SliderWithInput.displayName = "SliderWithInput";
//#endregion
export { SliderWithInput as default };

//# sourceMappingURL=SliderWithInput.mjs.map