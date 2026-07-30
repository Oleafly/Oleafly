"use client";
import { variants } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Input } from "antd";
import { cx, useThemeMode } from "antd-style";
//#region src/Input/TextArea.tsx
const TextArea = memo(({ ref, variant, shadow, className, resize = false, style, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(Input.TextArea, {
		ref,
		variant: variant || (isDarkMode ? "filled" : "outlined"),
		className: cx(variants({
			shadow,
			variant: variant || (isDarkMode ? "filled" : "outlined")
		}), className),
		style: {
			resize: resize ? void 0 : "none",
			...style
		},
		...rest
	});
});
TextArea.displayName = "TextArea";
//#endregion
export { TextArea as default };

//# sourceMappingURL=TextArea.mjs.map