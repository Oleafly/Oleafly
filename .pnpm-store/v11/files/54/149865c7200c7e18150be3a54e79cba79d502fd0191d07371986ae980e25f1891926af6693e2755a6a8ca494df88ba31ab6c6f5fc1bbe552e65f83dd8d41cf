"use client";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Input } from "antd";
import { cx, useThemeMode } from "antd-style";
//#region src/Input/InputPassword.tsx
const InputPassword = memo(({ ref, variant, shadow, className, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(Input.Password, {
		ref,
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variants({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		...rest
	});
});
InputPassword.displayName = "InputPassword";
//#endregion
export { InputPassword as default };

//# sourceMappingURL=InputPassword.mjs.map