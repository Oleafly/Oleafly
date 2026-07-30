import { useEffect, useRef, useState } from "react";
//#region src/ScrollShadow/useScrollOverflow.ts
const initialScrollState = {
	bottom: false,
	left: false,
	right: false,
	top: false
};
const isSameScrollState = (a, b) => a.bottom === b.bottom && a.left === b.left && a.right === b.right && a.top === b.top;
const useScrollOverflow = ({ domRef, offset = 0, orientation = "vertical", isEnabled = true, onVisibilityChange, updateDeps = [] }) => {
	const [scrollState, setScrollState] = useState(initialScrollState);
	const scrollStateRef = useRef(initialScrollState);
	useEffect(() => {
		const element = domRef.current;
		if (!element || !isEnabled) return;
		const checkScroll = () => {
			const newState = { ...initialScrollState };
			if (orientation === "vertical") if (element.scrollHeight > element.clientHeight) {
				newState.top = element.scrollTop > offset;
				newState.bottom = element.scrollTop + element.clientHeight < element.scrollHeight - offset;
			} else {
				newState.top = false;
				newState.bottom = false;
			}
			else if (element.scrollWidth > element.clientWidth) {
				newState.left = element.scrollLeft > offset;
				newState.right = element.scrollLeft + element.clientWidth < element.scrollWidth - offset;
			} else {
				newState.left = false;
				newState.right = false;
			}
			if (isSameScrollState(scrollStateRef.current, newState)) return;
			scrollStateRef.current = newState;
			setScrollState(newState);
			onVisibilityChange?.(newState);
		};
		checkScroll();
		element.addEventListener("scroll", checkScroll);
		window.addEventListener("resize", checkScroll);
		const resizeObserver = new ResizeObserver(checkScroll);
		resizeObserver.observe(element);
		return () => {
			element.removeEventListener("scroll", checkScroll);
			window.removeEventListener("resize", checkScroll);
			resizeObserver.disconnect();
		};
	}, [
		domRef,
		offset,
		orientation,
		isEnabled,
		...updateDeps
	]);
	return scrollState;
};
//#endregion
export { useScrollOverflow };

//# sourceMappingURL=useScrollOverflow.mjs.map