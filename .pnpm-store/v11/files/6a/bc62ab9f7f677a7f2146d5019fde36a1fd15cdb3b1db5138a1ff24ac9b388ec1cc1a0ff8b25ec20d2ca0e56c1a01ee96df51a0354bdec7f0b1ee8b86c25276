"use client";
import { IconProvider } from "../Icon/components/IconProvider.mjs";
import { mapItems } from "./utils.mjs";
import { variants } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { ConfigProvider, Menu } from "antd";
import { cx, useTheme } from "antd-style";
//#region src/Menu/Menu.tsx
const Menu$1 = memo(({ compact, shadow, variant = "borderless", className, selectable, iconProps, items, ref, ...rest }) => {
	const theme = useTheme();
	const antdItems = useMemo(() => items.map((item) => mapItems(item)), [items]);
	return /* @__PURE__ */ jsx(ConfigProvider, {
		theme: { components: { Menu: {
			controlHeightLG: 36,
			iconMarginInlineEnd: 8,
			iconSize: 16,
			itemActiveBg: theme.isDarkMode ? theme.colorFillQuaternary : theme.colorFillSecondary,
			itemBorderRadius: theme.borderRadius,
			itemColor: theme.colorTextSecondary,
			itemHoverBg: theme.colorFillTertiary,
			itemMarginBlock: 4,
			itemMarginInline: 4,
			itemSelectedBg: theme.colorFillSecondary
		} } },
		children: /* @__PURE__ */ jsx(IconProvider, {
			config: {
				size: "small",
				...iconProps
			},
			children: /* @__PURE__ */ jsx(Menu, {
				className: cx(variants({
					compact,
					shadow,
					variant
				}), className),
				inlineIndent: 12,
				items: antdItems,
				mode: "vertical",
				ref,
				selectable,
				...rest
			})
		})
	});
});
Menu$1.displayName = "Menu";
//#endregion
export { Menu$1 as default };

//# sourceMappingURL=Menu.mjs.map