"use client";
import Icon from "../Icon/Icon.mjs";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Select } from "antd";
import { cx, useThemeMode } from "antd-style";
import { ChevronDownIcon } from "lucide-react";
//#region src/Select/Select.tsx
/**
* @deprecated Use `Select` from `@lobehub/ui/base-ui` instead.
*/
const Select$1 = memo(({ ref, variant, suffixIconProps, suffixIcon, shadow, className, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(Select, {
		ref,
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variants({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		suffixIcon: /* @__PURE__ */ jsx(Icon, {
			icon: suffixIcon || ChevronDownIcon,
			size: "small",
			...suffixIconProps,
			style: {
				pointerEvents: "none",
				...suffixIconProps?.style
			}
		}),
		...rest
	});
});
Select$1.displayName = "Select";
//#endregion
export { Select$1 as default };

//# sourceMappingURL=Select.mjs.map