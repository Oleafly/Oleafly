import { useEffect, useState } from "react";
//#region src/hooks/useTextOverflow.ts
const useTextOverflow = (textRef, ellipsis, children) => {
	const [isOverflow, setIsOverflow] = useState(false);
	const tooltipWhenOverflow = typeof ellipsis === "object" && ellipsis.tooltipWhenOverflow;
	useEffect(() => {
		if (!tooltipWhenOverflow) return;
		const checkOverflow = () => {
			const element = textRef.current;
			if (!element) return;
			const rows = typeof ellipsis === "object" ? ellipsis.rows : void 0;
			if (rows && rows > 1) setIsOverflow(element.scrollHeight > element.clientHeight);
			else setIsOverflow(element.scrollWidth > element.clientWidth);
		};
		checkOverflow();
		const resizeObserver = new ResizeObserver(checkOverflow);
		if (textRef.current) resizeObserver.observe(textRef.current);
		return () => resizeObserver.disconnect();
	}, [
		tooltipWhenOverflow,
		ellipsis,
		children,
		textRef
	]);
	return isOverflow;
};
//#endregion
export { useTextOverflow };

//# sourceMappingURL=useTextOverflow.mjs.map