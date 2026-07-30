"use client";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { DatePicker } from "antd";
import { cx, useThemeMode } from "antd-style";
//#region src/DatePicker/DatePicker.tsx
const DatePicker$1 = memo(({ variant, shadow, className, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(DatePicker, {
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variants({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		...rest
	});
});
DatePicker$1.displayName = "DatePicker";
//#endregion
export { DatePicker$1 as default };

//# sourceMappingURL=DatePicker.mjs.map