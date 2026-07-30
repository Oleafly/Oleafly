"use client";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { useIsClient } from "../../hooks/useIsClient.mjs";
import { placementMap } from "../../utils/placement.mjs";
import { parseTrigger } from "../../utils/parseTrigger.mjs";
import { PopoverArrowIcon } from "./ArrowIcon.mjs";
import { usePopoverPortalContainer } from "./PopoverPortal.mjs";
import { PopoverArrow, PopoverPopup, PopoverPortal, PopoverPositioner, PopoverRoot, PopoverTriggerElement, PopoverViewport } from "./atoms.mjs";
import { PopoverProvider } from "./context.mjs";
import { shouldCancelHoverOnlyPressOpen } from "./hoverOnlyPress.mjs";
import { memo, useCallback, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Popover } from "@base-ui/react/popover";
//#region src/base-ui/Popover/PopoverStandalone.tsx
/**
* Popover component - displays floating content relative to a trigger element
* Compatible with Ant Design Popover API
*/
const PopoverStandalone = memo(({ children, content, arrow = false, trigger = "hover", placement = "top", styles: styleProps, classNames, className, open, onOpenChange, defaultOpen = false, mouseEnterDelay = .1, mouseLeaveDelay = .1, openDelay, closeDelay, getPopupContainer, disabled = false, zIndex, nativeButton, ref: refProp, positionerProps, triggerProps, popupProps, backdropProps, portalProps }) => {
	const isClient = useIsClient();
	const popoverHandle = useMemo(() => Popover.createHandle(), []);
	const [uncontrolledOpen, setUncontrolledOpen] = useState(Boolean(defaultOpen));
	const close = useCallback(() => {
		popoverHandle.close();
	}, [popoverHandle]);
	const contextValue = useMemo(() => ({ close }), [close]);
	const resolvedOpen = disabled ? false : open ?? uncontrolledOpen;
	const { openOnClick, openOnHover } = useMemo(() => parseTrigger(trigger), [trigger]);
	const handleOpenChange = useCallback((nextOpen, eventDetails) => {
		if (disabled && nextOpen) return;
		if (shouldCancelHoverOnlyPressOpen(openOnClick, nextOpen, eventDetails?.reason)) {
			eventDetails?.cancel?.();
			return;
		}
		onOpenChange?.(nextOpen);
		if (open === void 0) setUncontrolledOpen(nextOpen);
	}, [
		onOpenChange,
		open,
		disabled,
		openOnClick
	]);
	const resolvedOpenDelay = openDelay ?? mouseEnterDelay * 1e3;
	const resolvedCloseDelay = closeDelay ?? mouseLeaveDelay * 1e3;
	const placementConfig = placementMap[placement] ?? placementMap.top;
	const resolvedSideOffset = arrow ? 10 : 6;
	const portalContainer = usePopoverPortalContainer();
	const { resolvedNativeButton } = useNativeButton({
		children,
		nativeButton
	});
	const resolvedClassNames = useMemo(() => ({
		arrow: classNames?.arrow,
		popup: className,
		positioner: classNames?.root,
		trigger: classNames?.trigger,
		viewport: classNames?.content
	}), [
		className,
		classNames?.arrow,
		classNames?.content,
		classNames?.root,
		classNames?.trigger
	]);
	const triggerElement = useMemo(() => {
		const baseTriggerProps = {
			closeDelay: resolvedCloseDelay,
			delay: resolvedOpenDelay,
			disabled,
			openOnHover: openOnHover && !disabled,
			...triggerProps
		};
		return /* @__PURE__ */ jsx(PopoverTriggerElement, {
			handle: popoverHandle,
			...baseTriggerProps,
			className: resolvedClassNames.trigger,
			nativeButton: resolvedNativeButton,
			ref: refProp,
			children
		});
	}, [
		children,
		disabled,
		openOnHover,
		popoverHandle,
		refProp,
		resolvedClassNames.trigger,
		resolvedNativeButton,
		resolvedOpenDelay,
		resolvedCloseDelay,
		triggerProps
	]);
	const customContainer = useMemo(() => {
		if (!getPopupContainer || !isClient) return void 0;
	}, [getPopupContainer, isClient]);
	const resolvedStyles = useMemo(() => ({
		arrow: styleProps?.arrow,
		positioner: {
			...styleProps?.root,
			...zIndex !== void 0 ? { zIndex } : {}
		},
		viewport: styleProps?.content
	}), [
		styleProps?.arrow,
		styleProps?.content,
		styleProps?.root,
		zIndex
	]);
	const popup = useMemo(() => /* @__PURE__ */ jsx(PopoverPositioner, {
		align: placementConfig.align,
		className: resolvedClassNames.positioner,
		hoverTrigger: openOnHover,
		placement,
		side: placementConfig.side,
		sideOffset: resolvedSideOffset,
		style: resolvedStyles.positioner,
		...positionerProps,
		children: /* @__PURE__ */ jsxs(PopoverPopup, {
			className: resolvedClassNames.popup,
			...popupProps,
			children: [arrow && /* @__PURE__ */ jsx(PopoverArrow, {
				className: resolvedClassNames.arrow,
				style: resolvedStyles.arrow,
				children: PopoverArrowIcon
			}), /* @__PURE__ */ jsx(PopoverViewport, {
				className: resolvedClassNames.viewport,
				style: resolvedStyles.viewport,
				children: /* @__PURE__ */ jsx(PopoverProvider, {
					value: contextValue,
					children: content
				})
			})]
		})
	}), [
		arrow,
		content,
		contextValue,
		openOnHover,
		placement,
		placementConfig.align,
		placementConfig.side,
		popupProps,
		positionerProps,
		resolvedClassNames,
		resolvedSideOffset,
		resolvedStyles
	]);
	if (!content) return children;
	const resolvedPortalContainer = customContainer ?? portalContainer;
	return /* @__PURE__ */ jsxs(PopoverRoot, {
		defaultOpen,
		handle: popoverHandle,
		open: resolvedOpen,
		onOpenChange: handleOpenChange,
		children: [
			triggerElement,
			backdropProps && /* @__PURE__ */ jsx(Popover.Backdrop, { ...backdropProps }),
			resolvedPortalContainer ? /* @__PURE__ */ jsx(PopoverPortal, {
				container: resolvedPortalContainer,
				...portalProps,
				children: popup
			}) : null
		]
	});
});
PopoverStandalone.displayName = "PopoverStandalone";
//#endregion
export { PopoverStandalone };

//# sourceMappingURL=PopoverStandalone.mjs.map