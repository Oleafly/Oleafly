"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { variants } from "./style.mjs";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Block/Block.tsx
const Block = ({ className, variant = "filled", shadow, glass, children, clickable, ref, ...rest }) => {
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		className: cx(variants({
			clickable,
			glass,
			shadow,
			variant
		}), className),
		ref,
		...rest,
		children
	});
};
Block.displayName = "Block";
//#endregion
export { Block as default };

//# sourceMappingURL=Block.mjs.map