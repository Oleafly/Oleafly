//#region src/utils/isStyleNode.ts
function isStyleNode(element) {
	if (typeof HTMLStyleElement !== "undefined" && element instanceof HTMLStyleElement) return true;
	const tagName = element.tagName ?? element.nodeName;
	return typeof tagName === "string" && tagName.toLowerCase() === "style";
}
//#endregion
export { isStyleNode };

//# sourceMappingURL=isStyleNode.js.map