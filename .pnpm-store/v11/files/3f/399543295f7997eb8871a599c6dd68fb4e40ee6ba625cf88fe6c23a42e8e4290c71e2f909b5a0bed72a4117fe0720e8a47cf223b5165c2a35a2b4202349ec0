"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
//#region src/awesome/SpotlightCard/SpotlightCardItem.tsx
const SpotlightCardItem = memo(({ children, className, style, borderRadius, size, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const cssVariables = useMemo(() => ({
		"--spotlight-card-border-radius": `${borderRadius}px`,
		"--spotlight-card-size": `${size}px`
	}), [borderRadius, size]);
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		className: cx(isDarkMode ? styles.itemContainerDark : styles.itemContainerLight, className),
		style: {
			...cssVariables,
			borderRadius,
			...style
		},
		...rest,
		children: /* @__PURE__ */ jsx(FlexBasic_default, {
			className: styles.content,
			children
		})
	});
});
SpotlightCardItem.displayName = "SpotlightCardItem";
//#endregion
export { SpotlightCardItem as default };

//# sourceMappingURL=SpotlightCardItem.mjs.map