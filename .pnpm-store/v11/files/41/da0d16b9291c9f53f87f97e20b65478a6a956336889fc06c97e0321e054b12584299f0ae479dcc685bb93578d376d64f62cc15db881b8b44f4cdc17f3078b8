import { Z_INDEX_LAYER } from "./constants.mjs";
//#region src/base-ui/zIndex/manager.ts
let mainTop = 0;
let toastTop = 0;
let warnedMainOverflow = false;
function acquireLayerZIndex(tier) {
	if (tier === "toast") {
		toastTop = Math.max(toastTop, Z_INDEX_LAYER.toast) + Z_INDEX_LAYER.step;
		return toastTop;
	}
	mainTop = Math.max(mainTop, Z_INDEX_LAYER[tier]) + Z_INDEX_LAYER.step;
	if (process.env.NODE_ENV !== "production" && !warnedMainOverflow && mainTop >= Z_INDEX_LAYER.toast) {
		warnedMainOverflow = true;
		console.warn(`[lobe-ui z-index] main stack reached toast tier (${mainTop}); unexpected nesting depth`);
	}
	return mainTop;
}
//#endregion
export { acquireLayerZIndex };

//# sourceMappingURL=manager.mjs.map