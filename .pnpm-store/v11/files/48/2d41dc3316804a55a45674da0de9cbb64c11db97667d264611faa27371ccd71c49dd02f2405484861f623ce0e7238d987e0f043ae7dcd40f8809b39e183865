import { acquireLayerZIndex } from "./manager.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
//#region src/base-ui/zIndex/useLayerZIndex.tsx
function useLayerZIndex(tier, explicitZIndex) {
	const [zIndex, setZIndex] = useState(void 0);
	const stateRef = useRef({
		tier,
		explicit: explicitZIndex,
		node: null,
		observer: null,
		prevOpen: false
	});
	const prevExplicitRef = useRef(explicitZIndex);
	stateRef.current.tier = tier;
	stateRef.current.explicit = explicitZIndex;
	if (prevExplicitRef.current !== void 0 && explicitZIndex === void 0 && stateRef.current.node) {
		const node = stateRef.current.node;
		if (node.hasAttribute("data-open")) {
			setZIndex(acquireLayerZIndex(tier));
			stateRef.current.prevOpen = true;
		}
		if (!stateRef.current.observer) {
			const handle = () => {
				const open = node.hasAttribute("data-open");
				if (open && !stateRef.current.prevOpen) setZIndex(acquireLayerZIndex(stateRef.current.tier));
				stateRef.current.prevOpen = open;
			};
			const observer = new MutationObserver(handle);
			observer.observe(node, {
				attributes: true,
				attributeFilter: ["data-open", "data-closed"]
			});
			stateRef.current.observer = observer;
		}
	}
	prevExplicitRef.current = explicitZIndex;
	const ref = useCallback((node) => {
		if (node === stateRef.current.node) return;
		stateRef.current.observer?.disconnect();
		stateRef.current.observer = null;
		stateRef.current.node = node;
		stateRef.current.prevOpen = false;
		if (!node) return;
		if (stateRef.current.explicit !== void 0) return;
		const handle = () => {
			const isOpen = node.hasAttribute("data-open");
			if (isOpen && !stateRef.current.prevOpen) setZIndex(acquireLayerZIndex(stateRef.current.tier));
			stateRef.current.prevOpen = isOpen;
		};
		handle();
		const observer = new MutationObserver(handle);
		observer.observe(node, {
			attributes: true,
			attributeFilter: ["data-open", "data-closed"]
		});
		stateRef.current.observer = observer;
	}, []);
	useEffect(() => () => {
		stateRef.current.observer?.disconnect();
	}, []);
	return {
		zIndex: stateRef.current.explicit ?? zIndex,
		ref
	};
}
//#endregion
export { useLayerZIndex };

//# sourceMappingURL=useLayerZIndex.mjs.map