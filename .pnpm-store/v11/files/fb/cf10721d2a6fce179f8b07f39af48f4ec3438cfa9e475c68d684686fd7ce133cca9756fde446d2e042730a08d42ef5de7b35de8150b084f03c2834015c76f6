import { styles } from "./style.mjs";
import { FloatingSheetHeader } from "./FloatingSheetHeader.mjs";
import { clamp, dampenValue, resolveSize } from "./helpers.mjs";
import { useSheetDrag } from "./useSheetDrag.mjs";
import { useSnapPoints } from "./useSnapPoints.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/base-ui/FloatingSheet/FloatingSheet.tsx
const ANIMATION_MS = 300;
function FloatingSheet({ open: openProp, onOpenChange, defaultOpen = false, snapPoints: snapPointsProp, activeSnapPoint: activeSnapPointProp, onSnapPointChange, minHeight: minHeightProp = 200, maxHeight: maxHeightProp = .8, restingHeight: restingHeightProp, mode = "overlay", variant = "elevated", width = "100%", title, headerActions, dismissible = true, closeThreshold = .25, children, className }) {
	const s = styles;
	const isControlled = openProp !== void 0;
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const isOpen = isControlled ? openProp : internalOpen;
	const setOpen = useCallback((value) => {
		if (!isControlled) setInternalOpen(value);
		onOpenChange?.(value);
	}, [isControlled, onOpenChange]);
	const containerRef = useRef(null);
	const sheetRef = useRef(null);
	const [containerHeight, setContainerHeight] = useState(0);
	useEffect(() => {
		const parent = sheetRef.current?.parentElement;
		if (!parent) return;
		containerRef.current = parent;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) setContainerHeight(entry.contentRect.height);
		});
		observer.observe(parent);
		setContainerHeight(parent.getBoundingClientRect().height);
		return () => observer.disconnect();
	}, []);
	const minHeightPx = useMemo(() => resolveSize(minHeightProp, containerHeight), [minHeightProp, containerHeight]);
	const maxHeightPx = useMemo(() => resolveSize(maxHeightProp, containerHeight), [maxHeightProp, containerHeight]);
	const restingHeightPx = useMemo(() => restingHeightProp !== void 0 ? clamp(resolveSize(restingHeightProp, containerHeight), minHeightPx, maxHeightPx) : minHeightPx, [
		restingHeightProp,
		containerHeight,
		minHeightPx,
		maxHeightPx
	]);
	const hasSnapPoints = !!snapPointsProp && snapPointsProp.length > 0;
	const { snapPointHeights, findActiveIndex, getSnapRelease } = useSnapPoints({
		closeThreshold,
		containerHeight,
		containerRef,
		maxHeightPx,
		minHeightPx,
		snapPoints: snapPointsProp ?? []
	});
	const restingHeight = useMemo(() => {
		if (!containerHeight) return 0;
		if (hasSnapPoints && activeSnapPointProp !== void 0) return clamp(resolveSize(activeSnapPointProp, containerHeight), minHeightPx, maxHeightPx);
		if (hasSnapPoints && snapPointHeights.length > 0) return snapPointHeights[0];
		return restingHeightPx;
	}, [
		containerHeight,
		hasSnapPoints,
		activeSnapPointProp,
		snapPointHeights,
		minHeightPx,
		maxHeightPx,
		restingHeightPx
	]);
	const [height, setHeight] = useState(isOpen ? restingHeight : 0);
	const [isAnimating, setIsAnimating] = useState(false);
	const [isClosing, setIsClosing] = useState(false);
	const heightBeforeDrag = useRef(0);
	const prevOpenRef = useRef(isOpen);
	useEffect(() => {
		const wasOpen = prevOpenRef.current;
		prevOpenRef.current = isOpen;
		if (isOpen && !wasOpen) {
			setIsClosing(false);
			setIsAnimating(true);
			setHeight(restingHeight);
			const timer = setTimeout(() => setIsAnimating(false), ANIMATION_MS);
			return () => clearTimeout(timer);
		}
		if (!isOpen && wasOpen) {
			setIsClosing(true);
			setIsAnimating(true);
			setHeight(0);
			const timer = setTimeout(() => {
				setIsAnimating(false);
				setIsClosing(false);
			}, ANIMATION_MS);
			return () => clearTimeout(timer);
		}
	}, [isOpen]);
	useEffect(() => {
		if (isOpen && !isDragging) setHeight(restingHeight);
	}, [restingHeight]);
	const onDragChange = useCallback((draggedDistance) => {
		const newHeight = heightBeforeDrag.current + draggedDistance;
		if (hasSnapPoints) {
			const highest = snapPointHeights.at(-1) ?? maxHeightPx;
			const lowest = snapPointHeights[0] ?? minHeightPx;
			if (newHeight > highest) {
				const overshoot = newHeight - highest;
				setHeight(highest + dampenValue(overshoot));
			} else if (newHeight < lowest) {
				const undershoot = lowest - newHeight;
				setHeight(Math.max(0, lowest - dampenValue(undershoot)));
			} else setHeight(newHeight);
		} else setHeight(clamp(newHeight, 0, maxHeightPx));
	}, [
		hasSnapPoints,
		snapPointHeights,
		maxHeightPx,
		minHeightPx
	]);
	const onDragEnd = useCallback((draggedDistance, velocity) => {
		setIsAnimating(true);
		const currentHeight = heightBeforeDrag.current + draggedDistance;
		if (hasSnapPoints) {
			const activeIndex = findActiveIndex(heightBeforeDrag.current);
			const result = getSnapRelease({
				activeIndex,
				currentHeight,
				dismissible,
				draggedDistance,
				velocity
			});
			if (result.type === "dismiss") {
				setIsClosing(true);
				setHeight(0);
				const timer = setTimeout(() => {
					setOpen(false);
					setIsAnimating(false);
					setIsClosing(false);
				}, ANIMATION_MS);
				return () => clearTimeout(timer);
			}
			setHeight(result.height);
			const originalSnapValue = snapPointsProp?.find((sp) => resolveSize(sp, containerHeight) === result.height || clamp(resolveSize(sp, containerHeight), minHeightPx, maxHeightPx) === result.height);
			if (originalSnapValue !== void 0) onSnapPointChange?.(originalSnapValue);
		} else {
			if (dismissible && currentHeight < minHeightPx * closeThreshold) {
				setIsClosing(true);
				setHeight(0);
				const timer = setTimeout(() => {
					setOpen(false);
					setIsAnimating(false);
					setIsClosing(false);
				}, ANIMATION_MS);
				return () => clearTimeout(timer);
			}
			setHeight(clamp(currentHeight, minHeightPx, maxHeightPx));
		}
		setTimeout(() => setIsAnimating(false), ANIMATION_MS);
	}, [
		hasSnapPoints,
		findActiveIndex,
		getSnapRelease,
		dismissible,
		snapPointsProp,
		containerHeight,
		minHeightPx,
		maxHeightPx,
		closeThreshold,
		setOpen,
		onSnapPointChange
	]);
	const { isDragging, handleProps } = useSheetDrag({
		enabled: isOpen ?? false,
		onDragChange,
		onDragEnd
	});
	useEffect(() => {
		if (isDragging) heightBeforeDrag.current = height;
	}, [isDragging]);
	const isVisible = isOpen || isClosing || height > 0;
	const shouldAnimate = !isDragging && isAnimating;
	const inlineOverflowUp = mode === "inline" && isVisible ? Math.max(0, height - restingHeightPx) : 0;
	return /* @__PURE__ */ jsxs("div", {
		"data-floating-sheet": "",
		"data-state": isOpen ? "open" : "closed",
		ref: sheetRef,
		className: cx(s.root, variant === "embedded" ? s.embedded : s.elevated, mode === "overlay" ? s.overlay : s.inline, mode === "overlay" ? s.overlayRadius : s.inlineRadius, shouldAnimate && s.transition, !isVisible && s.hidden, className),
		style: {
			height: isVisible ? height : 0,
			marginTop: inlineOverflowUp ? -inlineOverflowUp : void 0,
			width
		},
		children: [/* @__PURE__ */ jsx(FloatingSheetHeader, {
			handleProps,
			headerActions,
			isDragging,
			title
		}), /* @__PURE__ */ jsx("div", {
			className: s.content,
			children
		})]
	});
}
//#endregion
export { FloatingSheet };

//# sourceMappingURL=FloatingSheet.mjs.map