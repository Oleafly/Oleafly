"use client";
import { stopPropagation } from "../../utils/dom.mjs";
import Button from "../Button/Button.mjs";
import { styles } from "./style.mjs";
import { ModalBackdrop, ModalContent, ModalFooter, ModalHeader, ModalPopup, ModalPortal, ModalRoot, ModalTitle } from "./atoms.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { useDragControls } from "motion/react";
import { Maximize2, Minimize2, X } from "lucide-react";
//#region src/base-ui/Modal/Modal.tsx
const OkBtn = ({ confirmLoading, okButtonProps, okText, onOk }) => {
	const { onClick: userOnClick, ...restOk } = okButtonProps ?? {};
	return /* @__PURE__ */ jsx(Button, {
		loading: confirmLoading,
		type: "primary",
		...restOk,
		onClick: (e) => {
			onOk(e);
			userOnClick?.(e);
		},
		children: okText
	});
};
const CancelBtn = ({ cancelButtonProps, cancelText, onCancel }) => {
	const { onClick: userOnClick, ...restCancel } = cancelButtonProps ?? {};
	return /* @__PURE__ */ jsx(Button, {
		...restCancel,
		onClick: (e) => {
			onCancel(e);
			userOnClick?.(e);
		},
		children: cancelText
	});
};
const Modal = memo(({ open, title, children, onOk, onCancel, okText = "OK", cancelText = "Cancel", okButtonProps, cancelButtonProps, confirmLoading, footer, width, height, maskClosable = true, closable = true, closeIcon, className, style, classNames, styles: semanticStyles, zIndex, afterClose, afterOpenChange, loading, getContainer, mask = true, keyboard, draggable = true, allowFullscreen = false }) => {
	const dragControls = useDragControls();
	const constraintsRef = useRef(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [isDenying, setIsDenying] = useState(false);
	const denyTimerRef = useRef(void 0);
	useEffect(() => () => clearTimeout(denyTimerRef.current), []);
	const triggerDeny = useCallback(() => {
		clearTimeout(denyTimerRef.current);
		setIsDenying(true);
		denyTimerRef.current = setTimeout(() => setIsDenying(false), 300);
	}, []);
	const handleOpenChange = useCallback((nextOpen, eventDetails) => {
		if (!open) return;
		if (!nextOpen && keyboard === false && eventDetails.reason === "escape-key") return;
		if (!nextOpen && !maskClosable && eventDetails.reason === "outside-press") {
			triggerDeny();
			return;
		}
		if (!nextOpen) onCancel?.(new MouseEvent("click"));
	}, [
		onCancel,
		keyboard,
		maskClosable,
		open,
		triggerDeny
	]);
	const handleExitComplete = useCallback(() => {
		setIsFullscreen(false);
		afterClose?.();
		afterOpenChange?.(false);
	}, [afterClose, afterOpenChange]);
	const handleAnimationComplete = useCallback(() => {
		if (open) afterOpenChange?.(true);
	}, [open, afterOpenChange]);
	const handleDragStart = useCallback((e) => {
		if (draggable && !isFullscreen) {
			dragControls.start(e);
			setIsDragging(true);
		}
	}, [
		draggable,
		dragControls,
		isFullscreen
	]);
	const handleDragEnd = useCallback(() => {
		setIsDragging(false);
	}, []);
	const handleOk = useCallback((e) => {
		onOk?.(e);
	}, [onOk]);
	const handleCancel = useCallback((e) => {
		onCancel?.(e);
	}, [onCancel]);
	const footerNode = useMemo(() => {
		if (footer === false || footer === null) return null;
		const cancelBtnNode = /* @__PURE__ */ jsx(CancelBtn, {
			cancelButtonProps,
			cancelText,
			onCancel: handleCancel
		});
		const okBtnNode = /* @__PURE__ */ jsx(OkBtn, {
			confirmLoading,
			okButtonProps,
			okText,
			onOk: handleOk
		});
		const defaultFooter = /* @__PURE__ */ jsxs(Fragment$1, { children: [cancelBtnNode, okBtnNode] });
		if (typeof footer === "function") {
			const BoundCancelBtn = () => cancelBtnNode;
			const BoundOkBtn = () => okBtnNode;
			return footer(defaultFooter, {
				CancelBtn: BoundCancelBtn,
				OkBtn: BoundOkBtn
			});
		}
		return footer ?? defaultFooter;
	}, [
		footer,
		cancelButtonProps,
		cancelText,
		handleCancel,
		confirmLoading,
		okButtonProps,
		okText,
		handleOk
	]);
	const container = getContainer === false ? void 0 : getContainer ?? void 0;
	const shouldDrag = draggable && !isFullscreen;
	const dragProps = shouldDrag ? {
		drag: true,
		dragConstraints: constraintsRef,
		dragControls,
		dragElastic: 0,
		dragListener: false,
		dragMomentum: false,
		whileDrag: { cursor: "grabbing" }
	} : {};
	const showTitle = title !== void 0 && title !== false && title !== null;
	const showHeader = showTitle || closable || allowFullscreen;
	const hasHeight = height !== void 0;
	const panelStyle = {
		...hasHeight && !isFullscreen ? { height } : {},
		...style
	};
	return /* @__PURE__ */ jsx(ModalRoot, {
		open: open ?? false,
		zIndex,
		onExitComplete: handleExitComplete,
		onOpenChange: handleOpenChange,
		children: /* @__PURE__ */ jsxs(ModalPortal, {
			container,
			children: [mask && /* @__PURE__ */ jsx(ModalBackdrop, {
				className: classNames?.mask,
				style: semanticStyles?.mask
			}), /* @__PURE__ */ jsxs(ModalPopup, {
				className: classNames?.wrapper,
				popupStyle: semanticStyles?.wrapper,
				ref: constraintsRef,
				style: panelStyle,
				width: isFullscreen ? void 0 : width,
				motionProps: {
					...dragProps,
					onAnimationComplete: handleAnimationComplete
				},
				panelClassName: cx(className, isFullscreen && styles.fullscreenPopupInner, isDenying && styles.denyAnimation),
				children: [
					showHeader && /* @__PURE__ */ jsxs(ModalHeader, {
						className: cx(classNames?.header, shouldDrag && styles.headerDraggable),
						style: {
							...isDragging ? { cursor: "grabbing" } : {},
							...semanticStyles?.header
						},
						onPointerCancel: handleDragEnd,
						onPointerDown: handleDragStart,
						onPointerUp: handleDragEnd,
						children: [showTitle ? /* @__PURE__ */ jsx(ModalTitle, {
							className: classNames?.title,
							style: semanticStyles?.title,
							children: title
						}) : /* @__PURE__ */ jsx("span", {}), /* @__PURE__ */ jsxs("div", {
							className: styles.headerActions,
							onPointerDown: stopPropagation,
							children: [allowFullscreen && /* @__PURE__ */ jsx("button", {
								"aria-label": isFullscreen ? "Exit fullscreen" : "Fullscreen",
								className: styles.fullscreenToggle,
								type: "button",
								onClick: () => setIsFullscreen((prev) => !prev),
								children: isFullscreen ? /* @__PURE__ */ jsx(Minimize2, { size: 14 }) : /* @__PURE__ */ jsx(Maximize2, { size: 14 })
							}), closable && /* @__PURE__ */ jsx("button", {
								"aria-label": "Close",
								className: styles.closeInline,
								type: "button",
								onClick: handleCancel,
								children: closeIcon ?? /* @__PURE__ */ jsx(X, { size: 16 })
							})]
						})]
					}),
					/* @__PURE__ */ jsx(ModalContent, {
						className: classNames?.body,
						style: {
							...hasHeight || isFullscreen ? { flex: 1 } : {},
							...semanticStyles?.body
						},
						children: loading ? /* @__PURE__ */ jsx("div", {
							style: {
								display: "flex",
								justifyContent: "center",
								padding: "32px 0"
							},
							children: /* @__PURE__ */ jsx("span", {
								className: styles.loadingSpinner,
								style: {
									height: 24,
									width: 24
								}
							})
						}) : children
					}),
					footerNode !== null && /* @__PURE__ */ jsx(ModalFooter, {
						className: classNames?.footer,
						style: semanticStyles?.footer,
						children: footerNode
					})
				]
			})]
		})
	});
});
Modal.displayName = "Modal";
//#endregion
export { Modal as default };

//# sourceMappingURL=Modal.mjs.map