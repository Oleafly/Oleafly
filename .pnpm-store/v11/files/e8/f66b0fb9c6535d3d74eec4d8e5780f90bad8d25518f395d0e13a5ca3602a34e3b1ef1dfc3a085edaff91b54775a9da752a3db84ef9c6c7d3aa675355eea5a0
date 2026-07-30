"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Tag from "../../Tag/Tag.mjs";
import { titleStyles } from "../style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Form/components/FormTitle.tsx
const FormTitle = ({ tag, title, desc, avatar, classNames, styles: customStyles, ...rest }) => {
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: `center`,
		gap: 8,
		...rest,
		children: [avatar, /* @__PURE__ */ jsxs(FlexBasic_default, {
			className: cx(titleStyles.content, classNames?.content),
			gap: 8,
			style: customStyles?.content,
			children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
				align: "center",
				className: cx(titleStyles.title, classNames?.title),
				direction: "horizontal",
				gap: 8,
				style: customStyles?.title,
				children: [title, tag && /* @__PURE__ */ jsx(Tag, {
					className: classNames?.tag,
					style: customStyles?.tag,
					children: tag
				})]
			}), desc && /* @__PURE__ */ jsx("small", {
				className: cx(titleStyles.desc, classNames?.desc),
				style: customStyles?.desc,
				children: desc
			})]
		})]
	});
};
FormTitle.displayName = "FormTitle";
//#endregion
export { FormTitle as default };

//# sourceMappingURL=FormTitle.mjs.map