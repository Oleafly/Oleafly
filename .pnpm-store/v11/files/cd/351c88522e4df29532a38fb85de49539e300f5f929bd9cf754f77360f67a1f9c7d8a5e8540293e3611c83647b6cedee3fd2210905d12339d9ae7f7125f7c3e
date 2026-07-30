import { useCallback, useLayoutEffect, useRef } from "react";
//#region src/hooks/useEventCallback.ts
function useEventCallback(fn) {
	const ref = useRef(fn);
	useLayoutEffect(() => {
		ref.current = fn;
	});
	return useCallback((...args) => {
		return ref.current(...args);
	}, []);
}
//#endregion
export { useEventCallback };

//# sourceMappingURL=useEventCallback.mjs.map