"use client";
import { EditorSlashMenuEmpty, EditorSlashMenuGroup, EditorSlashMenuGroupLabel, EditorSlashMenuHiddenInput, EditorSlashMenuList, EditorSlashMenuPopup, EditorSlashMenuPortal, EditorSlashMenuPositioner, EditorSlashMenuRoot } from "./atoms.mjs";
import { MenuItemRenderer } from "./MenuItemRenderer.mjs";
import { isGroup } from "./utils.mjs";
import { useKeyboardNavigation } from "./useKeyboardNavigation.mjs";
import { useNormalizedItems } from "./useNormalizedItems.mjs";
import { createElement, memo, useCallback, useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/EditorSlashMenu/EditorSlashMenu.tsx
const EditorSlashMenu = memo(({ items, anchor, open, defaultOpen, onOpenChange, onOpenChangeComplete, value, defaultValue, onValueChange, updateValueOnSelect = false, onSelect, empty = "No results", renderGroupLabel, renderItem, reserveIconSpace = true, rootProps, portalProps, positionerProps, popupProps, listProps, withHiddenInput = false, hiddenInputProps }) => {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
	useEffect(() => {
		if (open === void 0) return;
		setUncontrolledOpen(open);
	}, [open]);
	const resolvedOpen = open ?? uncontrolledOpen;
	const { resolvedItems, hasAnyIcon } = useNormalizedItems(items);
	const { listRef } = useKeyboardNavigation({ isOpen: resolvedOpen });
	const itemToStringValue = useCallback((item) => {
		const kws = item.keywords?.length ? ` ${item.keywords.join(" ")}` : "";
		return `${item.label}${kws}`;
	}, []);
	const handleValueChange = useCallback((nextValue, details) => {
		if (!updateValueOnSelect && details.reason === "item-press") return;
		onValueChange?.(nextValue, details);
	}, [onValueChange, updateValueOnSelect]);
	const handleSelect = useCallback((item, details) => {
		onSelect?.(item, details);
	}, [onSelect]);
	const handleOpenChange = useCallback((nextOpen, details) => {
		setUncontrolledOpen(nextOpen);
		onOpenChange?.(nextOpen, details);
	}, [onOpenChange]);
	const setListRef = useCallback((node) => {
		listRef.current = node;
		const externalRef = listProps?.ref;
		if (!externalRef) return;
		if (typeof externalRef === "function") externalRef(node);
		else externalRef.current = node;
	}, [listRef, listProps]);
	const menuItemProps = useMemo(() => ({
		hasAnyIcon,
		onSelect: handleSelect,
		renderItem,
		reserveIconSpace
	}), [
		hasAnyIcon,
		handleSelect,
		renderItem,
		reserveIconSpace
	]);
	return /* @__PURE__ */ jsxs(EditorSlashMenuRoot, {
		...rootProps,
		defaultOpen,
		defaultValue,
		itemToStringValue,
		items: resolvedItems,
		open,
		value,
		onOpenChange: handleOpenChange,
		onOpenChangeComplete,
		onValueChange: handleValueChange,
		children: [withHiddenInput ? /* @__PURE__ */ jsx(EditorSlashMenuHiddenInput, { ...hiddenInputProps }) : null, /* @__PURE__ */ jsx(EditorSlashMenuPortal, {
			...portalProps,
			children: /* @__PURE__ */ jsx(EditorSlashMenuPositioner, {
				...positionerProps,
				anchor,
				children: /* @__PURE__ */ jsxs(EditorSlashMenuPopup, {
					...popupProps,
					children: [/* @__PURE__ */ jsx(EditorSlashMenuList, {
						...listProps,
						ref: setListRef,
						children: (entry) => {
							if (isGroup(entry)) return /* @__PURE__ */ jsxs(EditorSlashMenuGroup, { children: [entry.label ? renderGroupLabel?.(entry.label) ?? /* @__PURE__ */ jsx(EditorSlashMenuGroupLabel, { children: entry.label }) : null, entry.items.map((item) => /* @__PURE__ */ createElement(MenuItemRenderer, {
								...menuItemProps,
								item,
								key: item.value
							}))] }, entry.label ?? entry.items.map((i) => i.value).join("|"));
							const item = entry;
							return /* @__PURE__ */ createElement(MenuItemRenderer, {
								...menuItemProps,
								item,
								key: item.value
							});
						}
					}), /* @__PURE__ */ jsx(EditorSlashMenuEmpty, { children: empty })]
				})
			})
		})]
	});
});
EditorSlashMenu.displayName = "EditorSlashMenu";
//#endregion
export { EditorSlashMenu as default };

//# sourceMappingURL=EditorSlashMenu.mjs.map