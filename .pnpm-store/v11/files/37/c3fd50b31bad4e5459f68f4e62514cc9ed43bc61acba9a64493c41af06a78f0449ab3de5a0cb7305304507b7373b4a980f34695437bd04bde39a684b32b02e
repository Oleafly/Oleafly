"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { variants } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/MaskShadow/MaskShadow.tsx
const MaskShadow = memo(({ className, children, position = "bottom", size = 40, ...rest }) => {
	const cssVariables = useMemo(() => ({ "--mask-shadow-size": `${size}%` }), [size]);
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		className: cx(variants({ position }), className),
		style: {
			...cssVariables,
			...rest.style
		},
		...rest,
		children
	});
});
MaskShadow.displayName = "MaskShadow";
//#endregion
export { MaskShadow as default };

//# sourceMappingURL=MaskShadow.mjs.map