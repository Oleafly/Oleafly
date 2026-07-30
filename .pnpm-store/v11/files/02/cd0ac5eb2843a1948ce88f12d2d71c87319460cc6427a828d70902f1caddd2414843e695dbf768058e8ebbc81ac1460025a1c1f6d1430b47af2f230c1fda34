"use client";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { useLayerZIndex } from "../zIndex/useLayerZIndex.mjs";
import { styles } from "../DropdownMenu/sharedStyle.mjs";
import { styles as styles$1, triggerVariants } from "./style.mjs";
import { cloneElement, isValidElement } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { mergeProps } from "@base-ui/react/merge-props";
import { mergeRefs, useMergeRefs } from "react-merge-refs";
import { Select } from "@base-ui/react/select";
//#region src/base-ui/Select/atoms.tsx
const mergeStateClassName = (base, className) => {
	if (typeof className === "function") return (state) => cx(base, className(state));
	return cx(base, className);
};
const SelectRoot = Select.Root;
const SelectBackdrop = Select.Backdrop;
const SelectSeparator = Select.Separator;
const SelectTrigger = ({ children, className, nativeButton, shadow, size = "middle", variant, ref: refProp, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const baseClassName = triggerVariants({
		shadow,
		size,
		variant: variant ?? (isDarkMode ? "filled" : "outlined")
	});
	const { isNativeButtonTriggerElement, resolvedNativeButton } = useNativeButton({
		children,
		nativeButton
	});
	if (isValidElement(children)) return /* @__PURE__ */ jsx(Select.Trigger, {
		...rest,
		nativeButton: resolvedNativeButton,
		render: (props, state) => {
			const resolvedProps = (() => {
				if (isNativeButtonTriggerElement) return props;
				const { type, ref: triggerRef, ...restProps } = props;
				return restProps;
			})();
			const mergedProps = mergeProps(children.props, resolvedProps);
			const childClassName = typeof mergedProps.className === "function" ? mergedProps.className(state) : mergedProps.className;
			const extraClassName = typeof className === "function" ? className(state) : className;
			return cloneElement(children, {
				...mergedProps,
				className: cx(baseClassName, childClassName, extraClassName),
				ref: mergeRefs([
					children.ref,
					props.ref,
					refProp
				])
			});
		}
	});
	return /* @__PURE__ */ jsx(Select.Trigger, {
		...rest,
		className: mergeStateClassName(baseClassName, className),
		nativeButton: resolvedNativeButton,
		ref: refProp,
		children
	});
};
SelectTrigger.displayName = "SelectTrigger";
const SelectIcon = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.Icon, {
		className: mergeStateClassName(styles$1.icon, className),
		...rest
	});
};
SelectIcon.displayName = "SelectIcon";
const SelectValue = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.Value, {
		className: mergeStateClassName(styles$1.value, className),
		...rest
	});
};
SelectValue.displayName = "SelectValue";
const SelectPortal = ({ container, ...rest }) => {
	const appElement = useAppElement();
	return /* @__PURE__ */ jsx(Select.Portal, {
		container: container ?? appElement ?? void 0,
		...rest
	});
};
SelectPortal.displayName = "SelectPortal";
const SelectPositioner = ({ align, alignItemWithTrigger, className, side, sideOffset, style, ref: forwardedRef, ...rest }) => {
	const { zIndex, ref: zRef } = useLayerZIndex("floating", typeof style !== "function" && style?.zIndex != null && typeof style.zIndex === "number" ? style.zIndex : void 0);
	const composedRef = useMergeRefs([forwardedRef, zRef]);
	const resolvedStyle = typeof style === "function" ? (state) => ({
		zIndex,
		...style(state)
	}) : {
		zIndex,
		...style
	};
	return /* @__PURE__ */ jsx(Select.Positioner, {
		align: align ?? "start",
		alignItemWithTrigger: alignItemWithTrigger ?? false,
		className: mergeStateClassName(styles$1.positioner, className),
		ref: composedRef,
		side: side ?? "bottom",
		sideOffset: sideOffset ?? 6,
		style: resolvedStyle,
		...rest
	});
};
SelectPositioner.displayName = "SelectPositioner";
const SelectPopup = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.Popup, {
		className: mergeStateClassName(cx(styles.popup, styles$1.popup), className),
		...rest
	});
};
SelectPopup.displayName = "SelectPopup";
const SelectList = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.List, {
		className: mergeStateClassName(styles$1.list, className),
		...rest
	});
};
SelectList.displayName = "SelectList";
const SelectItem = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.Item, {
		className: mergeStateClassName(cx(styles.item, styles$1.item), className),
		...rest
	});
};
SelectItem.displayName = "SelectItem";
const SelectItemText = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.ItemText, {
		className: mergeStateClassName(cx(styles.label, styles$1.itemText), className),
		...rest
	});
};
SelectItemText.displayName = "SelectItemText";
const SelectItemIndicator = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.ItemIndicator, {
		className: mergeStateClassName(styles$1.itemIndicator, className),
		...rest
	});
};
SelectItemIndicator.displayName = "SelectItemIndicator";
const SelectGroup = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.Group, {
		className: mergeStateClassName(styles$1.group, className),
		...rest
	});
};
SelectGroup.displayName = "SelectGroup";
const SelectGroupLabel = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.GroupLabel, {
		className: mergeStateClassName(cx(styles.groupLabel, styles$1.groupLabel), className),
		...rest
	});
};
SelectGroupLabel.displayName = "SelectGroupLabel";
const SelectScrollUpArrow = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.ScrollUpArrow, {
		className: mergeStateClassName(styles$1.scrollArrow, className),
		...rest
	});
};
SelectScrollUpArrow.displayName = "SelectScrollUpArrow";
const SelectScrollDownArrow = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.ScrollDownArrow, {
		className: mergeStateClassName(styles$1.scrollArrow, className),
		...rest
	});
};
SelectScrollDownArrow.displayName = "SelectScrollDownArrow";
const SelectArrow = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Select.Arrow, {
		className: mergeStateClassName(styles$1.arrow, className),
		...rest
	});
};
SelectArrow.displayName = "SelectArrow";
//#endregion
export { SelectArrow, SelectBackdrop, SelectGroup, SelectGroupLabel, SelectIcon, SelectItem, SelectItemIndicator, SelectItemText, SelectList, SelectPopup, SelectPortal, SelectPositioner, SelectRoot, SelectScrollDownArrow, SelectScrollUpArrow, SelectSeparator, SelectTrigger, SelectValue };

//# sourceMappingURL=atoms.mjs.map