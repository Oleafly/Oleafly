import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { copyToClipboard } from "../../utils/copyToClipboard.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Space, message } from "antd";
import { cssVar } from "antd-style";
//#region src/color/CssVar/VarRow.tsx
const ScaleRow = memo(({ name }) => {
	return /* @__PURE__ */ jsxs(Space, {
		size: 2,
		children: [/* @__PURE__ */ jsx("div", {
			className: styles.scaleRowTitle,
			children: /* @__PURE__ */ jsx("div", {
				className: styles.text,
				children: "cssVar"
			})
		}, name), [
			1,
			2,
			3,
			4,
			5,
			6,
			7,
			8,
			9,
			10
		].map((color) => {
			return /* @__PURE__ */ jsx("div", {
				className: styles.scaleBox,
				title: cssVar[`${name}${color}`],
				onClick: async () => {
					const content = cssVar[`${name}${color}`];
					await copyToClipboard(content);
					message.success(content);
				},
				children: /* @__PURE__ */ jsx(FlexBasic_default, {
					horizontal: true,
					align: "center",
					className: styles.scaleItem,
					justify: "center",
					style: { backgroundColor: cssVar[`${name}${color}`] }
				})
			}, color);
		})]
	});
});
//#endregion
export { ScaleRow as default };

//# sourceMappingURL=VarRow.mjs.map