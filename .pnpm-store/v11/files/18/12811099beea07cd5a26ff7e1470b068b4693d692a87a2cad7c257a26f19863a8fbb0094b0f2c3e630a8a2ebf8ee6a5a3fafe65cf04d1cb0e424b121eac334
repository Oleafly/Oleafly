import Icon from "../Icon/Icon.mjs";
import { isValidElement } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Menu/renderUtils.tsx
const getItemKey = (item, fallback) => {
	if (item && "key" in item && item.key !== void 0) return item.key;
	return fallback;
};
const getItemLabel = (item) => {
	if (item.label !== void 0) return item.label;
	if ("title" in item && item.title !== void 0) return item.title;
	return item.key;
};
const renderIcon = (icon, size) => {
	if (!icon) return null;
	if (isValidElement(icon)) return icon;
	return /* @__PURE__ */ jsx(Icon, {
		icon,
		size
	});
};
const hasAnyIcon = (items, recursive = false) => {
	return items.some((item) => {
		if (!item) return false;
		if (item.type === "checkbox") return true;
		if ("icon" in item && item.icon) return true;
		if (recursive && "children" in item && item.children) return hasAnyIcon(item.children, true);
		return false;
	});
};
const hasCheckboxAndIcon = (items) => {
	let hasCheckbox = false;
	let hasIcon = false;
	for (const item of items) {
		if (!item) continue;
		if (item.type === "checkbox") hasCheckbox = true;
		if ("icon" in item && item.icon) hasIcon = true;
		if (hasCheckbox && hasIcon) return true;
	}
	return false;
};
//#endregion
export { getItemKey, getItemLabel, hasAnyIcon, hasCheckboxAndIcon, renderIcon };

//# sourceMappingURL=renderUtils.mjs.map