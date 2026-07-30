"use client";
import { IconProvider } from "../Icon/components/IconProvider.mjs";
import { mapItems } from "../Menu/utils.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { Dropdown } from "antd";
//#region src/Dropdown/Dropdown.tsx
/**
* @deprecated
* Use `DropdownMenu` or `ContextMenu` instead
* @see https://ui.lobehub.com/components/context-menu
* @see https://ui.lobehub.com/components/dropdown-menu
*/
const Dropdown$1 = memo(({ children, iconProps, menu, ...rest }) => {
	const { items, ...menuProps } = menu;
	const antdItems = useMemo(() => items.map((item) => mapItems(item)), [items]);
	return /* @__PURE__ */ jsx(IconProvider, {
		config: {
			size: "small",
			...iconProps
		},
		children: /* @__PURE__ */ jsx(Dropdown, {
			menu: {
				...menuProps,
				items: antdItems
			},
			...rest,
			children
		})
	});
});
Dropdown$1.displayName = "Dropdown";
//#endregion
export { Dropdown$1 as default };

//# sourceMappingURL=Dropdown.mjs.map