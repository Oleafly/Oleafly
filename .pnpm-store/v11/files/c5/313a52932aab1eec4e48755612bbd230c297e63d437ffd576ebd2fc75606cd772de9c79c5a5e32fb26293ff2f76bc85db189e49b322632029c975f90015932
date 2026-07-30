"use client";
import Grid from "./components/Grid.mjs";
import { styles } from "./style.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx, useTheme } from "antd-style";
import { shuffle } from "es-toolkit/compat";
import chroma from "chroma-js";
import { useSize } from "ahooks";
//#region src/awesome/GridBackground/GridBackground.tsx
const initialGroup = [
	0,
	1,
	2,
	3,
	4,
	5,
	6,
	7,
	8,
	9,
	10,
	11,
	12,
	13,
	14
];
const GridBackground = memo(({ flip, reverse, showBackground, backgroundColor, random, animationDuration = 8, className, colorFront, colorBack, strokeWidth, style, animation, ...rest }) => {
	const ref = useRef(null);
	const size = useSize(ref);
	const theme = useTheme();
	const backgroundCssVariables = useMemo(() => {
		if (!showBackground) return {};
		const scale = chroma.bezier([
			theme.colorText,
			backgroundColor || "blue",
			theme.colorBgLayout
		]).scale().mode("lch").correctLightness().colors(6);
		return {
			"--grid-background-color-1": scale[1],
			"--grid-background-color-2": scale[2],
			"--grid-background-color-3": scale[3],
			"--grid-background-color-4": scale[4]
		};
	}, [
		showBackground,
		backgroundColor,
		theme.colorText,
		theme.colorBgLayout
	]);
	const gridProps = useMemo(() => ({
		className: reverse ? styles.highlightReverse : styles.highlight,
		color: colorFront || cssVar.colorText,
		strokeWidth
	}), [
		reverse,
		colorFront,
		strokeWidth
	]);
	const [group, setGroup] = useState(random ? initialGroup : void 0);
	useEffect(() => {
		setGroup(random ? shuffle(initialGroup) : void 0);
	}, [random]);
	const HighlightGrid = useCallback(() => {
		if (!group) return /* @__PURE__ */ jsx(Grid, {
			style: { "--duration": `${animationDuration}s` },
			...gridProps
		});
		return /* @__PURE__ */ jsx(Fragment$1, { children: group.map((item, index) => {
			return /* @__PURE__ */ jsx(Grid, {
				linePick: item,
				style: {
					"--delay": `${index + Math.random()}s`,
					"--duration": `${animationDuration}s`
				},
				...gridProps
			}, item);
		}) });
	}, [
		group,
		animationDuration,
		gridProps
	]);
	return /* @__PURE__ */ jsxs("div", {
		className: cx(styles.container, className),
		ref,
		style: flip ? {
			transform: "scaleY(-1)",
			...style
		} : style,
		...rest,
		children: [
			/* @__PURE__ */ jsx(Grid, {
				color: colorBack || cssVar.colorBorder,
				strokeWidth,
				style: { zIndex: 2 }
			}),
			animation && /* @__PURE__ */ jsx(HighlightGrid, {}),
			showBackground && /* @__PURE__ */ jsx("div", {
				className: styles.backgroundContainer,
				style: {
					...size ? { fontSize: size.width / 80 } : {},
					...backgroundCssVariables
				},
				children: /* @__PURE__ */ jsx("div", { className: styles.background })
			})
		]
	});
});
GridBackground.displayName = "GridBackground";
//#endregion
export { GridBackground as default };

//# sourceMappingURL=GridBackground.mjs.map