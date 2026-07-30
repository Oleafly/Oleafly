"use client";
import { ModalBackdrop, ModalClose, ModalContent, ModalFooter, ModalHeader, ModalPopup, ModalPortal, ModalRoot, ModalTitle } from "../Modal/atoms.mjs";
import { styles } from "./style.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { X } from "lucide-react";
//#region src/base-ui/FloatingPanel/FloatingPanel.tsx
const DEFAULT_MIN_HEIGHT = 180;
const DEFAULT_MIN_WIDTH = 320;
const defaultMotionProps = {
	animate: {
		opacity: 1,
		scale: 1,
		x: 0,
		y: 0
	},
	exit: {
		opacity: 0,
		scale: .98,
		transition: {
			duration: .14,
			ease: [
				.4,
				0,
				1,
				1
			]
		},
		y: 12
	},
	initial: {
		opacity: 0,
		scale: .98,
		y: 12
	},
	transition: {
		duration: .2,
		ease: [
			.32,
			.72,
			0,
			1
		]
	}
};
const topMotionProps = {
	animate: {
		opacity: 1,
		scale: 1,
		x: 0,
		y: 0
	},
	exit: {
		opacity: 0,
		scale: .98,
		transition: {
			duration: .14,
			ease: [
				.4,
				0,
				1,
				1
			]
		},
		y: -12
	},
	initial: {
		opacity: 0,
		scale: .98,
		y: -12
	},
	transition: {
		duration: .2,
		ease: [
			.32,
			.72,
			0,
			1
		]
	}
};
const resolveOffset = (offset) => {
	if (typeof offset === "object") return {
		x: offset.x ?? 8,
		y: offset.y ?? 8
	};
	return {
		x: offset,
		y: offset
	};
};
const getPlacementStyle = (placement, offset) => {
	const { x, y } = resolveOffset(offset);
	const isTop = placement.startsWith("top");
	const isLeft = placement.endsWith("Left");
	return {
		alignItems: isTop ? "flex-start" : "flex-end",
		justifyContent: isLeft ? "flex-start" : "flex-end",
		paddingBlockEnd: isTop ? void 0 : y,
		paddingBlockStart: isTop ? y : void 0,
		paddingInlineEnd: isLeft ? void 0 : x,
		paddingInlineStart: isLeft ? x : void 0
	};
};
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const getViewportMaxSize = () => ({
	height: Math.max(DEFAULT_MIN_HEIGHT, window.innerHeight - 16),
	width: Math.max(DEFAULT_MIN_WIDTH, window.innerWidth - 16)
});
const getResizeHandles = (placement) => {
	switch (placement) {
		case "bottomLeft": return [
			"top",
			"right",
			"topRight"
		];
		case "topLeft": return [
			"bottom",
			"right",
			"bottomRight"
		];
		case "topRight": return [
			"bottom",
			"left",
			"bottomLeft"
		];
		default: return [
			"top",
			"left",
			"topLeft"
		];
	}
};
const getResizeHandleClassName = (s, handle) => {
	return {
		bottom: s.resizeHandleBottom,
		bottomLeft: s.resizeHandleBottomLeft,
		bottomRight: s.resizeHandleBottomRight,
		left: s.resizeHandleLeft,
		right: s.resizeHandleRight,
		top: s.resizeHandleTop,
		topLeft: s.resizeHandleTopLeft,
		topRight: s.resizeHandleTopRight
	}[handle];
};
const resolveResizeSize = ({ handle, maxHeight, maxWidth, minHeight, minWidth, startHeight, startWidth, startX, startY, x, y }) => {
	const deltaX = x - startX;
	const deltaY = y - startY;
	const growsLeft = handle.includes("Left") || handle === "left";
	const growsRight = handle.includes("Right") || handle === "right";
	const growsTop = handle.includes("top") || handle === "top";
	const growsBottom = handle.includes("bottom") || handle === "bottom";
	const nextWidth = growsLeft ? startWidth - deltaX : growsRight ? startWidth + deltaX : startWidth;
	const nextHeight = growsTop ? startHeight - deltaY : growsBottom ? startHeight + deltaY : startHeight;
	return {
		height: clamp(nextHeight, minHeight, maxHeight),
		width: clamp(nextWidth, minWidth, maxWidth)
	};
};
const FloatingPanel = memo(({ afterClose, ariaLabel, children, className, classNames, closable = true, closeIcon, closeLabel = "Close", defaultOpen, actions, footer, getContainer, height, keyboard = true, mask = false, maskClosable = true, maxHeight, maxWidth, minHeight = DEFAULT_MIN_HEIGHT, minWidth = DEFAULT_MIN_WIDTH, modal = false, motionProps, offset = 8, onClose, onOpenChange, onResize, onResizeEnd, open, placement = "bottomRight", resizable = true, styles: semanticStyles, title, width = 640, zIndex }) => {
	const s = styles;
	const isTop = placement.startsWith("top");
	const container = getContainer === false ? void 0 : getContainer;
	const [resizeSize, setResizeSize] = useState();
	const latestResizeSizeRef = useRef(void 0);
	const resizeCleanupRef = useRef(void 0);
	const activeResizeSize = resizeSize?.sourceWidth === width && resizeSize.sourceHeight === height ? resizeSize : void 0;
	useEffect(() => () => {
		resizeCleanupRef.current?.();
	}, []);
	const popupStyle = useMemo(() => ({
		...getPlacementStyle(placement, offset),
		...semanticStyles?.wrapper
	}), [
		offset,
		placement,
		semanticStyles?.wrapper
	]);
	const handleOpenChange = useCallback((nextOpen, eventDetails) => {
		if (!nextOpen) {
			if (keyboard === false && eventDetails.reason === "escape-key") return;
			if (maskClosable === false && eventDetails.reason === "outside-press") return;
			onClose?.();
		}
		onOpenChange?.(nextOpen, eventDetails);
	}, [
		keyboard,
		maskClosable,
		onClose,
		onOpenChange
	]);
	const showHeader = title !== void 0 || actions !== void 0 || closable;
	const resolvedMotionProps = motionProps ?? (isTop ? topMotionProps : defaultMotionProps);
	const resizeHandles = useMemo(() => getResizeHandles(placement), [placement]);
	const handleResizeStart = useCallback((handle) => (event) => {
		event.preventDefault();
		event.stopPropagation();
		const panel = event.currentTarget.parentElement;
		if (!panel) return;
		const rect = panel.getBoundingClientRect();
		const viewportMaxSize = getViewportMaxSize();
		const resolvedMaxWidth = Math.max(minWidth, maxWidth ?? viewportMaxSize.width);
		const resolvedMaxHeight = Math.max(minHeight, maxHeight ?? viewportMaxSize.height);
		const startX = event.clientX;
		const startY = event.clientY;
		const handleResizeMove = (moveEvent) => {
			const nextSize = resolveResizeSize({
				handle,
				maxHeight: resolvedMaxHeight,
				maxWidth: resolvedMaxWidth,
				minHeight,
				minWidth,
				startHeight: rect.height,
				startWidth: rect.width,
				startX,
				startY,
				x: moveEvent.clientX,
				y: moveEvent.clientY
			});
			const nextState = {
				...nextSize,
				sourceHeight: height,
				sourceWidth: width
			};
			latestResizeSizeRef.current = nextSize;
			setResizeSize(nextState);
			onResize?.(nextSize);
		};
		const handleResizeEnd = () => {
			resizeCleanupRef.current?.();
			resizeCleanupRef.current = void 0;
			if (latestResizeSizeRef.current) onResizeEnd?.(latestResizeSizeRef.current);
		};
		resizeCleanupRef.current?.();
		window.addEventListener("pointermove", handleResizeMove);
		window.addEventListener("pointerup", handleResizeEnd);
		resizeCleanupRef.current = () => {
			window.removeEventListener("pointermove", handleResizeMove);
			window.removeEventListener("pointerup", handleResizeEnd);
		};
	}, [
		height,
		maxHeight,
		maxWidth,
		minHeight,
		minWidth,
		onResize,
		onResizeEnd,
		width
	]);
	return /* @__PURE__ */ jsx(ModalRoot, {
		defaultOpen,
		modal,
		open,
		zIndex,
		onExitComplete: afterClose,
		onOpenChange: handleOpenChange,
		children: /* @__PURE__ */ jsxs(ModalPortal, {
			container,
			children: [mask && /* @__PURE__ */ jsx(ModalBackdrop, {
				className: classNames?.backdrop,
				style: semanticStyles?.backdrop
			}), /* @__PURE__ */ jsxs(ModalPopup, {
				"aria-label": ariaLabel,
				className: cx(s.wrapper, classNames?.wrapper),
				motionProps: resolvedMotionProps,
				panelClassName: cx(s.panel, isTop && s.panelTop, className, classNames?.panel),
				popupStyle,
				width: activeResizeSize?.width ?? width,
				style: {
					height: activeResizeSize?.height ?? height,
					minHeight,
					minWidth,
					width: activeResizeSize?.width,
					...semanticStyles?.panel
				},
				children: [
					resizable && resizeHandles.map((handle) => /* @__PURE__ */ jsx("div", {
						"aria-hidden": true,
						"data-floating-panel-resize-handle": handle,
						style: semanticStyles?.resizeHandle,
						className: cx(s.resizeHandle, getResizeHandleClassName(s, handle), classNames?.resizeHandle),
						onPointerDown: handleResizeStart(handle)
					}, handle)),
					showHeader && /* @__PURE__ */ jsxs(ModalHeader, {
						className: cx(s.header, classNames?.header),
						style: semanticStyles?.header,
						children: [title !== void 0 ? /* @__PURE__ */ jsx(ModalTitle, {
							className: cx(s.title, classNames?.title),
							style: semanticStyles?.title,
							children: title
						}) : /* @__PURE__ */ jsx("span", {}), /* @__PURE__ */ jsxs("div", {
							className: s.headerActions,
							children: [actions && /* @__PURE__ */ jsx("div", {
								className: cx(s.actions, classNames?.actions),
								style: semanticStyles?.actions,
								children: actions
							}), closable && /* @__PURE__ */ jsx(ModalClose, {
								"aria-label": closeLabel,
								className: cx(s.close, classNames?.close),
								style: semanticStyles?.close,
								children: closeIcon ?? /* @__PURE__ */ jsx(X, { size: 16 })
							})]
						})]
					}),
					/* @__PURE__ */ jsx(ModalContent, {
						className: cx(s.body, classNames?.body),
						style: semanticStyles?.body,
						children
					}),
					footer && /* @__PURE__ */ jsx(ModalFooter, {
						className: cx(s.footer, classNames?.footer),
						style: semanticStyles?.footer,
						children: footer
					})
				]
			})]
		})
	});
});
FloatingPanel.displayName = "FloatingPanel";
//#endregion
export { FloatingPanel };

//# sourceMappingURL=FloatingPanel.mjs.map