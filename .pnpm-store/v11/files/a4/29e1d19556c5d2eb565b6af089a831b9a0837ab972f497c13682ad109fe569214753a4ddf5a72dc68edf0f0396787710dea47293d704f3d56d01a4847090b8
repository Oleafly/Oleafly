"use client";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { useFloatingLayer } from "../../hooks/useFloatingLayer.mjs";
import { useIsClient } from "../../hooks/useIsClient.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { placementMap } from "../../utils/placement.mjs";
import { TooltipArrowIcon } from "./ArrowIcon.mjs";
import { styles } from "./style.mjs";
import TooltipContent from "./TooltipContent.mjs";
import { cloneElement, isValidElement, memo, useCallback, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { mergeProps } from "@base-ui/react/merge-props";
import { Tooltip } from "@base-ui/react/tooltip";
import { mergeRefs } from "react-merge-refs";
//#region src/base-ui/Tooltip/TooltipStandalone.tsx
const DEFAULT_OPEN_DELAY = 400;
const DEFAULT_CLOSE_DELAY = 100;
/**
* Tooltip component - displays small contextual hints on hover/focus
* Compatible with Ant Design Tooltip-like API (subset)
*/
const TooltipStandalone = memo(({ children, title, arrow = false, className, classNames, closeDelay, defaultOpen = false, disabled = false, getPopupContainer, hotkey, hotkeyProps, mouseEnterDelay, mouseLeaveDelay, onOpenChange, open, openDelay, placement = "top", popupContainer, styles: styleProps, zIndex, ref: refProp, positionerProps, triggerProps, popupProps, portalProps, standalone: _standalone, ...restProps }) => {
	const isClient = useIsClient();
	const [uncontrolledOpen, setUncontrolledOpen] = useState(Boolean(defaultOpen));
	const [triggerNode, setTriggerNode] = useState(null);
	const triggerCallbackRef = useCallback((node) => {
		if (node) setTriggerNode(node);
	}, []);
	const resolvedOpen = disabled ? false : open ?? uncontrolledOpen;
	const handleOpenChange = useCallback((nextOpen) => {
		if (disabled && nextOpen) return;
		onOpenChange?.(nextOpen);
		if (open === void 0) setUncontrolledOpen(nextOpen);
	}, [
		disabled,
		onOpenChange,
		open
	]);
	const resolvedOpenDelay = useMemo(() => {
		if (openDelay !== void 0) return openDelay;
		if (mouseEnterDelay !== void 0) return mouseEnterDelay * 1e3;
		return DEFAULT_OPEN_DELAY;
	}, [mouseEnterDelay, openDelay]);
	const resolvedCloseDelay = useMemo(() => {
		if (closeDelay !== void 0) return closeDelay;
		if (mouseLeaveDelay !== void 0) return mouseLeaveDelay * 1e3;
		return DEFAULT_CLOSE_DELAY;
	}, [closeDelay, mouseLeaveDelay]);
	const placementConfig = placementMap[placement] ?? placementMap.top;
	const baseSideOffset = arrow ? 8 : 6;
	const appElement = useAppElement();
	const portalContainer = useFloatingLayer() ?? appElement;
	const { isNativeButtonTriggerElement } = useNativeButton({ children });
	const resolvedClassNames = useMemo(() => ({
		arrow: cx(styles.arrow, classNames?.arrow),
		popup: cx(styles.popup, className, classNames?.root, classNames?.container),
		positioner: styles.positioner,
		viewport: cx(styles.viewport, classNames?.content)
	}), [
		className,
		classNames?.arrow,
		classNames?.container,
		classNames?.content,
		classNames?.root
	]);
	const resolvedStyleProps = useMemo(() => {
		if (typeof styleProps === "function") return void 0;
		return styleProps;
	}, [styleProps]);
	const resolvedStyles = useMemo(() => ({
		arrow: resolvedStyleProps?.arrow,
		popup: {
			...resolvedStyleProps?.root,
			...resolvedStyleProps?.container
		},
		positioner: { zIndex: zIndex ?? 114514 },
		viewport: resolvedStyleProps?.content
	}), [resolvedStyleProps, zIndex]);
	const triggerElement = useMemo(() => {
		const popupTriggerId = isValidElement(children) && children.props["aria-haspopup"] !== void 0 && children.props.id !== void 0 ? children.props.id : void 0;
		const baseTriggerProps = {
			closeDelay: resolvedCloseDelay,
			delay: resolvedOpenDelay,
			disabled,
			...triggerProps,
			id: popupTriggerId ?? triggerProps?.id
		};
		if (isValidElement(children)) return /* @__PURE__ */ jsx(Tooltip.Trigger, {
			...baseTriggerProps,
			render: (props) => {
				const resolvedProps = (() => {
					if (isNativeButtonTriggerElement) return props;
					const { type, ref: triggerRef, ...triggerRest } = props;
					return triggerRest;
				})();
				const childProps = children.props;
				const mergedProps = mergeProps(restProps, childProps, resolvedProps);
				const shouldPreservePopupTriggerId = childProps["aria-haspopup"] !== void 0 && childProps.id !== void 0;
				return cloneElement(children, {
					...mergedProps,
					id: shouldPreservePopupTriggerId ? childProps.id : mergedProps.id,
					ref: mergeRefs([
						children.ref,
						props.ref,
						refProp,
						triggerCallbackRef
					])
				});
			}
		});
		return /* @__PURE__ */ jsx(Tooltip.Trigger, {
			...baseTriggerProps,
			ref: mergeRefs([refProp, triggerCallbackRef]),
			children
		});
	}, [
		children,
		disabled,
		isNativeButtonTriggerElement,
		refProp,
		resolvedCloseDelay,
		resolvedOpenDelay,
		restProps,
		triggerCallbackRef,
		triggerProps
	]);
	const customContainer = useMemo(() => {
		if (popupContainer) return popupContainer;
		if (!getPopupContainer || !isClient || !triggerNode) return void 0;
		return getPopupContainer(triggerNode);
	}, [
		popupContainer,
		getPopupContainer,
		isClient,
		triggerNode
	]);
	const popup = useMemo(() => /* @__PURE__ */ jsx(Tooltip.Positioner, {
		align: placementConfig.align,
		className: resolvedClassNames.positioner,
		"data-placement": placement,
		side: placementConfig.side,
		sideOffset: baseSideOffset,
		style: resolvedStyles.positioner,
		...positionerProps,
		children: /* @__PURE__ */ jsxs(Tooltip.Popup, {
			className: resolvedClassNames.popup,
			style: resolvedStyles.popup,
			...popupProps,
			children: [arrow && /* @__PURE__ */ jsx(Tooltip.Arrow, {
				className: resolvedClassNames.arrow,
				style: resolvedStyles.arrow,
				children: TooltipArrowIcon
			}), /* @__PURE__ */ jsx(Tooltip.Viewport, {
				className: resolvedClassNames.viewport,
				style: resolvedStyles.viewport,
				children: /* @__PURE__ */ jsx(TooltipContent, {
					hotkey,
					hotkeyProps,
					title
				})
			})]
		})
	}), [
		arrow,
		baseSideOffset,
		hotkey,
		hotkeyProps,
		placement,
		placementConfig.align,
		placementConfig.side,
		popupProps,
		positionerProps,
		resolvedClassNames,
		resolvedStyles,
		title
	]);
	if (title == null && !hotkey) return children;
	const resolvedPortalContainer = customContainer ?? portalContainer;
	return /* @__PURE__ */ jsxs(Tooltip.Root, {
		defaultOpen,
		disabled,
		open: resolvedOpen,
		onOpenChange: handleOpenChange,
		children: [triggerElement, resolvedPortalContainer ? /* @__PURE__ */ jsx(Tooltip.Portal, {
			container: resolvedPortalContainer,
			...portalProps,
			children: popup
		}) : null]
	});
});
TooltipStandalone.displayName = "TooltipStandalone";
//#endregion
export { TooltipStandalone };

//# sourceMappingURL=TooltipStandalone.mjs.map