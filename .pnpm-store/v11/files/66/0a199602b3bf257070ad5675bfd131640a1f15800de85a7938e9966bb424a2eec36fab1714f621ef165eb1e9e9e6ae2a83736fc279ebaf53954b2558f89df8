"use client";
import Icon from "../Icon/Icon.mjs";
import { variants } from "./style.mjs";
import { isValidElement } from "react";
import { jsx } from "react/jsx-runtime";
import { Button } from "antd";
import { cx, useThemeMode } from "antd-style";
import { Loader2Icon } from "lucide-react";
//#region src/Button/Button.tsx
/**
* @deprecated Use `Button` from `@lobehub/ui/base-ui` instead.
*/
const Button$1 = ({ icon, variant, glass, shadow, loading, className, type, color, danger, children, iconProps, ref, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const defaultVariant = type ? void 0 : variant || (isDarkMode ? "filled" : "outlined");
	return /* @__PURE__ */ jsx(Button, {
		color: color || (defaultVariant === "filled" ? "default" : void 0),
		danger,
		ref,
		type,
		variant: defaultVariant,
		className: cx(variants({
			glass,
			shadow
		}), className),
		icon: icon && (isValidElement(icon) ? icon : /* @__PURE__ */ jsx(Icon, {
			icon,
			...iconProps,
			size: iconProps?.size || { size: "1.2em" }
		})),
		loading: loading ? { icon: /* @__PURE__ */ jsx(Icon, {
			icon: Loader2Icon,
			...iconProps,
			spin: true,
			size: iconProps?.size || { size: "1.2em" }
		}) } : false,
		...rest,
		children
	});
};
//#endregion
export { Button$1 as default };

//# sourceMappingURL=Button.mjs.map