"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import ScaleRow from "./ScaleRow.mjs";
import ScaleRow$1 from "./VarRow.mjs";
import { memo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { Space } from "antd";
import { useThemeMode } from "antd-style";
//#region src/color/CssVar/index.tsx
const ColorScales = memo(({ name, scale, midHighLight }) => {
	const { isDarkMode } = useThemeMode();
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		flex: 1,
		justify: "center",
		children: /* @__PURE__ */ jsx("div", {
			style: { padding: "8px 16px 32px 0" },
			children: /* @__PURE__ */ jsxs(Space, {
				direction: "vertical",
				size: 2,
				children: [
					/* @__PURE__ */ jsxs(Space, {
						size: 2,
						children: [/* @__PURE__ */ jsx(FlexBasic_default, {
							horizontal: true,
							align: "center",
							className: styles.scaleRowTitle
						}, "scale-num"), Array.from({ length: scale.light.length }).fill("").map((_, index) => {
							if (index === 0 || index === 12) return false;
							const isMidHighlight = midHighLight === index;
							return /* @__PURE__ */ jsx("div", {
								className: styles.scaleBox,
								children: /* @__PURE__ */ jsx("div", {
									className: styles.scaleBox,
									children: /* @__PURE__ */ jsx(FlexBasic_default, {
										horizontal: true,
										align: "center",
										className: styles.scaleItem,
										justify: "center",
										style: {
											fontWeight: isMidHighlight ? 700 : 400,
											opacity: .5
										},
										children: index
									})
								})
							}, `num${index}`);
						})]
					}, "scale-title"),
					/* @__PURE__ */ jsx(ScaleRow$1, { name }),
					isDarkMode ? /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx(ScaleRow, {
						name,
						scale: scale.dark,
						title: "dark"
					}, "dark"), /* @__PURE__ */ jsx(ScaleRow, {
						name,
						scale: scale.light,
						title: "light"
					}, "light")] }) : /* @__PURE__ */ jsxs(Fragment$1, { children: [
						" ",
						/* @__PURE__ */ jsx(ScaleRow, {
							name,
							scale: scale.light,
							title: "light"
						}, "light"),
						/* @__PURE__ */ jsx(ScaleRow, {
							name,
							scale: scale.dark,
							title: "dark"
						}, "dark")
					] })
				]
			})
		})
	});
});
//#endregion
export { ColorScales as default };

//# sourceMappingURL=index.mjs.map