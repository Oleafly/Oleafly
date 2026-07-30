"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import InputNumber from "../Input/InputNumber.mjs";
import Slider from "./Slider.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { isNull } from "es-toolkit/compat";
//#region src/base-ui/Slider/SliderWithInput.tsx
const SliderWithInput = memo(({ step, value, onChange, max, min, defaultValue, size, controls, gap = 16, style, className, classNames, styles: customStyles, disabled, unlimitedInput = false, changeOnWheel, shadow, variant, ...rest }) => {
	const handleChange = (next) => {
		if (isNull(next) || Number.isNaN(next)) return;
		onChange?.(next);
	};
	const { slider: sliderClassName, input: inputClassName, ...sliderPartClassNames } = classNames || {};
	const { slider: sliderStyle, input: inputStyle, ...sliderPartStyles } = customStyles || {};
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className,
		gap,
		style,
		children: [/* @__PURE__ */ jsx(Slider, {
			className: sliderClassName,
			classNames: sliderPartClassNames,
			defaultValue,
			disabled,
			max,
			min,
			step,
			style: {
				flex: 1,
				...sliderStyle
			},
			styles: sliderPartStyles,
			value,
			onChange: handleChange,
			...rest
		}), /* @__PURE__ */ jsx(InputNumber, {
			changeOnWheel,
			className: inputClassName,
			controls: size !== "small" && controls !== false,
			defaultValue,
			disabled,
			max: unlimitedInput ? void 0 : max,
			min,
			shadow,
			size,
			step: step === void 0 || Number.isNaN(step) ? void 0 : step,
			value,
			variant,
			style: {
				flex: "none",
				width: size === "small" ? 48 : 88,
				...inputStyle
			},
			onChange: handleChange
		})]
	});
});
SliderWithInput.displayName = "SliderWithInput";
//#endregion
export { SliderWithInput as default };

//# sourceMappingURL=SliderWithInput.mjs.map