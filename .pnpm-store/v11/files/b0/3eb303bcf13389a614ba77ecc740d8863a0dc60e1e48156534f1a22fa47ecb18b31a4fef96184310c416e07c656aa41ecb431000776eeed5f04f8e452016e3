import { useCallback, useInsertionEffect, useRef } from "react";
//#region src/react/utils/useStableCallback.ts
function useStableCallback(callback) {
	const callbackRef = useRef(callback);
	useInsertionEffect(() => void (callbackRef.current = callback));
	return useCallback((...args) => {
		return callbackRef.current(...args);
	}, []);
}
//#endregion
export { useStableCallback };

//# sourceMappingURL=useStableCallback.js.map