"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import { useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { isString } from "es-toolkit/compat";
//#region src/Grid/Grid.tsx
const Grid = ({ className, gap = "1em", rows = 3, children, maxItemWidth = 240, ref, style, ...rest }) => {
	const cssVariables = useMemo(() => {
		return {
			"--grid-gap": isString(gap) ? gap : `${gap}px`,
			"--grid-max-item-width": isString(maxItemWidth) ? maxItemWidth : `${maxItemWidth}px`,
			"--grid-rows": `${rows}`
		};
	}, [
		gap,
		maxItemWidth,
		rows
	]);
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		className: cx(styles, className),
		gap,
		ref,
		style: {
			...cssVariables,
			...style
		},
		...rest,
		children
	});
};
Grid.displayName = "Grid";
//#endregion
export { Grid as default };

//# sourceMappingURL=Grid.mjs.map