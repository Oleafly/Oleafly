"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { titleStyles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/mobile/ChatHeader/ChatHeaderTitle.tsx
const ChatHeaderTitle = memo(({ title, desc, tag }) => {
	if (desc) return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: "center",
		flex: 1,
		gap: 4,
		justify: "center",
		children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: titleStyles.titleContainer,
			gap: 4,
			children: [/* @__PURE__ */ jsx("div", {
				className: titleStyles.titleWithDesc,
				children: title
			}), tag && /* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				className: titleStyles.tag,
				children: tag
			})]
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			children: /* @__PURE__ */ jsx("div", {
				className: titleStyles.desc,
				children: desc
			})
		})]
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		flex: 1,
		gap: 4,
		justify: "center",
		children: [/* @__PURE__ */ jsx("div", {
			className: titleStyles.title,
			children: title
		}), /* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			className: titleStyles.tag,
			children: tag
		})]
	});
});
ChatHeaderTitle.displayName = "ChatHeaderTitle";
//#endregion
export { ChatHeaderTitle as default };

//# sourceMappingURL=ChatHeaderTitle.mjs.map