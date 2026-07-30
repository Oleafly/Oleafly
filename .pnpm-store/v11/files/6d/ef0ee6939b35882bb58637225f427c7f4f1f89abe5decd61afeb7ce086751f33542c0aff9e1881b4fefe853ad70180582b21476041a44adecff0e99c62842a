import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import Icon from "../../../Icon/Icon.mjs";
import Button from "../../../Button/Button.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cssVar } from "antd-style";
import { ArrowBigUp, CornerDownLeft, Loader2 } from "lucide-react";
//#region src/chat/ChatInputArea/components/ChatSendButton.tsx
const ChatSendButton = ({ ref, leftAddons, rightAddons, texts, onSend, loading, onStop, ...rest }) => {
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "end",
		distribution: "space-between",
		flex: "none",
		gap: 8,
		paddingInline: 16,
		ref,
		...rest,
		children: [/* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			gap: 8,
			children: leftAddons
		}), /* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			gap: 8,
			children: [
				/* @__PURE__ */ jsxs(FlexBasic_default, {
					horizontal: true,
					gap: 4,
					style: {
						color: cssVar.colorTextDescription,
						fontSize: 12,
						marginRight: 12
					},
					children: [
						/* @__PURE__ */ jsx(Icon, { icon: CornerDownLeft }),
						/* @__PURE__ */ jsx("span", { children: texts?.send || "Send" }),
						/* @__PURE__ */ jsx("span", { children: "/" }),
						/* @__PURE__ */ jsxs(FlexBasic_default, {
							horizontal: true,
							children: [/* @__PURE__ */ jsx(Icon, { icon: ArrowBigUp }), /* @__PURE__ */ jsx(Icon, { icon: CornerDownLeft })]
						}),
						/* @__PURE__ */ jsx("span", { children: texts?.warp || "Warp" })
					]
				}),
				rightAddons,
				loading ? /* @__PURE__ */ jsx(Button, {
					icon: loading && Loader2,
					onClick: onStop,
					children: texts?.stop || "Stop"
				}) : /* @__PURE__ */ jsx(Button, {
					type: "primary",
					onClick: onSend,
					children: texts?.send || "Send"
				})
			]
		})]
	});
};
ChatSendButton.displayName = "ChatSendButton";
//#endregion
export { ChatSendButton as default };

//# sourceMappingURL=ChatSendButton.mjs.map