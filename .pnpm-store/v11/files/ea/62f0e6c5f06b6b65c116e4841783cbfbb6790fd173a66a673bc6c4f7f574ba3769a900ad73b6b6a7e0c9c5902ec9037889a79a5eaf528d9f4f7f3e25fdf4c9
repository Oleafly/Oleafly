import { clamp, resolveSize } from "./helpers.mjs";
import { useMemo } from "react";
//#region src/base-ui/FloatingSheet/useSnapPoints.ts
const VELOCITY_THRESHOLD = .4;
const DRAG_DISTANCE_RATIO = .4;
function useSnapPoints({ closeThreshold, snapPoints, containerHeight, minHeightPx, maxHeightPx }) {
	const snapPointHeights = useMemo(() => {
		if (!containerHeight) return [];
		const resolved = snapPoints.map((sp) => clamp(resolveSize(sp, containerHeight), minHeightPx, maxHeightPx)).sort((a, b) => a - b);
		return [...new Set(resolved)];
	}, [
		snapPoints,
		containerHeight,
		minHeightPx,
		maxHeightPx
	]);
	function findClosestSnapPoint(height) {
		if (snapPointHeights.length === 0) return clamp(height, minHeightPx, maxHeightPx);
		return snapPointHeights.reduce((prev, curr) => Math.abs(curr - height) < Math.abs(prev - height) ? curr : prev);
	}
	function findActiveIndex(height) {
		const closest = findClosestSnapPoint(height);
		return snapPointHeights.indexOf(closest);
	}
	function getSnapRelease({ currentHeight, activeIndex, draggedDistance, velocity, dismissible }) {
		const isFirst = activeIndex === 0;
		const isLast = activeIndex === snapPointHeights.length - 1;
		const isDraggingUp = draggedDistance > 0;
		const highestSnapPoint = snapPointHeights.at(-1) ?? maxHeightPx;
		const lowestSnapPoint = snapPointHeights[0] ?? minHeightPx;
		const nextHigherSnapPoint = snapPointHeights[Math.min(activeIndex + 1, snapPointHeights.length - 1)] ?? highestSnapPoint;
		const nextLowerSnapPoint = snapPointHeights[Math.max(activeIndex - 1, 0)] ?? lowestSnapPoint;
		const sheetHeight = snapPointHeights[activeIndex] ?? currentHeight;
		if (velocity > VELOCITY_THRESHOLD && Math.abs(draggedDistance) < sheetHeight * DRAG_DISTANCE_RATIO) if (isDraggingUp) {
			if (isLast) return {
				type: "snap",
				height: highestSnapPoint
			};
			return {
				type: "snap",
				height: nextHigherSnapPoint
			};
		} else {
			if (isFirst) return dismissible ? { type: "dismiss" } : {
				type: "snap",
				height: lowestSnapPoint
			};
			return {
				type: "snap",
				height: nextLowerSnapPoint
			};
		}
		if (dismissible && isFirst && !isDraggingUp && currentHeight < lowestSnapPoint * closeThreshold) return { type: "dismiss" };
		return {
			type: "snap",
			height: findClosestSnapPoint(currentHeight)
		};
	}
	return {
		snapPointHeights,
		findClosestSnapPoint,
		findActiveIndex,
		getSnapRelease
	};
}
//#endregion
export { useSnapPoints };

//# sourceMappingURL=useSnapPoints.mjs.map