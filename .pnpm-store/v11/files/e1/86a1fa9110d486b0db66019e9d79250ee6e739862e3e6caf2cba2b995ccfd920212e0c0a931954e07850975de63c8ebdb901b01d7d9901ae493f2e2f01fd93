"use client";
import Center from "../Flex/Center.mjs";
import TooltipGroup from "../base-ui/Tooltip/TooltipGroup.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import DropdownMenu from "../base-ui/DropdownMenu/DropdownMenu.mjs";
import { variants } from "./style.mjs";
import { useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { MoreHorizontal } from "lucide-react";
//#region src/ActionIconGroup/ActionIconGroup.tsx
const ActionIconGroup = ({ variant = "filled", disabled, shadow, glass, actionIconProps, items = [], horizontal = true, menu, onActionClick, className, size = "small", ref, ...rest }) => {
	const tooltipPlacement = useMemo(() => actionIconProps?.tooltipProps?.placement || horizontal ? "top" : "right", [actionIconProps, horizontal]);
	const menuItems = useMemo(() => {
		const rawItems = typeof menu === "function" ? menu() : menu;
		if (!rawItems) return [];
		return rawItems.map((item) => ({
			...item,
			onClick: (info) => {
				item?.onClick?.(info);
				onActionClick?.(info);
			}
		}));
	}, [menu, onActionClick]);
	return /* @__PURE__ */ jsx(TooltipGroup, { children: /* @__PURE__ */ jsxs(Center, {
		className: cx(variants({
			disabled,
			glass,
			shadow,
			variant
		}), className),
		horizontal,
		padding: 2,
		ref,
		...rest,
		children: [items?.length > 0 && items.map((item) => {
			const { icon, key, label, onClick, danger, loading, ...itemRest } = item;
			return /* @__PURE__ */ jsx(ActionIcon, {
				danger,
				icon,
				loading,
				size,
				title: label,
				tooltipProps: { placement: tooltipPlacement },
				onClick: (e) => {
					onActionClick?.({
						domEvent: e,
						key: String(key),
						keyPath: [String(key)]
					});
					onClick?.(e);
				},
				...actionIconProps,
				disabled: disabled || loading || itemRest?.disabled
			}, key);
		}), menu && /* @__PURE__ */ jsx(DropdownMenu, {
			items: menuItems,
			nativeButton: false,
			children: /* @__PURE__ */ jsx(ActionIcon, {
				disabled,
				icon: MoreHorizontal,
				size,
				...actionIconProps,
				tooltipProps: {
					placement: tooltipPlacement,
					...actionIconProps?.tooltipProps
				}
			}, "more")
		})]
	}) });
};
ActionIconGroup.displayName = "ActionIconGroup";
//#endregion
export { ActionIconGroup as default };

//# sourceMappingURL=ActionIconGroup.mjs.map