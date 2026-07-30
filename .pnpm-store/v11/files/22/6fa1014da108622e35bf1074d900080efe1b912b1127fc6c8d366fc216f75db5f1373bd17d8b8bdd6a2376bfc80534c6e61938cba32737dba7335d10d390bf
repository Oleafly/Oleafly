"use client";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Input } from "antd";
import { cx, useThemeMode } from "antd-style";
//#region src/Input/Input.tsx
const Input$1 = memo(({ ref, variant, shadow, className, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(Input, {
		ref,
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variants({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		...rest
	});
});
Input$1.displayName = "Input";
//#endregion
export { Input$1 as default };

//# sourceMappingURL=Input.mjs.map