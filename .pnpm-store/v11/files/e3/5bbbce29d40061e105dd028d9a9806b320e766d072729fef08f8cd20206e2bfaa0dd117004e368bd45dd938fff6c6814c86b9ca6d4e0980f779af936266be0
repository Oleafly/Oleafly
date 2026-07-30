"use client";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { useCopied } from "../hooks/useCopied.mjs";
import { copyToClipboard } from "../utils/copyToClipboard.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Check, Copy } from "lucide-react";
//#region src/CopyButton/CopyButton.tsx
const CopyButton = memo(({ active, content, size, icon, glass = true, onClick, ...rest }) => {
	const { copied, setCopied } = useCopied();
	const Icon = icon || Copy;
	return /* @__PURE__ */ jsx(ActionIcon, {
		glass,
		size,
		title: "Copy",
		...rest,
		active: active || copied,
		icon: copied ? Check : Icon,
		onClick: async (e) => {
			await copyToClipboard(typeof content === "function" ? content() : content);
			setCopied();
			onClick?.(e);
		}
	});
});
CopyButton.displayName = "CopyButton";
//#endregion
export { CopyButton as default };

//# sourceMappingURL=CopyButton.mjs.map