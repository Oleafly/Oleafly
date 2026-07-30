import { memo, useEffect, useMemo, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { debounce } from "es-toolkit/compat";
import { mergeRefs } from "react-merge-refs";
//#region src/awesome/Spline/ParentSize.tsx
const defaultIgnoreDimensions = [];
const defaultParentSizeStyles = {
	height: "100%",
	width: "100%"
};
const ParentSize = memo(({ ref, className, children, debounceTime = 300, ignoreDimensions = defaultIgnoreDimensions, parentSizeStyles, enableDebounceLeadingCall = true, resizeObserverPolyfill, ...restProps }) => {
	const target = useRef(null);
	const animationFrameID = useRef(0);
	const [state, setState] = useState({
		height: 0,
		left: 0,
		top: 0,
		width: 0
	});
	const resize = useMemo(() => {
		const normalized = Array.isArray(ignoreDimensions) ? ignoreDimensions : [ignoreDimensions];
		return debounce((incoming) => {
			setState((existing) => {
				return Object.keys(existing).filter((key) => existing[key] !== incoming[key]).every((key) => normalized.includes(key)) ? existing : incoming;
			});
		}, debounceTime, { leading: enableDebounceLeadingCall });
	}, [
		debounceTime,
		enableDebounceLeadingCall,
		ignoreDimensions
	]);
	useEffect(() => {
		const observer = new (resizeObserverPolyfill || window.ResizeObserver)((entries) => {
			for (const entry of entries) {
				const { left, top, width, height } = entry?.contentRect ?? {};
				animationFrameID.current = window.requestAnimationFrame(() => {
					resize({
						height,
						left,
						top,
						width
					});
				});
			}
		});
		if (target.current) observer.observe(target.current);
		return () => {
			window.cancelAnimationFrame(animationFrameID.current);
			observer.disconnect();
			resize.cancel();
		};
	}, [resize, resizeObserverPolyfill]);
	return /* @__PURE__ */ jsx("div", {
		className,
		ref: mergeRefs([ref, target]),
		style: {
			...defaultParentSizeStyles,
			...parentSizeStyles
		},
		...restProps,
		children: children({
			...state,
			ref: target.current,
			resize
		})
	});
});
//#endregion
export { ParentSize as default };

//# sourceMappingURL=ParentSize.mjs.map