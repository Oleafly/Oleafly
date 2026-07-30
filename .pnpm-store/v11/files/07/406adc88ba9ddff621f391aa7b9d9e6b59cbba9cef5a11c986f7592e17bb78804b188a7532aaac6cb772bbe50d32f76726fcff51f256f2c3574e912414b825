"use client";
import Markdown from "../../Markdown/Markdown.mjs";
import MessageInput from "../MessageInput/MessageInput.mjs";
import MessageModal from "../MessageModal/MessageModal.mjs";
import { memo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
//#region src/chat/EditableMessage/EditableMessage.tsx
const EditableMessage = memo(({ value, onChange, classNames = {}, onEditingChange, editing, openModal, onOpenChange, placeholder, showEditWhenEmpty = false, styles: customStyles, className, style, height, variant, editButtonSize, text, fullFeaturedCodeBlock, model, fontSize, language = "markdown", markdownProps }) => {
	const [isEdit, setTyping] = useMergeState(false, {
		onChange: onEditingChange,
		value: editing
	});
	const [expand, setExpand] = useMergeState(false, {
		onChange: onOpenChange,
		value: openModal
	});
	const isAutoSize = height === "auto";
	const input = /* @__PURE__ */ jsx(MessageInput, {
		shortcut: true,
		className: cx(className, classNames?.input),
		classNames,
		defaultValue: value,
		editButtonSize,
		height,
		language,
		placeholder,
		styles: customStyles,
		text,
		variant,
		style: {
			...style,
			...customStyles?.input
		},
		onCancel: () => setTyping(false),
		onConfirm: (text) => {
			onChange?.(text);
			setTyping(false);
		}
	});
	if (!value && showEditWhenEmpty) return input;
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [!expand && isEdit ? input : /* @__PURE__ */ jsx(Markdown, {
		className: cx(className, classNames?.markdown),
		fontSize,
		fullFeaturedCodeBlock,
		variant: "chat",
		style: {
			height: isAutoSize ? "unset" : height,
			...style,
			...customStyles?.markdown
		},
		...markdownProps,
		children: value || placeholder || ""
	}), expand && /* @__PURE__ */ jsx(MessageModal, {
		editing: isEdit,
		extra: model?.extra,
		footer: model?.footer,
		height,
		language,
		open: expand,
		placeholder,
		text,
		value,
		onChange,
		onEditingChange: setTyping,
		onOpenChange: (e) => {
			setExpand(e);
			setTyping(false);
		}
	})] });
});
EditableMessage.displayName = "EditableMessage";
//#endregion
export { EditableMessage as default };

//# sourceMappingURL=EditableMessage.mjs.map