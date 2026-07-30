"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Button from "../../Button/Button.mjs";
import CodeEditor from "../../CodeEditor/CodeEditor.mjs";
import { useTranslation } from "../../i18n/useTranslation.mjs";
import TextArea from "../../Input/TextArea.mjs";
import Modal from "../../Modal/Modal.mjs";
import Markdown from "../../Markdown/Markdown.mjs";
import { styles } from "../MessageInput/style.mjs";
import messageModal_default from "../../i18n/resources/en/messageModal.mjs";
import { memo, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { useResponsive } from "antd-style";
import useMergeState from "use-merge-value";
//#region src/chat/MessageModal/MessageModal.tsx
const MessageModal = memo(({ panelRef, editing, open, height = "75vh", onOpenChange, onEditingChange, placeholder, value, language = "markdown", onChange, text, footer, extra }) => {
	const { mobile } = useResponsive();
	const { t } = useTranslation(messageModal_default);
	const [isEdit, setTyping] = useMergeState(false, {
		onChange: onEditingChange,
		value: editing
	});
	const [showModal, setShowModal] = useMergeState(false, {
		onChange: onOpenChange,
		value: open
	});
	const [temporaryValue, setMessage] = useState(value);
	const confirmText = text?.confirm ?? t("messageModal.confirm");
	const cancelText = text?.cancel ?? t("messageModal.cancel");
	const editText = text?.edit ?? t("messageModal.edit");
	return /* @__PURE__ */ jsx(Modal, {
		allowFullscreen: true,
		destroyOnHidden: true,
		cancelText,
		footer: isEdit ? /* @__PURE__ */ jsxs(FlexBasic_default, {
			direction: "horizontal-reverse",
			gap: 8,
			children: [/* @__PURE__ */ jsx(Button, {
				type: "primary",
				onClick: () => {
					setTyping(false);
					onChange?.(temporaryValue);
					setMessage(value);
				},
				children: confirmText
			}), /* @__PURE__ */ jsx(Button, {
				onClick: () => {
					setTyping(false);
					setMessage(value);
				},
				children: cancelText
			})]
		}) : footer,
		height,
		okText: editText,
		open: showModal,
		panelRef,
		title: text?.title,
		onOk: () => setTyping(true),
		onCancel: () => {
			setShowModal(false);
			setTyping(false);
			setMessage(value);
		},
		children: isEdit ? mobile ? /* @__PURE__ */ jsx(TextArea, {
			autoSize: true,
			className: styles,
			defaultValue: temporaryValue,
			placeholder,
			value: temporaryValue,
			variant: "borderless",
			onBlur: (e) => setMessage(e.target.value),
			onChange: (value) => setMessage(value.target.value)
		}) : /* @__PURE__ */ jsx(CodeEditor, {
			className: styles,
			defaultValue: temporaryValue,
			language,
			placeholder,
			value: temporaryValue,
			variant: "borderless",
			onBlur: (e) => setMessage(e.target.value),
			onValueChange: (value) => setMessage(value)
		}) : /* @__PURE__ */ jsxs(Fragment$1, { children: [extra, /* @__PURE__ */ jsx(Markdown, {
			variant: "chat",
			children: String(value || placeholder)
		})] })
	});
});
MessageModal.displayName = "MessageModal";
//#endregion
export { MessageModal as default };

//# sourceMappingURL=MessageModal.mjs.map