//#region src/utils/normalizeDiffResolution.ts
function normalizeDiffResolution(options) {
	const type = (() => {
		return typeof options === "string" ? options : options.type;
	})();
	return type === "accept" || type === "incoming" ? "additions" : type === "reject" || type === "current" ? "deletions" : "both";
}
//#endregion
export { normalizeDiffResolution };

//# sourceMappingURL=normalizeDiffResolution.js.map