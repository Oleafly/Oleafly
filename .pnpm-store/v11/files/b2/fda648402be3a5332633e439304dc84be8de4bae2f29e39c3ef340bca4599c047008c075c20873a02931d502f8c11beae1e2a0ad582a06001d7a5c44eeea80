"use client";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { FloatingLayerProvider } from "../../hooks/useFloatingLayer.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { CLASSNAMES } from "../../styles/classNames.mjs";
import { placementMap } from "../../utils/placement.mjs";
import Switch from "../Switch/Switch.mjs";
import { useLayerZIndex } from "../zIndex/useLayerZIndex.mjs";
import { styles } from "./sharedStyle.mjs";
import { cloneElement, isValidElement, useCallback, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { mergeProps } from "@base-ui/react/merge-props";
import { mergeRefs, useMergeRefs } from "react-merge-refs";
import { Menu } from "@base-ui/react/menu";
import clsx from "clsx";
//#region src/base-ui/DropdownMenu/atoms.tsx
const DropdownMenuRoot = (props) => /* @__PURE__ */ jsx(Menu.Root, {
	modal: false,
	...props
});
const DropdownMenuSubmenuRoot = Menu.SubmenuRoot;
const DropdownMenuCheckboxItemIndicator = Menu.CheckboxItemIndicator;
const mergeStateClassName = (base, className) => {
	if (typeof className === "function") return (state) => cx(base, className(state));
	return cx(base, className);
};
const DropdownMenuTrigger = ({ children, className, nativeButton, ref: refProp, ...rest }) => {
	const { isNativeButtonTriggerElement, resolvedNativeButton } = useNativeButton({
		children,
		nativeButton
	});
	const renderer = (props) => {
		const resolvedProps = (() => {
			if (isNativeButtonTriggerElement) return props;
			const { type, ...restProps } = props;
			return restProps;
		})();
		const mergedProps = mergeProps(children.props, resolvedProps);
		return cloneElement(children, {
			...mergedProps,
			className: clsx(CLASSNAMES.DropdownMenuTrigger, className, mergedProps.className),
			ref: mergeRefs([
				children.ref,
				props.ref,
				refProp
			])
		});
	};
	if (isValidElement(children)) return /* @__PURE__ */ jsx(Menu.Trigger, {
		...rest,
		nativeButton: resolvedNativeButton,
		render: renderer
	});
	return /* @__PURE__ */ jsx(Menu.Trigger, {
		...rest,
		className: clsx(CLASSNAMES.DropdownMenuTrigger, className),
		nativeButton: resolvedNativeButton,
		ref: refProp,
		children
	});
};
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";
const DropdownMenuPortal = ({ container, ...rest }) => {
	const appElement = useAppElement();
	return /* @__PURE__ */ jsx(Menu.Portal, {
		container: container ?? appElement ?? void 0,
		...rest
	});
};
DropdownMenuPortal.displayName = "DropdownMenuPortal";
const DropdownMenuPositioner = ({ className, placement, hoverTrigger, align, side, sideOffset, children, style, ...rest }) => {
	const placementConfig = placement ? placementMap[placement] : void 0;
	const [positionerNode, setPositionerNode] = useState(null);
	const { zIndex, ref: zRef } = useLayerZIndex("floating", typeof style !== "function" && style?.zIndex != null && typeof style.zIndex === "number" ? style.zIndex : void 0);
	const composedRef = useMergeRefs([setPositionerNode, zRef]);
	const resolvedStyle = typeof style === "function" ? (state) => ({
		zIndex,
		...style(state)
	}) : {
		zIndex,
		...style
	};
	return /* @__PURE__ */ jsx(Menu.Positioner, {
		...rest,
		align: align ?? placementConfig?.align,
		className: mergeStateClassName(styles.positioner, className),
		"data-hover-trigger": hoverTrigger || void 0,
		"data-placement": placement,
		ref: composedRef,
		side: side ?? placementConfig?.side,
		sideOffset: sideOffset ?? (placementConfig ? 6 : void 0),
		style: resolvedStyle,
		children: /* @__PURE__ */ jsx(FloatingLayerProvider, {
			value: positionerNode,
			children
		})
	});
};
DropdownMenuPositioner.displayName = "DropdownMenuPositioner";
const DropdownMenuPopup = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Menu.Popup, {
		...rest,
		className: mergeStateClassName(styles.popup, className)
	});
};
DropdownMenuPopup.displayName = "DropdownMenuPopup";
const DropdownMenuHeader = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("div", {
		...rest,
		className: cx(styles.header, className)
	});
};
DropdownMenuHeader.displayName = "DropdownMenuHeader";
const DropdownMenuFooter = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("div", {
		...rest,
		className: cx(styles.footer, className)
	});
};
DropdownMenuFooter.displayName = "DropdownMenuFooter";
const DropdownMenuScrollViewport = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("div", {
		...rest,
		className: cx(styles.slotViewport, className)
	});
};
DropdownMenuScrollViewport.displayName = "DropdownMenuScrollViewport";
const DropdownMenuItem = ({ className, danger, ...rest }) => {
	return /* @__PURE__ */ jsx(Menu.Item, {
		...rest,
		className: (state) => cx(styles.item, danger && styles.danger, typeof className === "function" ? className(state) : className)
	});
};
DropdownMenuItem.displayName = "DropdownMenuItem";
const DropdownMenuCheckboxItemPrimitive = ({ className, danger, ...rest }) => {
	return /* @__PURE__ */ jsx(Menu.CheckboxItem, {
		...rest,
		className: (state) => cx(styles.item, danger && styles.danger, typeof className === "function" ? className(state) : className)
	});
};
DropdownMenuCheckboxItemPrimitive.displayName = "DropdownMenuCheckboxItemPrimitive";
const DropdownMenuSeparator = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Menu.Separator, {
		...rest,
		className: (state) => cx(styles.separator, typeof className === "function" ? className(state) : className)
	});
};
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
const DropdownMenuGroup = Menu.Group;
const DropdownMenuGroupLabel = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Menu.GroupLabel, {
		...rest,
		className: (state) => cx(styles.groupLabel, typeof className === "function" ? className(state) : className)
	});
};
DropdownMenuGroupLabel.displayName = "DropdownMenuGroupLabel";
const DropdownMenuSubmenuTrigger = ({ className, danger, ...rest }) => {
	return /* @__PURE__ */ jsx(Menu.SubmenuTrigger, {
		...rest,
		className: (state) => cx(styles.item, danger && styles.danger, typeof className === "function" ? className(state) : className)
	});
};
DropdownMenuSubmenuTrigger.displayName = "DropdownMenuSubmenuTrigger";
const DropdownMenuItemContent = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("div", {
		...rest,
		className: cx(styles.itemContent, className)
	});
};
DropdownMenuItemContent.displayName = "DropdownMenuItemContent";
const DropdownMenuItemIcon = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.icon, className)
	});
};
DropdownMenuItemIcon.displayName = "DropdownMenuItemIcon";
const DropdownMenuItemLabelGroup = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("div", {
		...rest,
		className: cx(styles.labelGroup, className)
	});
};
DropdownMenuItemLabelGroup.displayName = "DropdownMenuItemLabelGroup";
const DropdownMenuItemLabel = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.label, className)
	});
};
DropdownMenuItemLabel.displayName = "DropdownMenuItemLabel";
const DropdownMenuItemDesc = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.desc, className)
	});
};
DropdownMenuItemDesc.displayName = "DropdownMenuItemDesc";
const DropdownMenuItemExtra = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.extra, className)
	});
};
DropdownMenuItemExtra.displayName = "DropdownMenuItemExtra";
const DropdownMenuSubmenuArrow = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.submenuArrow, className)
	});
};
DropdownMenuSubmenuArrow.displayName = "DropdownMenuSubmenuArrow";
const DropdownMenuSwitchItem = ({ checked: checkedProp, className, closeOnClick = false, danger, defaultChecked, disabled, onCheckedChange, children, ...rest }) => {
	const [internalChecked, setInternalChecked] = useState(defaultChecked ?? false);
	const isControlled = checkedProp !== void 0;
	const checked = isControlled ? checkedProp : internalChecked;
	const handleCheckedChange = useCallback((newChecked) => {
		if (!isControlled) setInternalChecked(newChecked);
		onCheckedChange?.(newChecked);
	}, [isControlled, onCheckedChange]);
	return /* @__PURE__ */ jsxs(Menu.Item, {
		...rest,
		closeOnClick,
		disabled,
		className: (state) => cx(styles.item, danger && styles.danger, typeof className === "function" ? className(state) : className),
		onClick: (e) => {
			e.preventDefault();
			if (!disabled) handleCheckedChange(!checked);
		},
		children: [children, /* @__PURE__ */ jsx("span", {
			style: {
				display: "inline-flex",
				marginInlineStart: 16
			},
			onFocus: (e) => e.stopPropagation(),
			children: /* @__PURE__ */ jsx(Switch, {
				checked,
				disabled,
				size: "small",
				tabIndex: -1,
				onChange: handleCheckedChange,
				onClick: (_, e) => e.stopPropagation()
			})
		})]
	});
};
DropdownMenuSwitchItem.displayName = "DropdownMenuSwitchItem";
//#endregion
export { DropdownMenuCheckboxItemIndicator, DropdownMenuCheckboxItemPrimitive, DropdownMenuFooter, DropdownMenuGroup, DropdownMenuGroupLabel, DropdownMenuHeader, DropdownMenuItem, DropdownMenuItemContent, DropdownMenuItemDesc, DropdownMenuItemExtra, DropdownMenuItemIcon, DropdownMenuItemLabel, DropdownMenuItemLabelGroup, DropdownMenuPopup, DropdownMenuPortal, DropdownMenuPositioner, DropdownMenuRoot, DropdownMenuScrollViewport, DropdownMenuSeparator, DropdownMenuSubmenuArrow, DropdownMenuSubmenuRoot, DropdownMenuSubmenuTrigger, DropdownMenuSwitchItem, DropdownMenuTrigger };

//# sourceMappingURL=atoms.mjs.map