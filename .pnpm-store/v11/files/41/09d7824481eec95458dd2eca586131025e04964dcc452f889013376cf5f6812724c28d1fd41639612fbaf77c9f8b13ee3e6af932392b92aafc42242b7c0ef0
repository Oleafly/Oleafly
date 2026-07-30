"use client";
import Button from "../../Button/Button.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/awesome/BottomGradientButton/BottomGradientButton.tsx
const BottomGradientButton = memo(({ className, children, style, ref, ...rest }) => {
	return /* @__PURE__ */ jsx(Button, {
		className: cx(styles, className),
		ref,
		shape: "round",
		variant: "filled",
		style: {
			paddingInline: 16,
			width: "unset",
			...style
		},
		...rest,
		children
	});
});
BottomGradientButton.displayName = "BottomGradientButton";
//#endregion
export { BottomGradientButton as default };

//# sourceMappingURL=BottomGradientButton.mjs.map