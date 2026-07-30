//#region src/utils/createRowNodes.ts
function createRowNodes(line) {
	const row = document.createElement("div");
	row.dataset.line = `${line}`;
	const lineColumn = document.createElement("div");
	lineColumn.dataset.columnNumber = "";
	lineColumn.textContent = `${line}`;
	const content = document.createElement("div");
	content.dataset.columnContent = "";
	row.appendChild(lineColumn);
	row.appendChild(content);
	return {
		row,
		content
	};
}
//#endregion
export { createRowNodes };

//# sourceMappingURL=createRowNodes.js.map