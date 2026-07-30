"use client";
import { variantsOPT } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Input } from "antd";
import { cx, useThemeMode } from "antd-style";
//#region src/Input/InputOPT.tsx
const InputOPT = memo(({ ref, variant, shadow, className, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(Input.OTP, {
		ref,
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variantsOPT({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		...rest
	});
});
InputOPT.displayName = "InputOPT";
//#endregion
export { InputOPT as default };

//# sourceMappingURL=InputOPT.mjs.map