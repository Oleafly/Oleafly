"use client";
import { placementMap } from "../../utils/placement.mjs";
import { useDestroyOnInvalidActiveTriggerElement, useHidePopupWhenPositionerAtOrigin } from "../../utils/destroyOnInvalidActiveTriggerElement.mjs";
import { parseTrigger } from "../../utils/parseTrigger.mjs";
import { PopoverArrowIcon } from "./ArrowIcon.mjs";
import { usePopoverPortalContainer } from "./PopoverPortal.mjs";
import { PopoverArrow, PopoverPopup, PopoverPortal, PopoverPositioner, PopoverViewport } from "./atoms.mjs";
import { PopoverProvider } from "./context.mjs";
import { PopoverGroupHandleContext, PopoverGroupPropsContext } from "./groupContext.mjs";
import { shouldCancelHoverOnlyPressOpen } from "./hoverOnlyPress.mjs";
import { useCallback, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Popover } from "@base-ui/react/popover";
//#region src/base-ui/Popover/PopoverGroup.tsx
const PopoverGroup = ({ children, contentLayoutAnimation = false, disableDestroyOnInvalidTrigger = false, disableZeroOriginGuard = false, ...sharedProps }) => {
	const [{ handle, key }, setHandleState] = useState(() => ({
		handle: Popover.createHandle(),
		key: 0
	}));
	const activeItemRef = useRef(null);
	const destroy = useCallback(() => {
		activeItemRef.current = null;
		setHandleState(({ key }) => ({
			handle: Popover.createHandle(),
			key: key + 1
		}));
	}, []);
	const close = useCallback(() => {
		handle.close();
	}, [handle]);
	const contextValue = useMemo(() => ({ close }), [close]);
	const handleOpenChange = useCallback((nextOpen, eventDetails) => {
		const item = activeItemRef.current;
		const { openOnClick } = parseTrigger(item?.trigger ?? "hover");
		if (shouldCancelHoverOnlyPressOpen(openOnClick, nextOpen, eventDetails?.reason)) {
			eventDetails?.cancel?.();
			return;
		}
		item?.onOpenChange?.(nextOpen);
	}, []);
	useDestroyOnInvalidActiveTriggerElement(handle.store, destroy, { enabled: !disableDestroyOnInvalidTrigger });
	useHidePopupWhenPositionerAtOrigin(handle.store, { enabled: !disableZeroOriginGuard });
	const portalContainer = usePopoverPortalContainer();
	return /* @__PURE__ */ jsx(PopoverGroupHandleContext, {
		value: handle,
		children: /* @__PURE__ */ jsxs(PopoverGroupPropsContext, {
			value: sharedProps,
			children: [children, /* @__PURE__ */ jsx(Popover.Root, {
				handle,
				onOpenChange: handleOpenChange,
				children: ({ payload }) => {
					const item = payload ?? null;
					activeItemRef.current = item;
					if (!item?.content) return null;
					const arrow = item.arrow ?? false;
					const placement = item.placement ?? "top";
					const { openOnHover } = parseTrigger(item.trigger ?? "hover");
					const placementConfig = placementMap[placement] ?? placementMap.top;
					const resolvedSideOffset = arrow ? 10 : 6;
					const resolvedClassNames = {
						arrow: item.classNames?.arrow,
						popup: item.className,
						positioner: item.classNames?.root,
						viewport: item.classNames?.content
					};
					const resolvedStyles = {
						arrow: item.styles?.arrow,
						positioner: {
							...item.styles?.root,
							...item.zIndex !== void 0 ? { zIndex: item.zIndex } : {}
						},
						viewport: item.styles?.content
					};
					const contentNode = /* @__PURE__ */ jsx(PopoverProvider, {
						value: contextValue,
						children: item.content
					});
					const popup = /* @__PURE__ */ jsx(PopoverPositioner, {
						align: placementConfig.align,
						className: resolvedClassNames.positioner,
						"data-layout-animation": contentLayoutAnimation || void 0,
						hoverTrigger: openOnHover,
						placement,
						side: placementConfig.side,
						sideOffset: resolvedSideOffset,
						style: resolvedStyles.positioner,
						...item.positionerProps,
						children: /* @__PURE__ */ jsxs(PopoverPopup, {
							className: resolvedClassNames.popup,
							"data-layout-animation": contentLayoutAnimation || void 0,
							...item.popupProps,
							children: [arrow && /* @__PURE__ */ jsx(PopoverArrow, {
								className: resolvedClassNames.arrow,
								style: resolvedStyles.arrow,
								children: PopoverArrowIcon
							}), /* @__PURE__ */ jsx(PopoverViewport, {
								className: resolvedClassNames.viewport,
								style: resolvedStyles.viewport,
								children: contentNode
							})]
						})
					});
					return portalContainer ? /* @__PURE__ */ jsx(PopoverPortal, {
						container: portalContainer,
						children: popup
					}) : null;
				}
			}, key)]
		})
	});
};
PopoverGroup.displayName = "PopoverGroup";
//#endregion
export { PopoverGroup as default };

//# sourceMappingURL=PopoverGroup.mjs.map