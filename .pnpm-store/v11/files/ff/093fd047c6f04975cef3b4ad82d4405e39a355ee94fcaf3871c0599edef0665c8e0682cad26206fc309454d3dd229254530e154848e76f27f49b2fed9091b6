"use client";
import { rootVariants, styles } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { OTPField } from "@base-ui/react/otp-field";
//#region src/base-ui/Input/InputOTP.tsx
const InputOTP = memo(({ className, classNames, styles: customStyles, style, variant, shadow, size = "middle", length = 6, onChange, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const mergedVariant = variant || (isDarkMode ? "filled" : "outlined");
	return /* @__PURE__ */ jsx(OTPField.Root, {
		className: cx(styles.otpRoot, className),
		length,
		style,
		onValueChange: onChange,
		...rest,
		children: Array.from({ length }, (_, index) => /* @__PURE__ */ jsx(OTPField.Input, {
			style: customStyles?.input,
			className: cx(rootVariants({
				shadow,
				size,
				variant: mergedVariant
			}), styles.otpCell, classNames?.input)
		}, index))
	});
});
InputOTP.displayName = "InputOTP";
//#endregion
export { InputOTP as default };

//# sourceMappingURL=InputOTP.mjs.map