"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import ControlInput from "./ControlInput.mjs";
import { memo, useMemo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
import { Edit3 } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
//#region src/EditableText/EditableText.tsx
const EditableText = memo(({ value, showEditIcon = true, onChange, editing, onEditingChange, onChangeEnd, onFocus, onBlur, className, inputProps, onValueChanging, gap = 8, style, size = "small", styles, classNames, variant = "borderless", ...rest }) => {
	const [edited, setEdited] = useMergeState(false, {
		onChange: onEditingChange,
		value: editing
	});
	useHotkeys("esc", () => {
		setEdited(false);
	}, {
		enableOnFormTags: true,
		enabled: edited,
		preventDefault: true
	});
	const height = useMemo(() => {
		if (!size) return 32;
		switch (size) {
			case "large": return 40;
			case "middle": return 32;
			case "small": return 24;
		}
	}, [size]);
	const input = /* @__PURE__ */ jsx(ControlInput, {
		className: cx(className, classNames?.input),
		size,
		value,
		variant,
		style: {
			height,
			...style,
			...styles?.input
		},
		onBlur,
		onChange,
		onFocus,
		onValueChanging,
		onChangeEnd: (v) => {
			onChangeEnd?.(v);
			setEdited(false);
		},
		...inputProps
	});
	const content = /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx("span", { children: value }), showEditIcon && /* @__PURE__ */ jsx(ActionIcon, {
		icon: Edit3,
		size: "small",
		title: "Edit",
		onClick: () => {
			setEdited(!edited);
		}
	})] });
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: cx(className, classNames?.container),
		gap,
		style: {
			height,
			width: "100%",
			...style,
			...styles?.container
		},
		...rest,
		children: edited ? input : content
	});
});
EditableText.displayName = "EditableText";
//#endregion
export { EditableText as default };

//# sourceMappingURL=EditableText.mjs.map