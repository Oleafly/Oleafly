"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Tabs$1 from "../../Tabs/Tabs.mjs";
import { styles } from "./style.mjs";
import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/mdx/Tabs/index.tsx
const Tabs = ({ defaultIndex = "0", items, children, className, tabNavProps = {}, ...rest }) => {
	const { className: tabNavClassName, onChange, ...tabNavRest } = tabNavProps;
	const [activeIndex, setActiveIndex] = useState(String(defaultIndex));
	const index = Number(activeIndex);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(styles.container, className),
		...rest,
		children: [/* @__PURE__ */ jsx(Tabs$1, {
			compact: true,
			activeKey: activeIndex,
			className: cx(styles.header, tabNavClassName),
			items: items.map((item, i) => ({
				key: String(i),
				label: item
			})),
			onChange: (v) => {
				setActiveIndex(v);
				onChange?.(v);
			},
			...tabNavRest
		}), children?.[index] || ""]
	});
};
//#endregion
export { Tabs as default };

//# sourceMappingURL=index.mjs.map