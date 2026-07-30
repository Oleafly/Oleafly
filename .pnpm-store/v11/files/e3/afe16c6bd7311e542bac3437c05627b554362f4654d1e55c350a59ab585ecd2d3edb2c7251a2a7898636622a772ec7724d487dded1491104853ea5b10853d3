import { useEffect, useState } from "react";
//#region src/Markdown/components/useDelayedAnimated.ts
const useDelayedAnimated = (animated) => {
	const [delayedAnimated, setDelayedAnimated] = useState(animated);
	useEffect(() => {
		if (animated === void 0) return;
		if (animated === false && delayedAnimated === true) {
			const timer = setTimeout(() => {
				setDelayedAnimated(false);
			}, 1e3);
			return () => clearTimeout(timer);
		} else setDelayedAnimated(animated);
	}, [animated, delayedAnimated]);
	return delayedAnimated;
};
//#endregion
export { useDelayedAnimated };

//# sourceMappingURL=useDelayedAnimated.mjs.map