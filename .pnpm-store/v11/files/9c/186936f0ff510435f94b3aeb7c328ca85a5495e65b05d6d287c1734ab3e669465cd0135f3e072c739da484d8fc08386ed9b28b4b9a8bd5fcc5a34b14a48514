"use client";
import { indicatorVariants, listVariants, styles, tabVariants } from "./style.mjs";
import { createContext, use, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Tabs } from "@base-ui/react/tabs";
//#region src/base-ui/Tabs/atoms.tsx
const TabsContext = createContext({
	size: "middle",
	variant: "rounded"
});
const useTabsContext = () => use(TabsContext);
const TabsRoot = ({ children, size = "middle", variant = "rounded", ...rest }) => {
	const contextValue = useMemo(() => ({
		size,
		variant
	}), [size, variant]);
	return /* @__PURE__ */ jsx(TabsContext, {
		value: contextValue,
		children: /* @__PURE__ */ jsx(Tabs.Root, {
			...rest,
			children
		})
	});
};
TabsRoot.displayName = "TabsRoot";
const TabsList = ({ className, variant: variantProp, ...rest }) => {
	const ctx = useTabsContext();
	const variant = variantProp ?? ctx.variant;
	return /* @__PURE__ */ jsx(Tabs.List, {
		className: cx(listVariants({ variant }), className),
		...rest
	});
};
TabsList.displayName = "TabsList";
const TabsTab = ({ className, size: sizeProp, variant: variantProp, ...rest }) => {
	const ctx = useTabsContext();
	const size = sizeProp ?? ctx.size;
	const variant = variantProp ?? ctx.variant;
	return /* @__PURE__ */ jsx(Tabs.Tab, {
		className: cx(tabVariants({
			size,
			variant
		}), className),
		...rest
	});
};
TabsTab.displayName = "TabsTab";
const TabsPanel = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Tabs.Panel, {
		className: cx(styles.panel, className),
		...rest
	});
};
TabsPanel.displayName = "TabsPanel";
const TabsIndicator = ({ className, variant: variantProp, ...rest }) => {
	const ctx = useTabsContext();
	const variant = variantProp ?? ctx.variant;
	return /* @__PURE__ */ jsx(Tabs.Indicator, {
		renderBeforeHydration: true,
		className: cx(indicatorVariants({ variant }), className),
		...rest
	});
};
TabsIndicator.displayName = "TabsIndicator";
//#endregion
export { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab, styles as tabsStyles, useTabsContext };

//# sourceMappingURL=atoms.mjs.map