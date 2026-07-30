"use client";
import Button from "../../Button/Button.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx, useThemeMode } from "antd-style";
//#region src/awesome/GradientButton/GradientButton.tsx
const GradientButton = memo(({ glow = true, children, className, size, disabled, style, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const cssVariables = useMemo(() => {
		if (!size || disabled) return {};
		let borderRadius;
		switch (size) {
			case "large":
				borderRadius = cssVar.borderRadiusLG;
				break;
			case "small":
				borderRadius = cssVar.borderRadiusSM;
				break;
			default:
				borderRadius = cssVar.borderRadius;
				break;
		}
		return { "--gradient-button-border-radius": borderRadius };
	}, [size, disabled]);
	return /* @__PURE__ */ jsxs(Button, {
		disabled,
		size,
		variant: disabled ? void 0 : "text",
		className: cx(!disabled && (isDarkMode ? styles.buttonDark : styles.buttonLight), className),
		style: {
			...cssVariables,
			...style
		},
		...rest,
		children: [glow && /* @__PURE__ */ jsx("div", { className: styles.glow }), children]
	});
});
GradientButton.displayName = "GradientButton";
//#endregion
export { GradientButton as default };

//# sourceMappingURL=GradientButton.mjs.map