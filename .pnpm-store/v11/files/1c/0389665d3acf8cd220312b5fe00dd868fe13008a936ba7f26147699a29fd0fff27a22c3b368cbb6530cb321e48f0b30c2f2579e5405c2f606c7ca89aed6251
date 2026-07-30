"use client";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { styles } from "./sharedStyle.mjs";
import { DropdownMenuFooter, DropdownMenuHeader, DropdownMenuPopup, DropdownMenuPortal, DropdownMenuPositioner, DropdownMenuScrollViewport, DropdownMenuTrigger } from "./atoms.mjs";
import { parseTrigger } from "../../utils/parseTrigger.mjs";
import { renderDropdownMenuItems } from "./renderItems.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Menu } from "@base-ui/react/menu";
//#region src/base-ui/DropdownMenu/DropdownMenu.tsx
const DropdownMenu = memo(({ children, defaultOpen, footer, header, iconAlign, iconSpaceMode, items, nativeButton, onOpenChange, onOpenChangeComplete, open, placement = "bottomLeft", popupProps, portalProps, positionerProps, trigger = "click", triggerProps, ...rest }) => {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(Boolean(defaultOpen));
	const { openOnHover } = useMemo(() => parseTrigger(trigger), [trigger]);
	const resolvedOpenOnHover = triggerProps?.openOnHover ?? openOnHover;
	useEffect(() => {
		if (open === void 0) return;
		setUncontrolledOpen(open);
	}, [open]);
	const handleOpenChange = useCallback((nextOpen, details) => {
		onOpenChange?.(nextOpen, details);
		if (open === void 0) setUncontrolledOpen(nextOpen);
	}, [onOpenChange, open]);
	const menuItemsRef = useRef(null);
	const isOpen = open ?? uncontrolledOpen;
	const menuItems = useMemo(() => {
		if (isOpen) {
			const renderedItems = renderDropdownMenuItems(typeof items === "function" ? items() : items, [], {
				iconAlign,
				iconSpaceMode
			});
			menuItemsRef.current = renderedItems;
			return renderedItems;
		}
		return menuItemsRef.current;
	}, [
		isOpen,
		items,
		iconAlign,
		iconSpaceMode
	]);
	const handleOpenChangeComplete = useCallback((nextOpen) => {
		onOpenChangeComplete?.(nextOpen);
		if (!nextOpen) menuItemsRef.current = null;
	}, [onOpenChangeComplete]);
	const { container: portalContainer, ...restPortalProps } = portalProps ?? {};
	const { resolvedNativeButton } = useNativeButton({
		children,
		nativeButton,
		triggerNativeButton: triggerProps?.nativeButton
	});
	const hasSlots = header != null || footer != null;
	const triggerElement = /* @__PURE__ */ jsx(DropdownMenuTrigger, {
		...triggerProps,
		nativeButton: resolvedNativeButton,
		openOnHover: resolvedOpenOnHover,
		children
	});
	return /* @__PURE__ */ jsxs(Menu.Root, {
		...rest,
		defaultOpen,
		modal: false,
		open,
		onOpenChange: handleOpenChange,
		onOpenChangeComplete: handleOpenChangeComplete,
		children: [triggerElement, /* @__PURE__ */ jsx(DropdownMenuPortal, {
			container: portalContainer,
			...restPortalProps,
			children: /* @__PURE__ */ jsx(DropdownMenuPositioner, {
				...positionerProps,
				hoverTrigger: resolvedOpenOnHover,
				placement,
				children: /* @__PURE__ */ jsxs(DropdownMenuPopup, {
					...popupProps,
					"data-has-footer": footer == null ? void 0 : "",
					"data-has-header": header == null ? void 0 : "",
					className: hasSlots ? cx(styles.popupWithSlots, popupProps?.className) : popupProps?.className,
					children: [
						header == null ? null : /* @__PURE__ */ jsx(DropdownMenuHeader, { children: header }),
						hasSlots ? /* @__PURE__ */ jsx(DropdownMenuScrollViewport, { children: menuItems }) : menuItems,
						footer == null ? null : /* @__PURE__ */ jsx(DropdownMenuFooter, { children: footer })
					]
				})
			})
		})]
	});
});
DropdownMenu.displayName = "DropdownMenuV2";
//#endregion
export { DropdownMenu as default };

//# sourceMappingURL=DropdownMenu.mjs.map