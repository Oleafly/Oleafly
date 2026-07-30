"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ChevronLeft } from "lucide-react";
//#region src/chat/ChatHeader/ChatHeader.tsx
const ChatHeader = memo(({ left, right, className, styles: contentStyles, gaps, classNames, showBackButton, onBackClick, children, gap = 16, ...rest }) => {
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: cx(styles.container, className),
		distribution: "space-between",
		gap,
		paddingInline: 16,
		...rest,
		children: [
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: cx(styles.left, classNames?.left),
				gap: gaps?.left || 12,
				justify: "flex-start",
				style: contentStyles?.left,
				children: [showBackButton && /* @__PURE__ */ jsx(ActionIcon, {
					icon: ChevronLeft,
					style: { marginRight: gaps?.left ? -gaps.left / 2 : -6 },
					onClick: () => onBackClick?.()
				}), left]
			}),
			children && /* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: cx(styles.center, classNames?.center),
				gap: gaps?.center || 8,
				justify: "center",
				style: contentStyles?.center,
				children
			}),
			/* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: cx(styles.right, classNames?.right),
				gap: gaps?.right || 8,
				justify: "flex-end",
				style: contentStyles?.right,
				children: right
			})
		]
	});
});
ChatHeader.displayName = "ChatHeader";
//#endregion
export { ChatHeader as default };

//# sourceMappingURL=ChatHeader.mjs.map