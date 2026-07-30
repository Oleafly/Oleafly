"use client";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { AutoComplete } from "antd";
import { cx, useThemeMode } from "antd-style";
//#region src/AutoComplete/Select.tsx
const AutoComplete$1 = memo(({ variant, shadow, className, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(AutoComplete, {
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variants({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		...rest
	});
});
AutoComplete$1.displayName = "AutoComplete";
//#endregion
export { AutoComplete$1 as default };

//# sourceMappingURL=Select.mjs.map