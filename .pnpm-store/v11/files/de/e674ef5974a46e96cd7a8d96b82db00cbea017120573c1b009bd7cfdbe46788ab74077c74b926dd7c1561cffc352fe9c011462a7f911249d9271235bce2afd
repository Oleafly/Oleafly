"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { KeyMapEnum } from "../../Hotkey/const.mjs";
import { combineKeys } from "../../Hotkey/utils.mjs";
import { Tooltip } from "../../base-ui/Tooltip/Tooltip.mjs";
import Button from "../../Button/Button.mjs";
import CodeEditor from "../../CodeEditor/CodeEditor.mjs";
import TextArea from "../../Input/TextArea.mjs";
import { styles } from "./style.mjs";
import { memo, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
import { useHotkeys } from "react-hotkeys-hook";
//#region src/chat/MessageInput/MessageInput.tsx
const MessageInput = memo(({ text, variant = "borderless", onCancel, defaultValue, onConfirm, renderButtons, placeholder, styles: customStyles, style, editButtonSize = "middle", classNames, shortcut, language = "markdown", ...rest }) => {
	const { mobile } = useResponsive();
	const [temporaryValue, setValue] = useState(defaultValue || "");
	const confirmHotkey = combineKeys([KeyMapEnum.Mod, KeyMapEnum.Enter]);
	const confirmText = text?.confirm || "Confirm";
	const cancelHotkey = combineKeys([KeyMapEnum.Esc]);
	const cancelText = text?.cancel || "Cancel";
	const handleConfirm = () => onConfirm?.(temporaryValue);
	const handleCancel = () => onCancel?.();
	useHotkeys(confirmHotkey, handleConfirm, {
		enableOnFormTags: true,
		enabled: shortcut,
		preventDefault: true
	});
	const confirmButton = /* @__PURE__ */ jsx(Button, {
		size: editButtonSize,
		type: "primary",
		onClick: handleConfirm,
		children: confirmText
	});
	const cancllButton = /* @__PURE__ */ jsx(Button, {
		size: editButtonSize,
		variant: "filled",
		onClick: handleCancel,
		children: text?.cancel || "Cancel"
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		gap: 16,
		style: {
			flex: 1,
			width: "100%",
			...style
		},
		...rest,
		children: [mobile ? /* @__PURE__ */ jsx(TextArea, {
			autoSize: true,
			className: cx(styles, classNames?.editor),
			placeholder,
			style: customStyles?.editor,
			value: temporaryValue,
			variant,
			onBlur: (e) => setValue(e.target.value),
			onChange: (e) => setValue(e.target.value)
		}) : /* @__PURE__ */ jsx(CodeEditor, {
			className: cx(styles, classNames?.editor),
			classNames,
			language,
			placeholder,
			style: customStyles?.editor,
			styles: customStyles,
			value: temporaryValue,
			variant,
			onBlur: (e) => setValue(e.target.value),
			onValueChange: (e) => setValue(e)
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			direction: "horizontal-reverse",
			gap: 8,
			children: renderButtons ? renderButtons(temporaryValue).map((buttonProps, index) => /* @__PURE__ */ jsx(Button, {
				size: editButtonSize,
				...buttonProps
			}, index)) : /* @__PURE__ */ jsxs(Fragment$1, { children: [shortcut ? /* @__PURE__ */ jsx(Tooltip, {
				hotkey: confirmHotkey,
				title: confirmText,
				children: confirmButton
			}) : confirmButton, shortcut ? /* @__PURE__ */ jsx(Tooltip, {
				hotkey: cancelHotkey,
				title: cancelText,
				children: cancllButton
			}) : cancllButton] })
		})]
	});
});
//#endregion
export { MessageInput as default };

//# sourceMappingURL=MessageInput.mjs.map