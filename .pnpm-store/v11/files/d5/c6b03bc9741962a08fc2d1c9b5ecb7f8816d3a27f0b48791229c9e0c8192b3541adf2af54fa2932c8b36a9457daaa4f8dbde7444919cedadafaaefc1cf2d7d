"use client";
import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import { actionBarStyles } from "../style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { useResponsive } from "antd-style";
//#region src/chat/ChatInputArea/components/ChatInputActionBar.tsx
const ChatInputActionBar = ({ ref, padding = "0 16px", leftAddons, rightAddons, ...rest }) => {
	const { mobile } = useResponsive();
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: actionBarStyles.root,
		flex: "none",
		justify: "space-between",
		padding,
		ref,
		...rest,
		children: [/* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: actionBarStyles.left,
			flex: 1,
			gap: mobile ? 0 : 4,
			children: leftAddons
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: actionBarStyles.right,
			flex: 0,
			gap: mobile ? 0 : 4,
			justify: "flex-end",
			children: rightAddons
		})]
	});
};
ChatInputActionBar.displayName = "ChatInputActionBar";
//#endregion
export { ChatInputActionBar as default };

//# sourceMappingURL=ChatInputActionBar.mjs.map