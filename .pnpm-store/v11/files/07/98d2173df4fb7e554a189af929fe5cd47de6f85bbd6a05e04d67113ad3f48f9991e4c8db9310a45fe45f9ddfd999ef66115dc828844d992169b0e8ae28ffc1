import Icon from "../../Icon/Icon.mjs";
import { preventDefaultAndStopPropagation } from "../../utils/dom.mjs";
import Switch from "../Switch/Switch.mjs";
import { styles } from "../DropdownMenu/sharedStyle.mjs";
import { SubmenuArrowIcon } from "../SubmenuArrowIcon.mjs";
import { getItemKey, getItemLabel, hasAnyIcon, hasCheckboxAndIcon, renderIcon } from "../../Menu/renderUtils.mjs";
import common_default from "../../i18n/resources/en/common.mjs";
import { useTranslation } from "../../i18n/useTranslation.mjs";
import { memo, useCallback, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Check } from "lucide-react";
import { ContextMenu } from "@base-ui/react/context-menu";
//#region src/base-ui/ContextMenu/renderItems.tsx
const EmptyMenuItem = memo(() => {
	const { t } = useTranslation(common_default);
	return /* @__PURE__ */ jsx(ContextMenu.Item, {
		disabled: true,
		className: cx(styles.item, styles.empty),
		children: /* @__PURE__ */ jsx("div", {
			className: styles.itemContent,
			children: /* @__PURE__ */ jsx("span", {
				className: styles.label,
				children: t("common.empty")
			})
		})
	});
});
EmptyMenuItem.displayName = "EmptyMenuItem";
const ContextMenuSwitchItemInternal = ({ checked: checkedProp, children, closeOnClick = false, danger, defaultChecked, disabled, label, onCheckedChange }) => {
	const [internalChecked, setInternalChecked] = useState(defaultChecked ?? false);
	const isControlled = checkedProp !== void 0;
	const checked = isControlled ? checkedProp : internalChecked;
	const handleCheckedChange = useCallback((newChecked) => {
		if (!isControlled) setInternalChecked(newChecked);
		onCheckedChange?.(newChecked);
	}, [isControlled, onCheckedChange]);
	return /* @__PURE__ */ jsxs(ContextMenu.Item, {
		className: cx(styles.item, danger && styles.danger),
		closeOnClick,
		disabled,
		label,
		onClick: (e) => {
			e.preventDefault();
			if (!disabled) handleCheckedChange(!checked);
		},
		children: [children, /* @__PURE__ */ jsx("span", {
			style: {
				display: "inline-flex",
				marginInlineStart: 16
			},
			onFocus: (e) => e.stopPropagation(),
			children: /* @__PURE__ */ jsx(Switch, {
				checked,
				disabled,
				size: "small",
				tabIndex: -1,
				onChange: handleCheckedChange,
				onClick: (_, e) => e.stopPropagation()
			})
		})]
	});
};
const renderItemContent = (item, options, iconNode) => {
	const label = getItemLabel(item);
	const desc = "desc" in item ? item.desc : void 0;
	const extra = "extra" in item ? item.extra : void 0;
	const indicatorOnRight = options?.indicatorOnRight;
	const alignStart = Boolean(desc) && options?.iconAlign === "start";
	const hasCustomIcon = iconNode !== void 0 && !indicatorOnRight;
	const hasIcon = hasCustomIcon ? Boolean(iconNode) : Boolean(item.icon);
	const shouldRenderIcon = hasCustomIcon ? Boolean(options?.reserveIconSpace || iconNode) : Boolean(hasIcon || options?.reserveIconSpace);
	const labelNode = desc ? /* @__PURE__ */ jsxs("div", {
		className: styles.labelGroup,
		children: [/* @__PURE__ */ jsx("span", {
			className: styles.label,
			children: label
		}), /* @__PURE__ */ jsx("span", {
			className: styles.desc,
			children: desc
		})]
	}) : /* @__PURE__ */ jsx("span", {
		className: styles.label,
		children: label
	});
	return /* @__PURE__ */ jsxs("div", {
		className: cx(styles.itemContent, alignStart && styles.itemContentAlignStart),
		children: [
			shouldRenderIcon ? /* @__PURE__ */ jsx("span", {
				"aria-hidden": !hasIcon,
				className: cx(styles.icon, alignStart && styles.iconAlignStart),
				children: hasCustomIcon ? iconNode : hasIcon ? renderIcon(item.icon, "small") : null
			}) : null,
			labelNode,
			extra ? /* @__PURE__ */ jsx("span", {
				className: styles.extra,
				children: extra
			}) : null,
			indicatorOnRight && iconNode ? iconNode : null,
			options?.submenu ? /* @__PURE__ */ jsx("span", {
				className: styles.submenuArrow,
				children: /* @__PURE__ */ jsx(SubmenuArrowIcon, {})
			}) : null
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
const renderContextMenuItems = (items, keyPath = [], options) => {
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
			const indicator = /* @__PURE__ */ jsx(ContextMenu.CheckboxItemIndicator, { children: /* @__PURE__ */ jsx(Icon, {
				icon: Check,
				size: "small"
			}) });
			return /* @__PURE__ */ jsx(ContextMenu.CheckboxItem, {
				checked: checkboxItem.checked,
				className: cx(styles.item, isDanger && styles.danger),
				closeOnClick: checkboxItem.closeOnClick,
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
			return /* @__PURE__ */ jsx(ContextMenuSwitchItemInternal, {
				checked: switchItem.checked,
				closeOnClick: switchItem.closeOnClick,
				danger: isDanger,
				defaultChecked: switchItem.defaultChecked,
				disabled: switchItem.disabled,
				label: labelText,
				onCheckedChange: switchItem.onCheckedChange,
				children: renderItemContent(switchItem, {
					iconAlign,
					reserveIconSpace
				})
			}, itemKey);
		}
		if (item.type === "divider") return /* @__PURE__ */ jsx(ContextMenu.Separator, { className: styles.separator }, itemKey);
		if (item.type === "group") {
			const group = item;
			const groupReserveIconSpace = iconSpaceMode === "group" ? group.children ? hasAnyIcon(group.children) : false : reserveIconSpace;
			const groupIndicatorOnRight = group.children ? hasCheckboxAndIcon(group.children) : false;
			return /* @__PURE__ */ jsxs(ContextMenu.Group, { children: [group.label ? /* @__PURE__ */ jsx(ContextMenu.GroupLabel, {
				className: styles.groupLabel,
				children: group.label
			}) : null, group.children ? renderContextMenuItems(group.children, nextKeyPath, {
				iconAlign,
				iconSpaceMode,
				indicatorOnRight: groupIndicatorOnRight,
				reserveIconSpace: groupReserveIconSpace
			}) : null] }, itemKey);
		}
		if (item.type === "submenu" || "children" in item && item.children) {
			const submenu = item;
			const label = getItemLabel(submenu);
			const labelText = typeof label === "string" ? label : void 0;
			const isDanger = "danger" in submenu && Boolean(submenu.danger);
			const submenuHasSlots = submenu.header != null || submenu.footer != null;
			const submenuBody = submenu.children && submenu.children.length > 0 ? renderContextMenuItems(submenu.children, nextKeyPath, {
				iconAlign,
				iconSpaceMode
			}) : /* @__PURE__ */ jsx(EmptyMenuItem, {});
			return /* @__PURE__ */ jsxs(ContextMenu.SubmenuRoot, {
				defaultOpen: submenu.defaultOpen,
				open: submenu.open,
				onOpenChange: submenu.onOpenChange,
				children: [/* @__PURE__ */ jsx(ContextMenu.SubmenuTrigger, {
					...submenu.triggerProps,
					className: cx(styles.item, isDanger && styles.danger),
					closeDelay: submenu.closeDelay,
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
				}), /* @__PURE__ */ jsx(ContextMenu.Portal, { children: /* @__PURE__ */ jsx(ContextMenu.Positioner, {
					alignOffset: -4,
					className: styles.positioner,
					"data-submenu": "",
					sideOffset: -1,
					onContextMenu: preventDefaultAndStopPropagation,
					children: /* @__PURE__ */ jsxs(ContextMenu.Popup, {
						className: submenuHasSlots ? cx(styles.popup, styles.popupWithSlots) : styles.popup,
						children: [
							submenu.header == null ? null : /* @__PURE__ */ jsx("div", {
								className: styles.header,
								children: submenu.header
							}),
							submenuHasSlots ? /* @__PURE__ */ jsx("div", {
								className: styles.slotViewport,
								children: submenuBody
							}) : submenuBody,
							submenu.footer == null ? null : /* @__PURE__ */ jsx("div", {
								className: styles.footer,
								children: submenu.footer
							})
						]
					})
				}) })]
			}, itemKey);
		}
		const menuItem = item;
		const label = getItemLabel(menuItem);
		const labelText = typeof label === "string" ? label : void 0;
		const isDanger = "danger" in menuItem && Boolean(menuItem.danger);
		return /* @__PURE__ */ jsx(ContextMenu.Item, {
			className: cx(styles.item, isDanger && styles.danger),
			closeOnClick: menuItem.closeOnClick,
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
export { renderContextMenuItems };

//# sourceMappingURL=renderItems.mjs.map