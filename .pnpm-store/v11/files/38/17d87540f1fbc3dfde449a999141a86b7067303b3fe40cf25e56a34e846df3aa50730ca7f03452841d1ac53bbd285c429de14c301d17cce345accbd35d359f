import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import { styles } from "../style.mjs";
import EditableMessage from "../../EditableMessage/EditableMessage.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
//#region src/chat/ChatItem/components/MessageContent.tsx
const MessageContent = memo(({ editing, onChange, onEditingChange, text, message, placement, messageExtra, renderMessage, variant, primary, onDoubleClick, fontSize, markdownProps }) => {
	const { mobile } = useResponsive();
	const messageClassName = useMemo(() => {
		if (variant === "bubble") return styles.messageBubble;
		return styles.messageDocsWithoutTitle;
	}, [variant]);
	const editingContainerClassName = useMemo(() => {
		return variant === "docs" ? styles.editingContainerDocs : styles.editingContainer;
	}, [variant]);
	const content = /* @__PURE__ */ jsx(EditableMessage, {
		fullFeaturedCodeBlock: true,
		classNames: { input: styles.editingInput },
		editButtonSize: "small",
		editing,
		fontSize,
		markdownProps,
		openModal: mobile ? editing : void 0,
		text,
		value: message ? String(message) : "",
		onChange,
		onEditingChange
	});
	const messageContent = renderMessage ? renderMessage(content) : content;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(messageClassName, editing && editingContainerClassName),
		onDoubleClick,
		children: [messageContent, messageExtra && !editing ? /* @__PURE__ */ jsx("div", {
			className: styles.messageExtra,
			children: messageExtra
		}) : null]
	});
});
//#endregion
export { MessageContent as default };

//# sourceMappingURL=MessageContent.mjs.map