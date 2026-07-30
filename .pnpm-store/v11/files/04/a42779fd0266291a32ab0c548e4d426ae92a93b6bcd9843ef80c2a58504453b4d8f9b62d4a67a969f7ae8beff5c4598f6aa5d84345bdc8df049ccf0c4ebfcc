"use client";
import { rootVariants, styles } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { Field } from "@base-ui/react/field";
//#region src/base-ui/Input/TextArea.tsx
const TextArea = memo(({ ref, className, classNames, styles: customStyles, style, variant, shadow, autoSize, resize = false, disabled, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const mergedVariant = variant || (isDarkMode ? "filled" : "outlined");
	const cssVariables = useMemo(() => {
		if (typeof autoSize !== "object") return {};
		return {
			"--textarea-max-height": autoSize.maxRows ? `calc(1.5em * ${autoSize.maxRows})` : void 0,
			"--textarea-min-rows": autoSize.minRows
		};
	}, [autoSize]);
	return /* @__PURE__ */ jsx("div", {
		"data-disabled": disabled ? "" : void 0,
		style: {
			...cssVariables,
			...style
		},
		className: cx(rootVariants({
			shadow,
			variant: mergedVariant
		}), styles.textarea, autoSize && styles.textareaAutoSize, resize && styles.textareaResize, className),
		children: /* @__PURE__ */ jsx(Field.Control, {
			className: cx(styles.input, classNames?.input),
			disabled,
			render: /* @__PURE__ */ jsx("textarea", {
				ref,
				...rest
			}),
			style: customStyles?.input
		})
	});
});
TextArea.displayName = "TextArea";
//#endregion
export { TextArea as default };

//# sourceMappingURL=TextArea.mjs.map