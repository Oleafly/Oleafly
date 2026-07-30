import { EditorSlashMenuItem, EditorSlashMenuItemContent, EditorSlashMenuItemExtra, EditorSlashMenuItemIcon, EditorSlashMenuItemLabel } from "./atoms.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/EditorSlashMenu/MenuItemRenderer.tsx
const DefaultItemContent = memo(({ item, hasAnyIcon, reserveIconSpace }) => /* @__PURE__ */ jsxs(EditorSlashMenuItemContent, { children: [
	/* @__PURE__ */ jsx(EditorSlashMenuItemIcon, {
		"aria-hidden": !hasAnyIcon && !reserveIconSpace,
		children: item.icon ?? (reserveIconSpace && hasAnyIcon ? /* @__PURE__ */ jsx("span", {}) : null)
	}),
	/* @__PURE__ */ jsx(EditorSlashMenuItemLabel, { children: item.label }),
	item.extra ? /* @__PURE__ */ jsx(EditorSlashMenuItemExtra, { children: item.extra }) : null
] }));
DefaultItemContent.displayName = "DefaultItemContent";
const MenuItemRenderer = memo(({ hasAnyIcon, item, onSelect, renderItem, reserveIconSpace }) => {
	const content = renderItem?.(item) ?? /* @__PURE__ */ jsx(DefaultItemContent, {
		hasAnyIcon,
		item,
		reserveIconSpace
	});
	return /* @__PURE__ */ jsx(EditorSlashMenuItem, {
		danger: item.danger,
		disabled: item.disabled,
		value: item,
		onClick: (e) => {
			if (item.disabled) {
				e.preventDefault();
				return;
			}
			onSelect(item, {
				event: e,
				reason: "item-press"
			});
		},
		children: content
	}, item.value);
});
MenuItemRenderer.displayName = "MenuItemRenderer";
//#endregion
export { MenuItemRenderer };

//# sourceMappingURL=MenuItemRenderer.mjs.map