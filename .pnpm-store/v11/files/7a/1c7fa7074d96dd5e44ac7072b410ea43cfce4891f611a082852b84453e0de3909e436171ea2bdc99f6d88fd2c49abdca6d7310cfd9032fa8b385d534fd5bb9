//#region src/utils/areObjectsEqual.ts
function areObjectsEqual(objA, objB, omitKeys) {
	if (objA === objB || objA == null || objB == null) return objA === objB;
	const omitSet = new Set(omitKeys);
	const keysA = Object.keys(objA);
	const keysBSet = new Set(Object.keys(objB));
	for (const key of keysA) {
		keysBSet.delete(key);
		if (omitSet.has(key)) continue;
		if (!(key in objB) || objA[key] !== objB[key]) return false;
	}
	for (const key of Array.from(keysBSet)) if (!omitSet.has(key)) return false;
	return true;
}
//#endregion
export { areObjectsEqual };

//# sourceMappingURL=areObjectsEqual.js.map