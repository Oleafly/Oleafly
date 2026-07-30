"use client";
import { rootVariants, styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { Input } from "@base-ui/react/input";
//#region src/base-ui/Input/Input.tsx
const Input$1 = memo(({ ref, className, classNames, styles: customStyles, style, variant, shadow, size = "middle", prefix, suffix, disabled, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsxs("div", {
		className: cx(rootVariants({
			shadow,
			size,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		"data-disabled": disabled ? "" : void 0,
		style,
		children: [
			prefix && /* @__PURE__ */ jsx("span", {
				className: cx(styles.slot, classNames?.prefix),
				style: customStyles?.prefix,
				children: prefix
			}),
			/* @__PURE__ */ jsx(Input, {
				className: cx(styles.input, classNames?.input),
				disabled,
				ref,
				style: customStyles?.input,
				...rest
			}),
			suffix && /* @__PURE__ */ jsx("span", {
				className: cx(styles.slot, classNames?.suffix),
				style: customStyles?.suffix,
				children: suffix
			})
		]
	});
});
Input$1.displayName = "Input";
//#endregion
export { Input$1 as default };

//# sourceMappingURL=Input.mjs.map