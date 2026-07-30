"use client";
import Icon from "../../Icon/Icon.mjs";
import { rootVariants, styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NumberField } from "@base-ui/react/number-field";
//#region src/base-ui/Input/InputNumber.tsx
const InputNumber = memo(({ ref, className, classNames, styles: customStyles, style, variant, shadow, size = "middle", controls = true, changeOnWheel, onChange, placeholder, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const mergedVariant = variant || (isDarkMode ? "filled" : "outlined");
	return /* @__PURE__ */ jsxs(NumberField.Root, {
		allowWheelScrub: changeOnWheel,
		className: cx(rootVariants({
			shadow,
			size,
			variant: mergedVariant
		}), className),
		style,
		onValueChange: onChange,
		...rest,
		children: [/* @__PURE__ */ jsx(NumberField.Input, {
			className: cx(styles.input, styles.numberInput, classNames?.input),
			placeholder,
			ref,
			style: customStyles?.input
		}), controls && /* @__PURE__ */ jsxs("div", {
			className: styles.numberControls,
			children: [/* @__PURE__ */ jsx(NumberField.Increment, {
				className: styles.numberControl,
				children: /* @__PURE__ */ jsx(Icon, {
					icon: ChevronUp,
					size: 12
				})
			}), /* @__PURE__ */ jsx(NumberField.Decrement, {
				className: styles.numberControl,
				children: /* @__PURE__ */ jsx(Icon, {
					icon: ChevronDown,
					size: 12
				})
			})]
		})]
	});
});
InputNumber.displayName = "InputNumber";
//#endregion
export { InputNumber as default };

//# sourceMappingURL=InputNumber.mjs.map