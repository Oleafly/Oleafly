"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import Input from "../Input/Input.mjs";
import { memo, useEffect, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { RotateCcw, Save } from "lucide-react";
//#region src/EditableText/ControlInput.tsx
const ControlInput = memo(({ value, onChange, onValueChanging, onChangeEnd, onCompositionEnd, onCompositionStart, onPressEnter, onFocus, submitIcon, style, texts, ...rest }) => {
	const ref = useRef(null);
	const [input, setInput] = useState(value || "");
	const isChineseInput = useRef(false);
	useEffect(() => {
		if (value !== void 0) setInput(value);
	}, [value]);
	const handleUpload = () => {
		onChange?.(input);
		ref?.current?.blur();
		onChangeEnd?.(input);
	};
	return /* @__PURE__ */ jsx(Input, {
		autoFocus: true,
		ref,
		value: input,
		style: {
			width: "100%",
			...style
		},
		suffix: value === input ? /* @__PURE__ */ jsx("span", {}) : /* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			gap: 2,
			style: {
				marginRight: -4,
				zIndex: 1
			},
			children: [/* @__PURE__ */ jsx(ActionIcon, {
				icon: RotateCcw,
				size: "small",
				title: texts?.reset || "Reset",
				onClick: (e) => {
					e.preventDefault();
					setInput(value || "");
				}
			}), /* @__PURE__ */ jsx(ActionIcon, {
				icon: submitIcon || Save,
				size: "small",
				title: texts?.submit || "Submit",
				variant: "filled",
				onClick: (e) => {
					e.preventDefault();
					handleUpload();
				}
			})]
		}),
		onFocus,
		onChange: (e) => {
			setInput(e.target.value);
			onValueChanging?.(e.target.value);
		},
		onCompositionEnd: (e) => {
			isChineseInput.current = false;
			onCompositionEnd?.(e);
		},
		onCompositionStart: (e) => {
			isChineseInput.current = true;
			onCompositionStart?.(e);
		},
		onPressEnter: (e) => {
			if (!e.shiftKey && !isChineseInput.current) {
				e.preventDefault();
				handleUpload();
				onPressEnter?.(e);
			}
		},
		...rest
	});
});
ControlInput.displayName = "ControlInput";
//#endregion
export { ControlInput as default };

//# sourceMappingURL=ControlInput.mjs.map