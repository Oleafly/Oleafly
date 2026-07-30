"use client";
import { TooltipGroupPropsContext } from "./groupContext.mjs";
import { useContext, useMemo } from "react";
//#region src/base-ui/Tooltip/useMergedTooltipProps.ts
const useMergedTooltipProps = (props) => {
	const sharedProps = useContext(TooltipGroupPropsContext);
	const { arrow, className, classNames, closeDelay, disabled, getPopupContainer, hotkey, hotkeyProps, mouseEnterDelay, mouseLeaveDelay, onOpenChange, openDelay, placement, popupContainer, styles: styleProps, title, zIndex, positionerProps, triggerProps, popupProps } = props;
	const mergedClassName = useMemo(() => {
		if (!sharedProps?.className && !className) return void 0;
		return [sharedProps?.className, className].filter(Boolean).join(" ");
	}, [className, sharedProps?.className]);
	const mergedClassNames = useMemo(() => {
		if (!sharedProps?.classNames && !classNames) return void 0;
		return {
			...sharedProps?.classNames,
			...classNames
		};
	}, [classNames, sharedProps?.classNames]);
	const resolvedSharedStyles = useMemo(() => {
		if (typeof sharedProps?.styles === "function") return void 0;
		return sharedProps?.styles;
	}, [sharedProps?.styles]);
	const resolvedLocalStyles = useMemo(() => {
		if (typeof styleProps === "function") return void 0;
		return styleProps;
	}, [styleProps]);
	const mergedStyles = useMemo(() => {
		if (!resolvedSharedStyles && !resolvedLocalStyles) return void 0;
		return {
			...resolvedSharedStyles,
			...resolvedLocalStyles
		};
	}, [resolvedSharedStyles, resolvedLocalStyles]);
	const mergedHotkeyProps = useMemo(() => {
		if (!sharedProps?.hotkeyProps && !hotkeyProps) return void 0;
		return {
			...sharedProps?.hotkeyProps,
			...hotkeyProps
		};
	}, [hotkeyProps, sharedProps?.hotkeyProps]);
	const mergedOnOpenChange = useMemo(() => {
		if (!sharedProps?.onOpenChange && !onOpenChange) return void 0;
		return (open) => {
			sharedProps?.onOpenChange?.(open);
			onOpenChange?.(open);
		};
	}, [onOpenChange, sharedProps?.onOpenChange]);
	return useMemo(() => ({
		arrow: arrow ?? sharedProps?.arrow ?? false,
		className: mergedClassName,
		classNames: mergedClassNames,
		closeDelay: closeDelay ?? sharedProps?.closeDelay,
		disabled: disabled ?? sharedProps?.disabled,
		getPopupContainer: getPopupContainer ?? sharedProps?.getPopupContainer,
		hotkey: hotkey ?? sharedProps?.hotkey,
		popupContainer: popupContainer ?? sharedProps?.popupContainer,
		hotkeyProps: mergedHotkeyProps,
		mouseEnterDelay: mouseEnterDelay ?? sharedProps?.mouseEnterDelay,
		mouseLeaveDelay: mouseLeaveDelay ?? sharedProps?.mouseLeaveDelay,
		onOpenChange: mergedOnOpenChange,
		openDelay: openDelay ?? sharedProps?.openDelay,
		placement: placement ?? sharedProps?.placement ?? "top",
		popupProps: popupProps ?? sharedProps?.popupProps,
		positionerProps: positionerProps ?? sharedProps?.positionerProps,
		styles: mergedStyles,
		title,
		triggerProps: triggerProps ?? sharedProps?.triggerProps,
		zIndex: zIndex ?? sharedProps?.zIndex
	}), [
		arrow,
		closeDelay,
		disabled,
		getPopupContainer,
		hotkey,
		mergedClassName,
		mergedClassNames,
		mergedHotkeyProps,
		mergedOnOpenChange,
		mergedStyles,
		mouseEnterDelay,
		mouseLeaveDelay,
		openDelay,
		placement,
		popupContainer,
		popupProps,
		positionerProps,
		sharedProps?.arrow,
		sharedProps?.closeDelay,
		sharedProps?.disabled,
		sharedProps?.getPopupContainer,
		sharedProps?.hotkey,
		sharedProps?.mouseEnterDelay,
		sharedProps?.mouseLeaveDelay,
		sharedProps?.onOpenChange,
		sharedProps?.openDelay,
		sharedProps?.placement,
		sharedProps?.popupContainer,
		sharedProps?.popupProps,
		sharedProps?.positionerProps,
		sharedProps?.triggerProps,
		sharedProps?.zIndex,
		title,
		triggerProps,
		zIndex
	]);
};
//#endregion
export { useMergedTooltipProps };

//# sourceMappingURL=useMergedTooltipProps.mjs.map