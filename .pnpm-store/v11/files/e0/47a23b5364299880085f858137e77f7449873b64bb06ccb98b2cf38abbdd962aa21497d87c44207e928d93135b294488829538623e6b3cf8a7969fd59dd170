"use client";
import { CLASSNAMES } from "../../styles/classNames.mjs";
import { getServerSnapshot, getSnapshot, showContextMenu, subscribe } from "./store.mjs";
import React, { cloneElement, isValidElement, memo, useCallback, useId, useSyncExternalStore } from "react";
import { jsx } from "react/jsx-runtime";
import { mergeProps } from "@base-ui/react/merge-props";
import clsx from "clsx";
//#region src/base-ui/ContextMenu/ContextMenuTrigger.tsx
const styles = { trigger: { display: "contents" } };
const ContextMenuTrigger = memo(({ children, footer, header, items, onContextMenu, ...rest }) => {
	const triggerId = useId();
	const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	const open = state.open && state.triggerId === triggerId;
	const handleContextMenu = useCallback((event) => {
		if (items) {
			event.preventDefault();
			showContextMenu(typeof items === "function" ? items() : items, {
				footer,
				header
			});
		}
		onContextMenu?.(event);
	}, [
		items,
		onContextMenu,
		footer,
		header
	]);
	const triggerProps = {
		...rest,
		"aria-expanded": open || void 0,
		"className": clsx(CLASSNAMES.ContextTrigger, rest.className),
		"data-contextmenu-trigger": triggerId,
		"data-popup-open": open ? "" : void 0,
		"data-state": open ? "open" : void 0,
		"onContextMenu": handleContextMenu
	};
	if (isValidElement(children) && React.Children.only(children)) return cloneElement(children, mergeProps(children.props, triggerProps));
	return /* @__PURE__ */ jsx("span", {
		style: styles.trigger,
		...triggerProps,
		children
	});
});
ContextMenuTrigger.displayName = "ContextMenuTrigger";
//#endregion
export { ContextMenuTrigger };

//# sourceMappingURL=ContextMenuTrigger.mjs.map