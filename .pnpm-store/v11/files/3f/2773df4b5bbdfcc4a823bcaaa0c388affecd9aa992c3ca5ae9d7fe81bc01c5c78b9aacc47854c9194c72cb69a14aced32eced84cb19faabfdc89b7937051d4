"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
//#region src/awesome/AuroraBackground/AuroraBackground.tsx
const AuroraBackground = memo(({ ref, classNames, styles: customStyles, children, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		ref,
		...rest,
		children: [/* @__PURE__ */ jsx(FlexBasic_default, {
			className: cx(styles.wrapper, classNames?.wrapper),
			style: customStyles?.wrapper,
			children: /* @__PURE__ */ jsx("div", { className: isDarkMode ? styles.bgDark : styles.bgLight })
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			className: classNames?.content,
			flex: 1,
			style: {
				zIndex: 1,
				...customStyles?.content
			},
			width: "100%",
			children
		})]
	});
});
AuroraBackground.displayName = "AuroraBackground";
//#endregion
export { AuroraBackground as default };

//# sourceMappingURL=AuroraBackground.mjs.map