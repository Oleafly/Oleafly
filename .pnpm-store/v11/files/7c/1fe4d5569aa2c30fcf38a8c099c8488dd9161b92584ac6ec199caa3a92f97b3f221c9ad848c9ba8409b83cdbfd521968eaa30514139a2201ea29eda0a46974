"use client";
import ChatListItem from "./components/ChatListItem.mjs";
import HistoryDivider from "./components/HistoryDivider.mjs";
import { styles } from "./style.mjs";
import { Fragment, memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/chat/ChatList/ChatList.tsx
const ChatList = memo(({ onActionsClick, onAvatarsClick, renderMessagesExtra, className, data, variant = "bubble", text, showTitle, onMessageChange, renderMessages, renderErrorMessages, loadingId, renderItems, enableHistoryCount, renderActions, historyCount = 0, showAvatar, ...rest }) => {
	return /* @__PURE__ */ jsx("div", {
		className: cx(styles.container, className),
		...rest,
		children: data.map((item, index) => {
			const itemProps = {
				loading: loadingId === item.id,
				onActionsClick,
				onAvatarsClick,
				onMessageChange,
				renderActions,
				renderErrorMessages,
				renderItems,
				renderMessages,
				renderMessagesExtra,
				showAvatar,
				showTitle,
				text,
				variant
			};
			const historyLength = data.length;
			return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(HistoryDivider, {
				enable: enableHistoryCount && historyLength > historyCount && historyCount === historyLength - index + 1,
				text: text?.history
			}), /* @__PURE__ */ jsx(ChatListItem, {
				...itemProps,
				...item
			})] }, item.id);
		})
	});
});
//#endregion
export { ChatList as default };

//# sourceMappingURL=ChatList.mjs.map