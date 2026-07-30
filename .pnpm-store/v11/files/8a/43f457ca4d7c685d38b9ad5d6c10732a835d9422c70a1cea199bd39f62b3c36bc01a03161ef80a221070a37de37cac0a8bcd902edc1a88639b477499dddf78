import { styles } from "./sharedStyle.mjs";
import { DropdownMenuCheckboxItemIndicator, DropdownMenuCheckboxItemPrimitive, DropdownMenuFooter, DropdownMenuGroup, DropdownMenuGroupLabel, DropdownMenuHeader, DropdownMenuItem, DropdownMenuItemContent, DropdownMenuItemDesc, DropdownMenuItemExtra, DropdownMenuItemIcon, DropdownMenuItemLabel, DropdownMenuItemLabelGroup, DropdownMenuPopup, DropdownMenuPortal, DropdownMenuPositioner, DropdownMenuScrollViewport, DropdownMenuSeparator, DropdownMenuSubmenuArrow, DropdownMenuSubmenuRoot, DropdownMenuSubmenuTrigger, DropdownMenuSwitchItem } from "./atoms.mjs";
import { SubmenuArrowIcon } from "../SubmenuArrowIcon.mjs";
import { getItemKey, getItemLabel, hasAnyIcon, hasCheckboxAndIcon, renderIcon } from "../../Menu/renderUtils.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { Check } from "lucide-react";
//#region src/base-ui/DropdownMenu/renderItems.tsx
const renderItemContent = (item, options, iconNode) => {
	const label = getItemLabel(item);
	const desc = "desc" in item ? item.desc : void 0;
	const extra = "extra" in item ? item.extra : void 0;
	const indicatorOnRight = options?.indicatorOnRight;
	const alignStart = Boolean(desc) && options?.iconAlign === "start";
	const hasCustomIcon = iconNode !== void 0 && !indicatorOnRight;
	const hasIcon = hasCustomIcon ? Boolean(iconNode) : Boolean(item.icon);
	const shouldRenderIcon = hasCustomIcon ? Boolean(options?.reserveIconSpace || iconNode) : Boolean(hasIcon || options?.reserveIconSpace);
	const labelNode = desc ? /* @__PURE__ */ jsxs(DropdownMenuItemLabelGroup, { children: [/* @__PURE__ */ jsx(DropdownMenuItemLabel, { children: label }), /* @__PURE__ */ jsx(DropdownMenuItemDesc, { children: desc })] }) : /* @__PURE__ */ jsx(DropdownMenuItemLabel, { children: label });
	return /* @__PURE__ */ jsxs(DropdownMenuItemContent, {
		className: alignStart ? styles.itemContentAlignStart : void 0,
		children: [
			shouldRenderIcon ? /* @__PURE__ */ jsx(DropdownMenuItemIcon, {
				"aria-hidden": !hasIcon,
				className: alignStart ? styles.iconAlignStart : void 0,
				children: hasCustomIcon ? iconNode : hasIcon ? renderIcon(item.icon) : null
			}) : null,
			labelNode,
			extra ? /* @__PURE__ */ jsx(DropdownMenuItemExtra, { children: extra }) : null,
			indicatorOnRight && iconNode ? iconNode : null,
			options?.submenu ? /* @__PURE__ */ jsx(DropdownMenuSubmenuArrow, { children: /* @__PURE__ */ jsx(SubmenuArrowIcon, {}) }) : null
		]
	});
};
const invokeItemClick = (item, keyPath, event) => {
	if (!item.onClick) return;
	const key = item.key ?? keyPath.at(-1) ?? "";
	const info = {
		domEvent: event,
		item: event.currentTarget,
		key: String(key),
		keyPath
	};
	item.onClick(info);
};
const renderDropdownMenuItems = (items, keyPath = [], options) => {
	const iconAlign = options?.iconAlign;
	const iconSpaceMode = options?.iconSpaceMode ?? "global";
	const reserveIconSpace = options?.reserveIconSpace ?? hasAnyIcon(items, iconSpaceMode === "global");
	const indicatorOnRight = options?.indicatorOnRight ?? hasCheckboxAndIcon(items);
	return items.map((item, index) => {
		if (!item) return null;
		const itemKey = getItemKey(item, `${keyPath.join("-") || "root"}-${index}`);
		const nextKeyPath = [...keyPath, String(itemKey)];
		if (item.type === "checkbox") {
			const checkboxItem = item;
			const label = getItemLabel(checkboxItem);
			const labelText = typeof label === "string" ? label : void 0;
			const isDanger = Boolean(checkboxItem.danger);
			const indicator = /* @__PURE__ */ jsx(DropdownMenuCheckboxItemIndicator, { children: renderIcon(Check) });
			return /* @__PURE__ */ jsx(DropdownMenuCheckboxItemPrimitive, {
				checked: checkboxItem.checked,
				closeOnClick: checkboxItem.closeOnClick,
				danger: isDanger,
				defaultChecked: checkboxItem.defaultChecked,
				disabled: checkboxItem.disabled,
				label: labelText,
				onCheckedChange: (checked) => checkboxItem.onCheckedChange?.(checked),
				children: renderItemContent(checkboxItem, {
					iconAlign,
					indicatorOnRight,
					reserveIconSpace
				}, indicator)
			}, itemKey);
		}
		if (item.type === "switch") {
			const switchItem = item;
			const label = getItemLabel(switchItem);
			const labelText = typeof label === "string" ? label : void 0;
			const isDanger = Boolean(switchItem.danger);
			return /* @__PURE__ */ jsx(DropdownMenuSwitchItem, {
				checked: switchItem.checked,
				closeOnClick: switchItem.closeOnClick,
				danger: isDanger,
				defaultChecked: switchItem.defaultChecked,
				disabled: switchItem.disabled,
				label: labelText,
				onCheckedChange: (checked) => switchItem.onCheckedChange?.(checked),
				children: renderItemContent(switchItem, {
					iconAlign,
					reserveIconSpace
				})
			}, itemKey);
		}
		if (item.type === "divider") return /* @__PURE__ */ jsx(DropdownMenuSeparator, {}, itemKey);
		if (item.type === "group") {
			const group = item;
			const groupReserveIconSpace = iconSpaceMode === "group" ? group.children ? hasAnyIcon(group.children) : false : reserveIconSpace;
			const groupIndicatorOnRight = group.children ? hasCheckboxAndIcon(group.children) : false;
			return /* @__PURE__ */ jsxs(DropdownMenuGroup, { children: [group.label ? /* @__PURE__ */ jsx(DropdownMenuGroupLabel, { children: group.label }) : null, group.children ? renderDropdownMenuItems(group.children, nextKeyPath, {
				iconAlign,
				iconSpaceMode,
				indicatorOnRight: groupIndicatorOnRight,
				reserveIconSpace: groupReserveIconSpace
			}) : null] }, itemKey);
		}
		if (item.type === "submenu" || "children" in item) {
			const submenu = item;
			const label = getItemLabel(submenu);
			const labelText = typeof label === "string" ? label : void 0;
			const isDanger = "danger" in submenu && Boolean(submenu.danger);
			const submenuHasSlots = submenu.header != null || submenu.footer != null;
			const submenuItems = submenu.children ? renderDropdownMenuItems(submenu.children, nextKeyPath, {
				iconAlign,
				iconSpaceMode
			}) : null;
			return /* @__PURE__ */ jsxs(DropdownMenuSubmenuRoot, {
				defaultOpen: submenu.defaultOpen,
				open: submenu.open,
				onOpenChange: submenu.onOpenChange,
				children: [/* @__PURE__ */ jsx(DropdownMenuSubmenuTrigger, {
					...submenu.triggerProps,
					closeDelay: submenu.closeDelay,
					danger: isDanger,
					delay: submenu.delay,
					disabled: submenu.disabled,
					label: labelText,
					openOnHover: submenu.openOnHover,
					onClick: submenu.onClick,
					children: renderItemContent(submenu, {
						iconAlign,
						reserveIconSpace,
						submenu: true
					})
				}), /* @__PURE__ */ jsx(DropdownMenuPortal, { children: /* @__PURE__ */ jsx(DropdownMenuPositioner, {
					alignOffset: -4,
					"data-submenu": "",
					sideOffset: -1,
					children: /* @__PURE__ */ jsxs(DropdownMenuPopup, {
						className: submenuHasSlots ? styles.popupWithSlots : void 0,
						children: [
							submenu.header == null ? null : /* @__PURE__ */ jsx(DropdownMenuHeader, { children: submenu.header }),
							submenuHasSlots ? /* @__PURE__ */ jsx(DropdownMenuScrollViewport, { children: submenuItems }) : submenuItems,
							submenu.footer == null ? null : /* @__PURE__ */ jsx(DropdownMenuFooter, { children: submenu.footer })
						]
					})
				}) })]
			}, itemKey);
		}
		const menuItem = item;
		const label = getItemLabel(menuItem);
		const labelText = typeof label === "string" ? label : void 0;
		const isDanger = "danger" in menuItem && Boolean(menuItem.danger);
		return /* @__PURE__ */ jsx(DropdownMenuItem, {
			closeOnClick: menuItem.closeOnClick,
			danger: isDanger,
			disabled: menuItem.disabled,
			label: labelText,
			onClick: (event) => invokeItemClick(menuItem, nextKeyPath, event),
			children: renderItemContent(menuItem, {
				iconAlign,
				reserveIconSpace
			})
		}, itemKey);
	});
};
//#endregion
export { renderDropdownMenuItems };

//# sourceMappingURL=renderItems.mjs.map