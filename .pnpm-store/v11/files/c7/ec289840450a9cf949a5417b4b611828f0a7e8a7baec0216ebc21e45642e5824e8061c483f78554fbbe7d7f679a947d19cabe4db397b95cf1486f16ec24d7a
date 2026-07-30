//#region src/utils/getOrCreateCodeNode.ts
function getOrCreateCodeNode({ code, pre, columnType, rowSpan, containerSize = false } = {}) {
	if (code == null) {
		code = document.createElement("code");
		code.setAttribute("data-code", "");
		if (columnType != null) code.setAttribute(`data-${columnType}`, "");
		pre?.appendChild(code);
	}
	if (rowSpan != null) code.style.setProperty("grid-row", `span ${rowSpan}`);
	else code.style.removeProperty("grid-row");
	if (containerSize) code.setAttribute("data-container-size", "");
	else code.removeAttribute("data-container-size");
	return code;
}
//#endregion
export { getOrCreateCodeNode };

//# sourceMappingURL=getOrCreateCodeNode.js.map