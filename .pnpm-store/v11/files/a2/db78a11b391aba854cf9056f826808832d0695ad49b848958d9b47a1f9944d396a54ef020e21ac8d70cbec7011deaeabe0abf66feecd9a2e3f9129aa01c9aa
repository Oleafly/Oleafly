"use client";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { FloatingLayerProvider } from "../../hooks/useFloatingLayer.mjs";
import { placementMap } from "../../utils/placement.mjs";
import { useLayerZIndex } from "../zIndex/useLayerZIndex.mjs";
import { PopoverArrowIcon } from "./ArrowIcon.mjs";
import { usePopoverPortalContainer } from "./PopoverPortal.mjs";
import { styles } from "./style.mjs";
import { cloneElement, isValidElement, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { mergeProps } from "@base-ui/react/merge-props";
import { mergeRefs, useMergeRefs } from "react-merge-refs";
import { Popover } from "@base-ui/react/popover";
//#region src/base-ui/Popover/atoms.tsx
const PopoverRoot = Popover.Root;
const PopoverBackdrop = Popover.Backdrop;
const PopoverTriggerElement = ({ children, className, nativeButton, ref: refProp, ...rest }) => {
	const { isNativeButtonTriggerElement, resolvedNativeButton } = useNativeButton({
		children,
		nativeButton
	});
	if (isValidElement(children)) return /* @__PURE__ */ jsx(Popover.Trigger, {
		...rest,
		nativeButton: resolvedNativeButton,
		render: (props, state) => {
			const resolvedProps = (() => {
				if (isNativeButtonTriggerElement) return props;
				const { type, ref: triggerRef, ...restProps } = props;
				return restProps;
			})();
			const mergedProps = mergeProps(children.props, resolvedProps);
			const baseClassName = typeof mergedProps.className === "function" ? mergedProps.className(state) : mergedProps.className;
			const extraClassName = typeof className === "function" ? className(state) : className;
			return cloneElement(children, {
				...mergedProps,
				className: cx(baseClassName, extraClassName),
				ref: mergeRefs([
					children.ref,
					props.ref,
					refProp
				])
			});
		}
	});
	return /* @__PURE__ */ jsx(Popover.Trigger, {
		...rest,
		className,
		nativeButton: resolvedNativeButton,
		ref: refProp,
		children
	});
};
PopoverTriggerElement.displayName = "PopoverTriggerElement";
const PopoverPortal = ({ container, root, children, ...rest }) => {
	const defaultContainer = usePopoverPortalContainer(root);
	const resolvedContainer = container ?? defaultContainer;
	if (!resolvedContainer) return null;
	return /* @__PURE__ */ jsx(Popover.Portal, {
		container: resolvedContainer,
		...rest,
		children
	});
};
PopoverPortal.displayName = "PopoverPortal";
const PopoverPositioner = ({ children, className, hoverTrigger, placement, align, side, sideOffset, style, ...rest }) => {
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
	return /* @__PURE__ */ jsx(Popover.Positioner, {
		align: align ?? placementConfig?.align ?? "center",
		"data-hover-trigger": hoverTrigger || void 0,
		"data-placement": placement,
		ref: composedRef,
		side: side ?? placementConfig?.side ?? "bottom",
		sideOffset: sideOffset ?? 6,
		style: resolvedStyle,
		className: (state) => cx(styles.positioner, typeof className === "function" ? className(state) : className),
		...rest,
		children: /* @__PURE__ */ jsx(FloatingLayerProvider, {
			value: positionerNode,
			children
		})
	});
};
PopoverPositioner.displayName = "PopoverPositioner";
const PopoverPopup = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Popover.Popup, {
		className: (state) => cx(styles.popup, typeof className === "function" ? className(state) : className),
		...rest
	});
};
PopoverPopup.displayName = "PopoverPopup";
const PopoverArrow = ({ className, children, ...rest }) => {
	return /* @__PURE__ */ jsx(Popover.Arrow, {
		className: (state) => cx(styles.arrow, typeof className === "function" ? className(state) : className),
		...rest,
		children: children ?? PopoverArrowIcon
	});
};
PopoverArrow.displayName = "PopoverArrow";
const PopoverViewport = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Popover.Viewport, {
		className: (state) => cx(styles.viewport, typeof className === "function" ? className(state) : className),
		...rest
	});
};
PopoverViewport.displayName = "PopoverViewport";
//#endregion
export { PopoverArrow, PopoverBackdrop, PopoverPopup, PopoverPortal, PopoverPositioner, PopoverRoot, PopoverTriggerElement, PopoverViewport };

//# sourceMappingURL=atoms.mjs.map