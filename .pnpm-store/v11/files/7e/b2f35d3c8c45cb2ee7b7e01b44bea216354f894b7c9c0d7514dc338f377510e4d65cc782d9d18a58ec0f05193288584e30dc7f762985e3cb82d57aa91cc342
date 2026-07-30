"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import RcFooter from "rc-footer";
//#region src/Footer/Footer.tsx
const Footer = memo(({ columns, bottom, theme, contentMaxWidth = 960, children, style, ...rest }) => {
	const isEmpty = !columns || columns?.length === 0;
	const cssVariables = useMemo(() => ({ "--footer-content-max-width": `${contentMaxWidth}px` }), [contentMaxWidth]);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		as: "section",
		className: styles.root,
		width: "100%",
		style: {
			...cssVariables,
			...style
		},
		...rest,
		children: [/* @__PURE__ */ jsx(RcFooter, {
			bottom,
			className: isEmpty ? styles.footerEmpty : styles.footer,
			columns,
			theme
		}), children]
	});
});
Footer.displayName = "Footer";
//#endregion
export { Footer as default };

//# sourceMappingURL=Footer.mjs.map