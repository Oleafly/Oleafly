import { useLayoutEffect } from "react";
//#region src/utils/destroyOnInvalidActiveTriggerElement.ts
const isInvalidTriggerElement = (el) => {
	if (!el) return true;
	if (!el.isConnected) return true;
	try {
		let current = el;
		while (current) {
			if (getComputedStyle(current).display === "none") return true;
			current = current.parentElement;
		}
		return false;
	} catch {
		return false;
	}
};
/**
* Destroys (hard reset) a group popup (Tooltip/Popover) when its active trigger element becomes
* disconnected from the DOM or is effectively hidden via `display: none`.
*
* We intentionally poll while open to also catch CSS-driven visibility changes that won't
* necessarily trigger DOM mutation observers.
*/
const useDestroyOnInvalidActiveTriggerElement = (store, destroy, options) => {
	const enabled = options?.enabled ?? true;
	const openReactive = store.useState?.("open") ?? Boolean(store.state.open);
	const shouldWatch = enabled && openReactive;
	useLayoutEffect(() => {
		if (!shouldWatch) return;
		let raf = 0;
		const loop = () => {
			if (isInvalidTriggerElement(store.state.activeTriggerElement ?? null)) {
				destroy();
				return;
			}
			raf = window.requestAnimationFrame(loop);
		};
		loop();
		return () => window.cancelAnimationFrame(raf);
	}, [
		destroy,
		shouldWatch,
		store
	]);
};
/**
* UI-only fallback: If the positioner ends up at viewport (0,0), hide it to avoid a visible flash
* in the corner. This doesn't replace "destroy on invalid trigger"; it's purely a visual guard.
*/
const useHidePopupWhenPositionerAtOrigin = (store, options) => {
	const enabled = options?.enabled ?? true;
	const threshold = options?.threshold ?? .5;
	const openReactive = store.useState?.("open") ?? Boolean(store.state.open);
	const positionerElementReactive = store.useState?.("positionerElement") ?? store.state.positionerElement ?? null;
	useLayoutEffect(() => {
		const positionerEl = store.state.positionerElement ?? positionerElementReactive;
		if (!enabled || !openReactive || !positionerEl) {
			if (positionerEl) delete positionerEl.dataset.zeroOrigin;
			return;
		}
		let raf = 0;
		const loop = () => {
			const current = store.state.positionerElement ?? positionerEl;
			if (!current) return;
			const rect = current.getBoundingClientRect();
			if (Math.abs(rect.left) <= threshold && Math.abs(rect.top) <= threshold) current.dataset.zeroOrigin = "true";
			else delete current.dataset.zeroOrigin;
			raf = window.requestAnimationFrame(loop);
		};
		loop();
		return () => {
			window.cancelAnimationFrame(raf);
			const current = store.state.positionerElement ?? positionerEl;
			if (current) delete current.dataset.zeroOrigin;
		};
	}, [
		enabled,
		openReactive,
		positionerElementReactive,
		store,
		threshold
	]);
};
//#endregion
export { useDestroyOnInvalidActiveTriggerElement, useHidePopupWhenPositionerAtOrigin };

//# sourceMappingURL=destroyOnInvalidActiveTriggerElement.mjs.map