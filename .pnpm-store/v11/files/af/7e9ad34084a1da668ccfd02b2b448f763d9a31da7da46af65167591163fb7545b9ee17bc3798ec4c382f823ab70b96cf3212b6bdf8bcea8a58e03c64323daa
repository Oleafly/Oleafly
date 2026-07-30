import { normalizeDiffResolution } from "./normalizeDiffResolution.js";
import { resolveRegion } from "./resolveRegion.js";
//#region src/utils/resolveConflict.ts
function resolveConflict(diff, conflict, type) {
	return resolveRegion(diff, {
		resolution: normalizeDiffResolution(type),
		hunkIndex: conflict.hunkIndex,
		startContentIndex: conflict.startContentIndex,
		endContentIndex: conflict.endContentIndex,
		indexesToDelete: getConflictDeleteContentIndexes(conflict)
	});
}
function getConflictDeleteContentIndexes(conflict) {
	const indexes = /* @__PURE__ */ new Set();
	if (conflict.baseContentIndex != null) indexes.add(conflict.baseContentIndex);
	if (conflict.endMarkerContentIndex !== conflict.endContentIndex) indexes.add(conflict.endMarkerContentIndex);
	return indexes;
}
//#endregion
export { resolveConflict };

//# sourceMappingURL=resolveConflict.js.map