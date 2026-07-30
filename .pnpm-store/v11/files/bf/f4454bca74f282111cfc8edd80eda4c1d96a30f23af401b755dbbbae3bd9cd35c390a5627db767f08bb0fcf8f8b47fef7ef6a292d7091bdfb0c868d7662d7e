import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Block from "../Block/Block.mjs";
import Text from "../Text/Text.mjs";
import { styles } from "./style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
import { CheckIcon, Minus } from "lucide-react";
//#region src/Checkbox/Checkbox.tsx
const Checkbox = ({ checked, defaultChecked, onChange, size = 16, className, style, children, textProps, backgroundColor, classNames, styles: customStyles, shape = "square", disabled, indeterminate, ...rest }) => {
	const [value, setValue] = useMergeState(defaultChecked || false, {
		defaultValue: defaultChecked,
		onChange,
		value: checked
	});
	const checkboxStyles = {
		borderRadius: shape === "square" ? `max(4px, ${Math.round(size / 4)}px)` : "50%",
		...style,
		...customStyles?.checkbox
	};
	const handleClick = (e) => {
		if (!disabled) {
			e?.preventDefault();
			setValue(!value);
		}
	};
	const isIndeterminate = indeterminate;
	const isChecked = !isIndeterminate && value;
	const checkIcon = /* @__PURE__ */ jsx(Block, {
		align: "center",
		flex: "none",
		height: size,
		justify: "center",
		variant: "outlined",
		width: size,
		className: cx(styles.root, isChecked && styles.checked, isIndeterminate && styles.indeterminate, disabled && styles.disabled, className, classNames?.checkbox),
		style: backgroundColor && (isChecked || isIndeterminate) ? {
			backgroundColor,
			borderColor: backgroundColor,
			...checkboxStyles
		} : { ...checkboxStyles },
		onClick: handleClick,
		...rest,
		children: isIndeterminate ? /* @__PURE__ */ jsx(Minus, {
			size,
			strokeWidth: 3,
			style: { transform: `scale(${shape === "square" ? .75 : .66})` }
		}) : isChecked ? /* @__PURE__ */ jsx(CheckIcon, {
			size,
			strokeWidth: 3,
			style: { transform: `scale(${shape === "square" ? .75 : .66})` }
		}) : null
	});
	if (!children) return checkIcon;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: classNames?.wrapper,
		gap: Math.floor(size / 2),
		style: {
			cursor: disabled ? "not-allowed" : "pointer",
			userSelect: "none",
			...customStyles?.wrapper
		},
		onClick: handleClick,
		children: [checkIcon, /* @__PURE__ */ jsx(Text, {
			as: "span",
			className: cx(classNames?.text),
			style: customStyles?.text,
			...textProps,
			type: disabled ? "secondary" : textProps?.type,
			children
		})]
	});
};
Checkbox.displayName = "Checkbox";
//#endregion
export { Checkbox as default };

//# sourceMappingURL=Checkbox.mjs.map