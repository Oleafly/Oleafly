"use client";
import { useMemo } from "react";
import { Copy, Edit, RotateCw, Trash } from "lucide-react";
//#region src/chat/ChatList/components/useChatListActionsBar.tsx
const useChatListActionsBar = (text) => {
	return useMemo(() => ({
		copy: {
			icon: Copy,
			key: "copy",
			label: text?.copy || "Copy"
		},
		del: {
			icon: Trash,
			key: "del",
			label: text?.delete || "Delete"
		},
		divider: { type: "divider" },
		edit: {
			icon: Edit,
			key: "edit",
			label: text?.edit || "Edit"
		},
		regenerate: {
			icon: RotateCw,
			key: "regenerate",
			label: text?.regenerate || "Regenerate"
		}
	}), [text]);
};
//#endregion
export { useChatListActionsBar };

//# sourceMappingURL=useChatListActionsBar.mjs.map