"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import SafeArea from "../SafeArea/SafeArea.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
//#region src/mobile/TabBar/TabBar.tsx
const TabBar = memo(({ ref, className, safeArea, items, activeKey, defaultActiveKey, onChange, ...rest }) => {
	const [currentActive, setCurrentActive] = useMergeState(defaultActiveKey || items[0].key, {
		defaultValue: defaultActiveKey,
		onChange,
		value: activeKey
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		as: "footer",
		className: cx(styles.container, className),
		ref,
		...rest,
		children: [/* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: cx(styles.inner, className),
			justify: "space-around",
			children: items.map((item) => {
				const active = item.key === currentActive;
				return /* @__PURE__ */ jsxs(FlexBasic_default, {
					align: "center",
					className: cx(styles.tab, active && styles.active),
					gap: 4,
					justify: "center",
					onClick: () => {
						setCurrentActive(item.key);
						item?.onClick?.();
					},
					children: [/* @__PURE__ */ jsx(FlexBasic_default, {
						align: "center",
						className: styles.icon,
						justify: "center",
						children: typeof item.icon === "function" ? item.icon(active) : item.icon
					}), /* @__PURE__ */ jsx("div", {
						className: styles.title,
						children: typeof item.title === "function" ? item.title(active) : item.title
					})]
				}, item.key);
			})
		}), safeArea && /* @__PURE__ */ jsx(SafeArea, { position: "bottom" })]
	});
});
TabBar.displayName = "MobileTabBar";
//#endregion
export { TabBar as default };

//# sourceMappingURL=TabBar.mjs.map