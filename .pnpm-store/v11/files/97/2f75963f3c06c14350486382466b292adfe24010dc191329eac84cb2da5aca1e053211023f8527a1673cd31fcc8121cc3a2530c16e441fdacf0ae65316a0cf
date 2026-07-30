"use client";
import { useIsClient } from "../../hooks/useIsClient.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { preventDefaultAndStopPropagation } from "../../utils/dom.mjs";
import { useLayerZIndex } from "../zIndex/useLayerZIndex.mjs";
import { styles } from "../DropdownMenu/sharedStyle.mjs";
import { registerDevSingleton } from "../../utils/devSingleton.mjs";
import { renderContextMenuItems } from "./renderItems.mjs";
import { closeContextMenu, getServerSnapshot, getSnapshot, setContextMenuState, subscribe, updateLastPointer } from "./store.mjs";
import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ContextMenu } from "@base-ui/react/context-menu";
//#region src/base-ui/ContextMenu/ContextMenuHost.tsx
const noAnimationStyles = { "--lobe-dropdown-animation-duration": "0ms" };
const ContextMenuHost = memo(() => {
	const isClient = useIsClient();
	const appElement = useAppElement();
	const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	useEffect(() => {
		const DEV = process.env.NODE_ENV === "development";
		if (!isClient || !DEV) return;
		return registerDevSingleton("ContextMenuHost", document.body);
	}, [isClient]);
	useEffect(() => {
		const handler = (event) => updateLastPointer(event);
		window.addEventListener("pointerdown", handler, true);
		window.addEventListener("contextmenu", handler, true);
		return () => {
			window.removeEventListener("pointerdown", handler, true);
			window.removeEventListener("contextmenu", handler, true);
		};
	}, []);
	const menuItems = useMemo(() => renderContextMenuItems(state.items, [], {
		iconAlign: state.iconAlign,
		iconSpaceMode: state.iconSpaceMode
	}), [
		state.items,
		state.iconAlign,
		state.iconSpaceMode
	]);
	const { zIndex, ref: zRef } = useLayerZIndex("floating");
	const hasSlots = state.header != null || state.footer != null;
	if (!isClient) return null;
	if (!state.open && state.items.length === 0) return null;
	return /* @__PURE__ */ jsx(ContextMenu.Root, {
		open: state.open,
		onOpenChange: (open) => {
			if (open) {
				setContextMenuState({ open });
				return;
			}
			closeContextMenu();
		},
		children: /* @__PURE__ */ jsx(ContextMenu.Portal, {
			container: appElement,
			children: /* @__PURE__ */ jsx(ContextMenu.Positioner, {
				anchor: state.anchor ?? void 0,
				className: styles.positioner,
				ref: zRef,
				sideOffset: 6,
				style: {
					...noAnimationStyles,
					zIndex
				},
				children: /* @__PURE__ */ jsxs(ContextMenu.Popup, {
					className: cx(styles.popup, hasSlots && styles.popupWithSlots),
					"data-has-footer": state.footer == null ? void 0 : "",
					"data-has-header": state.header == null ? void 0 : "",
					onContextMenu: preventDefaultAndStopPropagation,
					children: [
						state.header == null ? null : /* @__PURE__ */ jsx("div", {
							className: styles.header,
							children: state.header
						}),
						hasSlots ? /* @__PURE__ */ jsx("div", {
							className: styles.slotViewport,
							children: menuItems
						}) : menuItems,
						state.footer == null ? null : /* @__PURE__ */ jsx("div", {
							className: styles.footer,
							children: state.footer
						})
					]
				})
			})
		})
	});
});
ContextMenuHost.displayName = "ContextMenuHost";
//#endregion
export { ContextMenuHost };

//# sourceMappingURL=ContextMenuHost.mjs.map