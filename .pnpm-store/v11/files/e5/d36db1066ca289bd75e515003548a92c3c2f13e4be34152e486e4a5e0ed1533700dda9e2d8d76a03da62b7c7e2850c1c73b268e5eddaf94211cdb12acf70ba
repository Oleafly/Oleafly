"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import SafeArea from "../SafeArea/SafeArea.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ChevronLeft } from "lucide-react";
//#region src/mobile/ChatHeader/ChatHeader.tsx
const ChatHeader = memo(({ ref, className, safeArea = true, style, center, left, right, gaps, classNames, onBackClick, showBackButton, styles: custmStyles, children, ...rest }) => {
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		as: "header",
		className: cx(styles.container, className),
		ref,
		style,
		...rest,
		children: [safeArea && /* @__PURE__ */ jsx(SafeArea, { position: "top" }), /* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: styles.inner,
			flex: 1,
			justify: "space-between",
			children: [
				/* @__PURE__ */ jsxs(FlexBasic_default, {
					horizontal: true,
					align: "center",
					className: cx(styles.left, classNames?.left),
					flex: 1,
					gap: gaps?.left,
					style: custmStyles?.left,
					children: [showBackButton && /* @__PURE__ */ jsx(ActionIcon, {
						icon: ChevronLeft,
						onClick: () => onBackClick?.()
					}), left]
				}),
				/* @__PURE__ */ jsxs(FlexBasic_default, {
					horizontal: true,
					align: "center",
					className: cx(styles.center, classNames?.center),
					flex: 1,
					gap: gaps?.center,
					justify: "center",
					style: custmStyles?.center,
					children: [children, center]
				}),
				/* @__PURE__ */ jsx(FlexBasic_default, {
					horizontal: true,
					align: "center",
					className: cx(styles.right, classNames?.right),
					flex: 1,
					gap: gaps?.right,
					style: custmStyles?.right,
					children: right
				})
			]
		})]
	});
});
ChatHeader.displayName = "ChatHeader";
//#endregion
export { ChatHeader as default };

//# sourceMappingURL=ChatHeader.mjs.map