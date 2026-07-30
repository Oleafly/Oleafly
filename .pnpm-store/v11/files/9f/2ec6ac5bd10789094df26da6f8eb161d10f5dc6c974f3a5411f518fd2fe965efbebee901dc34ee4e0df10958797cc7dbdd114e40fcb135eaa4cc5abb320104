import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { copyToClipboard } from "../../utils/copyToClipboard.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Space, message } from "antd";
//#region src/color/CssVar/ScaleRow.tsx
const ScaleRow = memo(({ name, title, scale }) => {
	const style = {};
	return /* @__PURE__ */ jsxs(Space, {
		size: 2,
		children: [/* @__PURE__ */ jsx("div", {
			className: styles.scaleRowTitle,
			children: /* @__PURE__ */ jsx("div", {
				className: styles.text,
				children: title
			})
		}, title), scale.map((color, index) => {
			if (index === 0 || index === 12) return false;
			return /* @__PURE__ */ jsx("div", {
				className: styles.scaleBox,
				style,
				title: color,
				onClick: async () => {
					const content = `token.${name}${index} /* ${color} */`;
					await copyToClipboard(content);
					message.success(content);
				},
				children: /* @__PURE__ */ jsx(FlexBasic_default, {
					horizontal: true,
					align: "center",
					className: styles.scaleItem,
					justify: "center",
					style: { backgroundColor: color }
				})
			}, index);
		})]
	});
});
//#endregion
export { ScaleRow as default };

//# sourceMappingURL=ScaleRow.mjs.map