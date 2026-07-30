"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Icon from "../../Icon/Icon.mjs";
import Text from "../../Text/Text.mjs";
import { preventDefaultAndStopPropagation } from "../../utils/dom.mjs";
import { styles } from "./style.mjs";
import { getChatItemTime } from "./time.mjs";
import { memo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Loader2, MessageSquare } from "lucide-react";
//#region src/List/ListItem/index.tsx
const ListItem = memo(({ ref, active, avatar, loading, description, date, title, onHoverChange, actions, className, style, showAction, children, classNames, addon, pin, styles: customStyles, ...rest }) => {
	const loadingNode = /* @__PURE__ */ jsx(Icon, {
		spin: true,
		icon: Loader2
	});
	const pinNode = pin && /* @__PURE__ */ jsx("div", {
		className: cx(styles.pin, classNames?.pin),
		style: customStyles?.pin,
		children: /* @__PURE__ */ jsx("div", { className: styles.triangle })
	});
	const actionsNode = actions && /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		className: cx(styles.actions, classNames?.actions),
		gap: 4,
		style: {
			display: showAction ? void 0 : "none",
			...customStyles?.actions
		},
		onClick: preventDefaultAndStopPropagation,
		children: actions
	});
	const timeNode = date && /* @__PURE__ */ jsx("div", {
		className: cx(styles.date, classNames?.date),
		style: {
			opacity: showAction ? 0 : void 0,
			...customStyles?.date
		},
		children: getChatItemTime(date)
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "flex-start",
		className: cx(styles.root, active && styles.active, className),
		distribution: "space-between",
		gap: 8,
		padding: 12,
		ref,
		style,
		onMouseEnter: () => {
			onHoverChange?.(true);
		},
		onMouseLeave: () => {
			onHoverChange?.(false);
		},
		...rest,
		children: [
			pinNode,
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "flex-start",
				className: classNames?.container,
				flex: 1,
				gap: 8,
				style: {
					overflow: "hidden",
					...customStyles?.container
				},
				children: [avatar ?? /* @__PURE__ */ jsx(Icon, {
					icon: MessageSquare,
					style: { marginTop: 4 }
				}), /* @__PURE__ */ jsxs(FlexBasic_default, {
					className: cx(styles.content, classNames?.content),
					gap: 4,
					style: customStyles?.content,
					children: [
						/* @__PURE__ */ jsx(Text, {
							ellipsis: true,
							as: "h3",
							className: cx(styles.title, classNames?.title),
							style: customStyles?.title,
							children: title
						}),
						description && /* @__PURE__ */ jsx(Text, {
							ellipsis: true,
							className: cx(styles.desc, classNames?.desc),
							style: customStyles?.desc,
							children: description
						}),
						addon
					]
				})]
			}),
			loading ? loadingNode : /* @__PURE__ */ jsxs(Fragment$1, { children: [actionsNode, timeNode] }),
			children
		]
	});
});
ListItem.displayName = "ListItem";
//#endregion
export { ListItem as default };

//# sourceMappingURL=index.mjs.map