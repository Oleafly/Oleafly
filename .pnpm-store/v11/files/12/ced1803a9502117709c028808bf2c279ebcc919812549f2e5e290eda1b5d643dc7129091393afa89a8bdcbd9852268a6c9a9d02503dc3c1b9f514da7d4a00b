"use client";
import { styles } from "./style.mjs";
import { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab } from "./atoms.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
//#region src/base-ui/Tabs/Tabs.tsx
const Tabs = ({ activeKey, className, classNames, defaultActiveKey, items, onChange, orientation = "horizontal", ref, size = "middle", style, styles: customStyles, variant = "rounded" }) => {
	const initialActiveKey = defaultActiveKey ?? items?.find((item) => !item.disabled)?.key ?? null;
	const [value, setValue] = useMergeState(initialActiveKey, {
		defaultValue: initialActiveKey,
		onChange: (next) => {
			if (next != null) onChange?.(next);
		},
		value: activeKey
	});
	const hasPanels = items?.some((item) => item.children != null);
	return /* @__PURE__ */ jsxs(TabsRoot, {
		className: cx(styles.root, classNames?.root, className),
		orientation,
		ref,
		size,
		style: {
			...style,
			...customStyles?.root
		},
		value,
		variant,
		onValueChange: (next) => setValue(next ?? null),
		children: [/* @__PURE__ */ jsxs(TabsList, {
			className: cx(classNames?.list),
			style: customStyles?.list,
			children: [/* @__PURE__ */ jsx(TabsIndicator, {
				className: cx(classNames?.indicator),
				style: customStyles?.indicator
			}), items?.map((item) => /* @__PURE__ */ jsxs(TabsTab, {
				className: cx(classNames?.tab),
				disabled: item.disabled,
				style: customStyles?.tab,
				value: item.key,
				children: [item.icon, item.label]
			}, item.key))]
		}), hasPanels && items?.map((item) => /* @__PURE__ */ jsx(TabsPanel, {
			className: cx(classNames?.panel),
			style: customStyles?.panel,
			value: item.key,
			children: item.children
		}, item.key))]
	});
};
Tabs.displayName = "Tabs";
//#endregion
export { Tabs as default };

//# sourceMappingURL=Tabs.mjs.map