"use client";
import Button from "../../../Button/Button.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { SendHorizontal } from "lucide-react";
//#region src/mobile/ChatInputArea/components/ChatSendButton.tsx
const ChatSendButton = memo(({ ref, loading, onStop, onSend, ...rest }) => {
	return /* @__PURE__ */ jsx(Button, {
		icon: SendHorizontal,
		loading,
		ref,
		type: "primary",
		onClick: (e) => {
			e.preventDefault();
			if (loading) onStop?.(e);
			else onSend?.(e);
		},
		...rest
	});
});
ChatSendButton.displayName = "ChatSendButton";
//#endregion
export { ChatSendButton as default };

//# sourceMappingURL=ChatSendButton.mjs.map