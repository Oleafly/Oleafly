"use client";
import Grid from "../../Grid/Grid.mjs";
import { styles } from "./style.mjs";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/mdx/Cards/index.tsx
const Cards = ({ children, className, maxItemWidth = 250, rows = 3, ...rest }) => {
	return /* @__PURE__ */ jsx(Grid, {
		className: cx(styles.container, className),
		maxItemWidth,
		rows,
		...rest,
		children
	});
};
Cards.displayName = "MdxCards";
//#endregion
export { Cards as default };

//# sourceMappingURL=index.mjs.map