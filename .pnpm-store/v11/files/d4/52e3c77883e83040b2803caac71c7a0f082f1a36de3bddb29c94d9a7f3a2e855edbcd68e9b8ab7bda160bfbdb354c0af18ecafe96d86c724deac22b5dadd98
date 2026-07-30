"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import Button from "../../Button/Button.mjs";
import { useTranslation } from "../../i18n/useTranslation.mjs";
import ControlInput from "../../EditableText/ControlInput.mjs";
import Select from "../../Select/Select.mjs";
import editableMessage_default from "../../i18n/resources/en/editableMessage.mjs";
import { messagesReducer } from "./messageReducer.mjs";
import { memo, useEffect, useReducer } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Plus, Trash } from "lucide-react";
import isEqual from "fast-deep-equal";
//#region src/chat/EditableMessageList/EditableMessageList.tsx
const EditableMessageList = memo(({ disabled, dataSources, onChange, texts }) => {
	const [chatMessages, dispatch] = useReducer(messagesReducer, dataSources);
	const { t } = useTranslation(editableMessage_default);
	const addPropsText = texts?.addProps ?? t("editableMessage.addProps");
	const deleteText = texts?.delete ?? t("editableMessage.delete");
	const inputPlaceholderText = texts?.inputPlaceholder ?? t("editableMessage.inputPlaceholder");
	const outputPlaceholderText = texts?.outputPlaceholder ?? t("editableMessage.outputPlaceholder");
	const systemText = texts?.system ?? t("editableMessage.system");
	const inputText = texts?.input ?? t("editableMessage.input");
	const outputText = texts?.output ?? t("editableMessage.output");
	useEffect(() => {
		if (!isEqual(dataSources, chatMessages)) onChange?.(chatMessages);
	}, [chatMessages]);
	return dataSources ? /* @__PURE__ */ jsxs(FlexBasic_default, {
		gap: 12,
		children: [chatMessages.map((item, index) => /* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			gap: 8,
			width: "100%",
			children: [
				/* @__PURE__ */ jsx(Select, {
					disabled,
					style: { width: 120 },
					styles: { popup: { root: { zIndex: 100 } } },
					value: item.role,
					options: [
						{
							label: systemText,
							value: "system"
						},
						{
							label: inputText,
							value: "user"
						},
						{
							label: outputText,
							value: "assistant"
						}
					],
					onChange: (value) => {
						dispatch({
							index,
							role: value,
							type: "updateMessageRole"
						});
					}
				}),
				/* @__PURE__ */ jsx(ControlInput, {
					disabled,
					placeholder: item.role === "user" ? inputPlaceholderText : outputPlaceholderText,
					value: item.content,
					onChange: (e) => {
						dispatch({
							index,
							message: e,
							type: "updateMessage"
						});
					}
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					icon: Trash,
					title: deleteText,
					variant: "filled",
					onClick: () => {
						dispatch({
							index,
							type: "deleteMessage"
						});
					}
				})
			]
		}, `${index}-${item.content}`)), /* @__PURE__ */ jsx(Button, {
			block: true,
			disabled,
			icon: Plus,
			onClick: () => {
				const lastMeg = chatMessages.at(-1);
				dispatch({
					message: {
						content: "",
						role: lastMeg?.role === "user" ? "assistant" : "user"
					},
					type: "addMessage"
				});
			},
			children: addPropsText
		})]
	}) : void 0;
}, isEqual);
EditableMessageList.displayName = "EditableMessageList";
//#endregion
export { EditableMessageList as default };

//# sourceMappingURL=EditableMessageList.mjs.map