"use client";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { InputNumber } from "antd";
import { cx, useThemeMode } from "antd-style";
//#region src/Input/InputNumber.tsx
const InputNumber$1 = memo(({ ref, variant, shadow, className, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(InputNumber, {
		ref,
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variants({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		...rest
	});
});
InputNumber$1.displayName = "InputNumber";
//#endregion
export { InputNumber$1 as default };

//# sourceMappingURL=InputNumber.mjs.map