import { useCallback, useEffect, useRef, useState } from "react";
//#region src/base-ui/FloatingSheet/useSheetDrag.ts
function useSheetDrag({ onDragChange, onDragEnd, enabled }) {
	const [isDragging, setIsDragging] = useState(false);
	const startY = useRef(0);
	const startTime = useRef(0);
	const draggingRef = useRef(false);
	const onDragChangeRef = useRef(onDragChange);
	const onDragEndRef = useRef(onDragEnd);
	onDragChangeRef.current = onDragChange;
	onDragEndRef.current = onDragEnd;
	useEffect(() => {
		if (!draggingRef.current) return;
		const onMouseMove = (e) => {
			e.preventDefault();
			const draggedDistance = startY.current - e.clientY;
			onDragChangeRef.current(draggedDistance);
		};
		const onMouseUp = (e) => {
			draggingRef.current = false;
			setIsDragging(false);
			const draggedDistance = startY.current - e.clientY;
			const elapsed = Date.now() - startTime.current;
			const velocity = elapsed > 0 ? Math.abs(draggedDistance) / elapsed : 0;
			onDragEndRef.current(draggedDistance, velocity);
		};
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
		return () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		};
	}, [isDragging]);
	return {
		isDragging,
		handleProps: { onMouseDown: useCallback((event) => {
			if (!enabled) return;
			if (event.button !== 0) return;
			if (event.target.closest?.("[data-no-drag]")) return;
			event.preventDefault();
			startY.current = event.clientY;
			startTime.current = Date.now();
			draggingRef.current = true;
			setIsDragging(true);
		}, [enabled]) }
	};
}
//#endregion
export { useSheetDrag };

//# sourceMappingURL=useSheetDrag.mjs.map