import { copyToClipboard } from "../../../utils/copyToClipboard.mjs";
import ChatItem from "../../ChatItem/ChatItem.mjs";
import ChatActionsBar from "./ChatActionsBar.mjs";
import { memo, useCallback, useMemo, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { App } from "antd";
//#region src/chat/ChatList/components/ChatListItem.tsx
const ChatListItem = memo((props) => {
	const { renderMessagesExtra, showTitle, onActionsClick, onAvatarsClick, onMessageChange, variant, text, renderMessages, renderErrorMessages, renderActions, loading, groupNav, renderItems, showAvatar, ...item } = props;
	const [editing, setEditing] = useState(false);
	const { message } = App.useApp();
	const RenderItem = useMemo(() => {
		if (!renderItems || !item?.role) return;
		let renderFunction;
		if (renderItems?.[item.role]) renderFunction = renderItems[item.role];
		if (!renderFunction && renderItems?.["default"]) renderFunction = renderItems["default"];
		if (!renderFunction) return;
		return renderFunction;
	}, [renderItems?.[item.role]]);
	const RenderMessage = useCallback(({ editableContent, data }) => {
		if (!renderMessages || !item?.role) return;
		let RenderFunction;
		if (renderMessages?.[item.role]) RenderFunction = renderMessages[item.role];
		if (!RenderFunction && renderMessages?.["default"]) RenderFunction = renderMessages["default"];
		if (!RenderFunction) return;
		return /* @__PURE__ */ jsx(RenderFunction, {
			...data,
			editableContent
		});
	}, [renderMessages?.[item.role]]);
	const MessageExtra = useCallback(({ data }) => {
		if (!renderMessagesExtra || !item?.role) return;
		let RenderFunction;
		if (renderMessagesExtra?.[item.role]) RenderFunction = renderMessagesExtra[item.role];
		if (renderMessagesExtra?.["default"]) RenderFunction = renderMessagesExtra["default"];
		if (!RenderFunction) return;
		return /* @__PURE__ */ jsx(RenderFunction, { ...data });
	}, [renderMessagesExtra?.[item.role]]);
	const ErrorMessage = useCallback(({ data }) => {
		if (!renderErrorMessages || !item?.error?.type) return;
		let RenderFunction;
		if (renderErrorMessages?.[item.error.type]) RenderFunction = renderErrorMessages[item.error.type].Render;
		if (!RenderFunction && renderErrorMessages?.["default"]) RenderFunction = renderErrorMessages["default"].Render;
		if (!RenderFunction) return;
		return /* @__PURE__ */ jsx(RenderFunction, { ...data });
	}, [renderErrorMessages]);
	const Actions = useCallback(({ data }) => {
		if (!renderActions || !item?.role) return;
		let RenderFunction;
		if (renderActions?.[item.role]) RenderFunction = renderActions[item.role];
		if (renderActions?.["default"]) RenderFunction = renderActions["default"];
		if (!RenderFunction) RenderFunction = ChatActionsBar;
		const handleActionClick = async (action, data) => {
			switch (action.key) {
				case "copy":
					await copyToClipboard(data.content);
					message.success(text?.copySuccess || "Copy Success");
					break;
				case "edit": setEditing(true);
			}
			onActionsClick?.(action, data);
		};
		return /* @__PURE__ */ jsx(RenderFunction, {
			...data,
			text,
			onActionClick: (actionKey) => handleActionClick?.(actionKey, data)
		});
	}, [
		renderActions?.[item.role],
		text,
		onActionsClick
	]);
	const error = useMemo(() => {
		if (!item.error) return;
		const message = item.error?.message;
		let alertConfig = {};
		if (item.error.type && renderErrorMessages?.[item.error.type]) alertConfig = renderErrorMessages[item.error.type]?.config;
		return {
			message,
			...alertConfig
		};
	}, [renderErrorMessages, item.error]);
	if (RenderItem) return /* @__PURE__ */ jsx(RenderItem, { ...props }, item.id);
	return /* @__PURE__ */ jsx(ChatItem, {
		actions: /* @__PURE__ */ jsx(Actions, { data: item }),
		avatar: item.meta,
		avatarAddon: groupNav,
		editing,
		error,
		errorMessage: /* @__PURE__ */ jsx(ErrorMessage, { data: item }),
		loading,
		message: item.content,
		messageExtra: /* @__PURE__ */ jsx(MessageExtra, { data: item }),
		placement: variant === "bubble" ? item.role === "user" ? "right" : "left" : "left",
		primary: item.role === "user",
		showAvatar,
		showTitle,
		text,
		time: item.updateAt || item.createAt,
		variant,
		renderMessage: (editableContent) => /* @__PURE__ */ jsx(RenderMessage, {
			data: item,
			editableContent
		}),
		onAvatarClick: onAvatarsClick?.(item.role),
		onChange: (value) => onMessageChange?.(item.id, value),
		onEditingChange: setEditing,
		onDoubleClick: (e) => {
			if (item.id === "default" || item.error) return;
			if (item.role && ["assistant", "user"].includes(item.role) && e.altKey) setEditing(true);
		}
	});
});
ChatListItem.displayName = "ChatListItem";
//#endregion
export { ChatListItem as default };

//# sourceMappingURL=ChatListItem.mjs.map