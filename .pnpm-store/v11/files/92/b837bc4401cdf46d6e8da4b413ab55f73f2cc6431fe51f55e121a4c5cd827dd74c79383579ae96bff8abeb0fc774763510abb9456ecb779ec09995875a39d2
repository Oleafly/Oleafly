//#region ../structured-clone/index.ts
(function() {
	if (typeof globalThis === "object") return;
	Object.defineProperty(Object.prototype, "__magic__", {
		get: function() {
			return this;
		},
		configurable: true
	});
	__magic__.globalThis = __magic__;
	delete Object.prototype.__magic__;
})();
var clone = typeof globalThis.structuredClone === "function" ? globalThis.structuredClone : (obj) => JSON.parse(JSON.stringify(obj));
/**
* Wrapper around the built-in structured clone. Uses `JSON.parse(JSON.stringify(...))`
* as a fallback.
*/
function structuredClone(obj) {
	return clone(obj);
}
//#endregion
Object.defineProperty(exports, "structuredClone", {
	enumerable: true,
	get: function() {
		return structuredClone;
	}
});

//# sourceMappingURL=structured-clone-BdjW3Mei.cjs.map