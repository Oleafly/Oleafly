"use client";
import Text from "../../Text/Text.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Radio } from "@base-ui/react/radio";
//#region src/base-ui/Radio/Radio.tsx
const Radio$1 = memo(({ size = 16, backgroundColor, children, className, classNames, styles: customStyles, style, textProps, disabled, ...rest }) => {
	const dotStyle = {
		height: size,
		width: size,
		...backgroundColor ? { "--lobe-radio-bg": backgroundColor } : {},
		...children ? {} : style,
		...customStyles?.radio
	};
	const dot = /* @__PURE__ */ jsx(Radio.Root, {
		className: cx(styles.root, children ? classNames?.radio : className, classNames?.radio),
		disabled,
		style: dotStyle,
		...rest,
		children: /* @__PURE__ */ jsx(Radio.Indicator, {
			className: styles.indicator,
			style: {
				height: Math.round(size * .375),
				width: Math.round(size * .375)
			}
		})
	});
	if (!children) return dot;
	return /* @__PURE__ */ jsxs("label", {
		className: cx(styles.label, className, classNames?.wrapper),
		style: {
			gap: Math.floor(size / 2),
			...style,
			...customStyles?.wrapper
		},
		children: [dot, /* @__PURE__ */ jsx(Text, {
			as: "span",
			className: classNames?.text,
			style: customStyles?.text,
			...textProps,
			type: disabled ? "secondary" : textProps?.type,
			children
		})]
	});
});
Radio$1.displayName = "Radio";
//#endregion
export { Radio$1 as default };

//# sourceMappingURL=Radio.mjs.map