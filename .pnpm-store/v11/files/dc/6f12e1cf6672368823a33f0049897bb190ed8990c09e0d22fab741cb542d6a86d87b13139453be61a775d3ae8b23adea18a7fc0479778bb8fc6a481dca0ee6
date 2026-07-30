//#region src/utils/isDeepEqual.ts
const isRecord = (value) => typeof value === "object" && value !== null;
const isDeepEqual = (a, b) => {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!isDeepEqual(a[i], b[i])) return false;
		return true;
	}
	if (!isRecord(a) || !isRecord(b)) return false;
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) if (!isDeepEqual(a[key], b[key])) return false;
	return true;
};
//#endregion
export { isDeepEqual };

//# sourceMappingURL=isDeepEqual.mjs.map