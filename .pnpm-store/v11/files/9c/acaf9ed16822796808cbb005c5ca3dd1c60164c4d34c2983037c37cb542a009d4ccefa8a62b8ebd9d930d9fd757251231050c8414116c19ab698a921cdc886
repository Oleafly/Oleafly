import { useEffect, useRef, useState } from "react";
//#region src/awesome/Spotlight/useMouseOffset.ts
const useMouseOffset = () => {
	const [offset, setOffset] = useState();
	const [outside, setOutside] = useState(true);
	const reference = useRef(null);
	useEffect(() => {
		if (reference.current && reference.current.parentElement) {
			const element = reference.current.parentElement;
			const onMouseMove = (e) => {
				const bound = element.getBoundingClientRect();
				setOffset({
					x: e.clientX - bound.x,
					y: e.clientY - bound.y
				});
				setOutside(false);
			};
			const onMouseLeave = () => {
				setOutside(true);
			};
			element.addEventListener("mousemove", onMouseMove);
			element.addEventListener("mouseleave", onMouseLeave);
			return () => {
				element.removeEventListener("mousemove", onMouseMove);
				element.removeEventListener("mouseleave", onMouseLeave);
			};
		}
	}, []);
	return [
		offset,
		outside,
		reference
	];
};
//#endregion
export { useMouseOffset };

//# sourceMappingURL=useMouseOffset.mjs.map