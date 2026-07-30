"use client";
import { TooltipGroupHandleContext } from "./groupContext.mjs";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { useMergedTooltipProps } from "./useMergedTooltipProps.mjs";
import { cloneElement, isValidElement, use, useCallback, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { mergeProps } from "@base-ui/react/merge-props";
import { Tooltip } from "@base-ui/react/tooltip";
import { mergeRefs } from "react-merge-refs";
//#region src/base-ui/Tooltip/TooltipInGroup.tsx
const DEFAULT_OPEN_DELAY = 400;
const DEFAULT_CLOSE_DELAY = 100;
const TooltipInGroup = ({ children, ref: refProp, arrow, className, classNames, closeDelay, defaultOpen, disabled: disabledProp, getPopupContainer, hotkey, hotkeyProps, mouseEnterDelay, mouseLeaveDelay, onOpenChange, open, openDelay, placement, popupContainer, popupProps, portalProps, positionerProps, standalone: _standalone, styles, title, triggerProps: triggerPropsProp, zIndex, ...restProps }) => {
	const tooltipProps = useMemo(() => ({
		arrow,
		className,
		classNames,
		closeDelay,
		defaultOpen,
		disabled: disabledProp,
		getPopupContainer,
		hotkey,
		hotkeyProps,
		mouseEnterDelay,
		mouseLeaveDelay,
		onOpenChange,
		open,
		openDelay,
		placement,
		popupContainer,
		popupProps,
		portalProps,
		positionerProps,
		styles,
		title,
		triggerProps: triggerPropsProp,
		zIndex
	}), [
		arrow,
		className,
		classNames,
		closeDelay,
		defaultOpen,
		disabledProp,
		getPopupContainer,
		hotkey,
		hotkeyProps,
		mouseEnterDelay,
		mouseLeaveDelay,
		onOpenChange,
		open,
		openDelay,
		placement,
		popupContainer,
		popupProps,
		portalProps,
		positionerProps,
		styles,
		title,
		triggerPropsProp,
		zIndex
	]);
	const group = use(TooltipGroupHandleContext);
	const item = useMergedTooltipProps(tooltipProps);
	const resolvedOpenDelay = useMemo(() => {
		if (item.openDelay !== void 0) return item.openDelay;
		if (item.mouseEnterDelay !== void 0) return item.mouseEnterDelay * 1e3;
		return DEFAULT_OPEN_DELAY;
	}, [item.mouseEnterDelay, item.openDelay]);
	const resolvedCloseDelay = useMemo(() => {
		if (item.closeDelay !== void 0) return item.closeDelay;
		if (item.mouseLeaveDelay !== void 0) return item.mouseLeaveDelay * 1e3;
		return DEFAULT_CLOSE_DELAY;
	}, [item.closeDelay, item.mouseLeaveDelay]);
	const disabled = Boolean(item.disabled);
	const { isNativeButtonTriggerElement } = useNativeButton({ children });
	const childElement = isValidElement(children) ? children : null;
	const popupTriggerId = childElement && childElement.props["aria-haspopup"] !== void 0 && childElement.props.id !== void 0 ? childElement.props.id : void 0;
	const renderTrigger = useCallback((renderProps) => {
		const resolvedProps = (() => {
			if (isNativeButtonTriggerElement) return renderProps;
			const { type, ref: triggerRef, ...triggerRest } = renderProps;
			return triggerRest;
		})();
		const childProps = childElement.props;
		const mergedProps = mergeProps(restProps, childProps, resolvedProps);
		const shouldPreservePopupTriggerId = childProps["aria-haspopup"] !== void 0 && childProps.id !== void 0;
		return cloneElement(childElement, {
			...mergedProps,
			id: shouldPreservePopupTriggerId ? childProps.id : mergedProps.id,
			ref: mergeRefs([
				childElement.ref,
				renderProps.ref,
				refProp
			])
		});
	}, [
		childElement,
		isNativeButtonTriggerElement,
		refProp,
		restProps
	]);
	if (item.title == null && !item.hotkey) return children;
	const triggerProps = {
		closeDelay: resolvedCloseDelay,
		delay: resolvedOpenDelay,
		disabled,
		...item.triggerProps,
		id: popupTriggerId ?? item.triggerProps?.id,
		payload: item
	};
	if (childElement) return /* @__PURE__ */ jsx(Tooltip.Trigger, {
		handle: group ?? void 0,
		...triggerProps,
		render: renderTrigger
	});
	return /* @__PURE__ */ jsx(Tooltip.Trigger, {
		handle: group ?? void 0,
		...triggerProps,
		ref: refProp,
		children
	});
};
TooltipInGroup.displayName = "TooltipInGroup";
//#endregion
export { TooltipInGroup };

//# sourceMappingURL=TooltipInGroup.mjs.map