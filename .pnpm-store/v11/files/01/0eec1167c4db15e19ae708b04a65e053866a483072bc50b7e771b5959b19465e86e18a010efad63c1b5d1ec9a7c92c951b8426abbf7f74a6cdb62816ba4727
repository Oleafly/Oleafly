"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Icon from "../Icon/Icon.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import DropdownMenu from "../base-ui/DropdownMenu/DropdownMenu.mjs";
import { useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Select } from "antd";
import { Monitor, Moon, Sun } from "lucide-react";
//#region src/ThemeSwitch/ThemeSwitch.tsx
const DEFAULT_ICON_SET = {
	auto: Monitor,
	dark: Moon,
	light: Sun
};
const ThemeSwitch = ({ size = "middle", themeMode, onThemeSwitch, type = "icon", labels = {
	auto: "System",
	dark: "Dark",
	light: "Light"
}, className, variant, style }) => {
	const items = useMemo(() => [
		{
			icon: DEFAULT_ICON_SET.auto,
			key: "auto",
			label: labels.auto,
			onClick: () => onThemeSwitch("auto")
		},
		{
			icon: DEFAULT_ICON_SET.light,
			key: "light",
			label: labels.light,
			onClick: () => onThemeSwitch("light")
		},
		{
			icon: DEFAULT_ICON_SET.dark,
			key: "dark",
			label: labels.dark,
			onClick: () => onThemeSwitch("dark")
		}
	], [labels, onThemeSwitch]);
	return type === "select" ? /* @__PURE__ */ jsx(Select, {
		className,
		defaultValue: themeMode,
		style,
		variant,
		options: items.map((item) => ({
			label: /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				gap: 8,
				children: [/* @__PURE__ */ jsx(Icon, { icon: item.icon }), item.label]
			}),
			value: item.key
		})),
		onChange: onThemeSwitch
	}) : /* @__PURE__ */ jsx(DropdownMenu, {
		items,
		nativeButton: false,
		children: /* @__PURE__ */ jsx(ActionIcon, {
			className,
			icon: DEFAULT_ICON_SET[themeMode],
			size,
			style,
			variant
		})
	});
};
ThemeSwitch.displayName = "ThemeSwitch";
//#endregion
export { ThemeSwitch as default };

//# sourceMappingURL=ThemeSwitch.mjs.map