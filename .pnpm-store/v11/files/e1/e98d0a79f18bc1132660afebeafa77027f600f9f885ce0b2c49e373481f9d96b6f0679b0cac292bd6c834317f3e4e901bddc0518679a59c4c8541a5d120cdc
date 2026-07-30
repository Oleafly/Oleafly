import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { titleStyles } from "./style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/chat/ChatHeader/ChatHeaderTitle.tsx
const ChatHeaderTitle = ({ title, desc, tag }) => {
	const tagContent = tag && /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: titleStyles.tag,
		children: tag
	});
	if (desc) return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: titleStyles.container,
		gap: 4,
		children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: titleStyles.titleContainer,
			gap: 8,
			children: [/* @__PURE__ */ jsx("div", {
				className: titleStyles.titleWithDesc,
				children: title
			}), tagContent]
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: titleStyles.desc,
			children: desc
		})]
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: titleStyles.container,
		gap: 8,
		children: [/* @__PURE__ */ jsx("div", {
			className: titleStyles.title,
			children: title
		}), tagContent]
	});
};
//#endregion
export { ChatHeaderTitle as default };

//# sourceMappingURL=ChatHeaderTitle.mjs.map