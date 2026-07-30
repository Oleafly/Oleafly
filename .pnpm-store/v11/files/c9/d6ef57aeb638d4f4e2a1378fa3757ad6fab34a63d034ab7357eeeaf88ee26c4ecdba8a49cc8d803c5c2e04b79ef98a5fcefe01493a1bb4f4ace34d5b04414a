"use client";
import Text from "../../Text/Text.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { CheckIcon, Minus } from "lucide-react";
import { Checkbox } from "@base-ui/react/checkbox";
//#region src/base-ui/Checkbox/Checkbox.tsx
const Checkbox$1 = memo(({ size = 16, shape = "square", backgroundColor, children, className, classNames, styles: customStyles, style, textProps, onChange, disabled, indeterminate, ...rest }) => {
	const boxStyle = {
		borderRadius: shape === "square" ? `max(4px, ${Math.round(size / 4)}px)` : "50%",
		height: size,
		width: size,
		...backgroundColor ? { "--lobe-checkbox-bg": backgroundColor } : {},
		...children ? {} : style,
		...customStyles?.checkbox
	};
	const box = /* @__PURE__ */ jsx(Checkbox.Root, {
		disabled,
		indeterminate,
		style: boxStyle,
		className: cx(styles.root, children ? classNames?.checkbox : className, classNames?.checkbox),
		onCheckedChange: onChange,
		...rest,
		children: /* @__PURE__ */ jsx(Checkbox.Indicator, {
			className: styles.indicator,
			children: indeterminate ? /* @__PURE__ */ jsx(Minus, {
				size,
				strokeWidth: 3,
				style: { transform: `scale(${shape === "square" ? .75 : .66})` }
			}) : /* @__PURE__ */ jsx(CheckIcon, {
				size,
				strokeWidth: 3,
				style: { transform: `scale(${shape === "square" ? .75 : .66})` }
			})
		})
	});
	if (!children) return box;
	return /* @__PURE__ */ jsxs("label", {
		className: cx(styles.label, className, classNames?.wrapper),
		style: {
			gap: Math.floor(size / 2),
			...style,
			...customStyles?.wrapper
		},
		children: [box, /* @__PURE__ */ jsx(Text, {
			as: "span",
			className: classNames?.text,
			style: customStyles?.text,
			...textProps,
			type: disabled ? "secondary" : textProps?.type,
			children
		})]
	});
});
Checkbox$1.displayName = "Checkbox";
//#endregion
export { Checkbox$1 as default };

//# sourceMappingURL=Checkbox.mjs.map