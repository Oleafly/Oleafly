"use client";
import { useMotionComponent } from "../../MotionProvider/index.mjs";
import { useNativeButton } from "../../hooks/useNativeButton.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { useLayerZIndex } from "../zIndex/useLayerZIndex.mjs";
import { backdropTransition, modalMotionConfig } from "./constants.mjs";
import { ModalLayerProvider, useModalLayer } from "./ModalLayerContext.mjs";
import { styles } from "./style.mjs";
import { cloneElement, createContext, createElement, isValidElement, use, useCallback, useEffect, useMemo, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { AnimatePresence } from "motion/react";
import { mergeProps } from "@base-ui/react/merge-props";
import { mergeRefs, useMergeRefs } from "react-merge-refs";
import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
//#region src/base-ui/Modal/atoms.tsx
const mergeStateClassName = (base, className) => {
	if (typeof className === "function") return (state) => cx(base, className(state));
	return cx(base, className);
};
const ModalOpenContext = createContext(null);
const ModalActionsContext = createContext(null);
const useModalOpen = () => use(ModalOpenContext);
const useModalActions = () => use(ModalActionsContext);
const AnimatedModalRoot = ({ open, children, onExitComplete: onExitCompleteProp, zIndex: explicitZIndex, ...rest }) => {
	const [isPresent, setIsPresent] = useState(!!open);
	useEffect(() => {
		if (open) setIsPresent(true);
	}, [open]);
	const handleExitComplete = useCallback(() => {
		setIsPresent(false);
		onExitCompleteProp?.();
	}, [onExitCompleteProp]);
	const actions = useMemo(() => ({ onExitComplete: handleExitComplete }), [handleExitComplete]);
	const { zIndex, ref: popupRef } = useLayerZIndex("modal", explicitZIndex);
	const layer = useMemo(() => ({
		popupRef,
		zIndex
	}), [zIndex, popupRef]);
	if (!isPresent) return null;
	return /* @__PURE__ */ jsx(ModalOpenContext, {
		value: open,
		children: /* @__PURE__ */ jsx(ModalActionsContext, {
			value: actions,
			children: /* @__PURE__ */ jsx(ModalLayerProvider, {
				value: layer,
				children: /* @__PURE__ */ jsx(Dialog.Root, {
					modal: true,
					open: true,
					...rest,
					children
				})
			})
		})
	});
};
const NonAnimatedModalRoot = ({ zIndex: explicitZIndex, children, ...rest }) => {
	const { zIndex, ref: popupRef } = useLayerZIndex("modal", explicitZIndex);
	return /* @__PURE__ */ jsx(ModalLayerProvider, {
		value: useMemo(() => ({
			popupRef,
			zIndex
		}), [zIndex, popupRef]),
		children: /* @__PURE__ */ jsx(Dialog.Root, {
			modal: true,
			...rest,
			children
		})
	});
};
const ModalRoot = ({ open, onExitComplete, ...rest }) => {
	if (open !== void 0) return /* @__PURE__ */ jsx(AnimatedModalRoot, {
		open,
		onExitComplete,
		...rest
	});
	return /* @__PURE__ */ jsx(NonAnimatedModalRoot, { ...rest });
};
const ModalPortal = ({ container, ...rest }) => {
	const appElement = useAppElement();
	return /* @__PURE__ */ jsx(Dialog.Portal, {
		container: container ?? appElement ?? void 0,
		...rest
	});
};
const ModalViewport = ({ className, ...rest }) => /* @__PURE__ */ jsx(Dialog.Viewport, {
	...rest,
	className: mergeStateClassName(styles.viewport, className)
});
const ModalBackdrop = ({ className, style, ...rest }) => {
	const open = useModalOpen();
	const layer = useModalLayer();
	const Motion = useMotionComponent();
	const layerStyle = layer?.zIndex !== void 0 ? { zIndex: layer.zIndex } : void 0;
	if (open !== null) return /* @__PURE__ */ jsx(Dialog.Backdrop, {
		...rest,
		className: cx(styles.backdrop, className),
		style: {
			...layerStyle,
			...style,
			transition: "none"
		},
		render: /* @__PURE__ */ jsx(Motion.div, {
			animate: { opacity: open ? 1 : 0 },
			initial: { opacity: 0 },
			transition: backdropTransition
		})
	});
	return /* @__PURE__ */ jsx(Dialog.Backdrop, {
		...rest,
		className: mergeStateClassName(styles.backdrop, className),
		style: {
			...layerStyle,
			...style
		}
	});
};
const ModalPopup = ({ className, children, width, style, motionProps, panelClassName, popupStyle, ref: forwardedRef, ...rest }) => {
	const open = useModalOpen();
	const actions = useModalActions();
	const layer = useModalLayer();
	const Motion = useMotionComponent();
	const popupZIndexStyle = layer?.zIndex !== void 0 ? { zIndex: layer.zIndex + 1 } : void 0;
	const composedRef = useMergeRefs([forwardedRef, layer?.popupRef]);
	if (open !== null && actions) return /* @__PURE__ */ jsx(Dialog.Popup, {
		...rest,
		className: cx(styles.popup, className),
		ref: composedRef,
		style: {
			...popupZIndexStyle,
			...popupStyle
		},
		children: /* @__PURE__ */ jsx(AnimatePresence, {
			onExitComplete: actions.onExitComplete,
			children: open ? /* @__PURE__ */ createElement(Motion.div, {
				...modalMotionConfig,
				...motionProps,
				className: cx(styles.popupInner, panelClassName),
				key: "modal-popup-panel",
				style: {
					maxWidth: width ?? void 0,
					transition: "none",
					...style
				}
			}, children) : null
		})
	});
	return /* @__PURE__ */ jsx(Dialog.Popup, {
		...rest,
		className: mergeStateClassName(styles.popup, className),
		ref: composedRef,
		style: {
			...popupZIndexStyle,
			...popupStyle
		},
		children: /* @__PURE__ */ jsx("div", {
			className: cx(styles.popupInner, panelClassName),
			style: {
				maxWidth: width ?? void 0,
				...style
			},
			children
		})
	});
};
const ModalHeader = ({ className, ...rest }) => /* @__PURE__ */ jsx("div", {
	...rest,
	className: cx(styles.header, className)
});
const ModalTitle = ({ className, ...rest }) => /* @__PURE__ */ jsx(Dialog.Title, {
	...rest,
	className: mergeStateClassName(styles.title, className)
});
const ModalDescription = Dialog.Description;
const ModalContent = ({ className, ...rest }) => /* @__PURE__ */ jsx("div", {
	...rest,
	className: cx(styles.content, className)
});
const ModalFooter = ({ className, ...rest }) => /* @__PURE__ */ jsx("div", {
	...rest,
	className: cx(styles.footer, className)
});
const ModalClose = ({ className, children, ...rest }) => /* @__PURE__ */ jsx(Dialog.Close, {
	...rest,
	className: mergeStateClassName(styles.close, className),
	children: children ?? /* @__PURE__ */ jsx(X, { size: 16 })
});
const ModalTrigger = ({ children, className, nativeButton, ref: refProp, ...rest }) => {
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
		return cloneElement(children, {
			...mergeProps(children.props, resolvedProps),
			ref: mergeRefs([
				children.ref,
				props.ref,
				refProp
			])
		});
	};
	if (isValidElement(children)) return /* @__PURE__ */ jsx(Dialog.Trigger, {
		...rest,
		className,
		nativeButton: resolvedNativeButton,
		render: renderer
	});
	return /* @__PURE__ */ jsx(Dialog.Trigger, {
		...rest,
		className,
		nativeButton: resolvedNativeButton,
		ref: refProp,
		children
	});
};
//#endregion
export { ModalBackdrop, ModalClose, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalPopup, ModalPortal, ModalRoot, ModalTitle, ModalTrigger, ModalViewport, useModalActions, useModalOpen };

//# sourceMappingURL=atoms.mjs.map