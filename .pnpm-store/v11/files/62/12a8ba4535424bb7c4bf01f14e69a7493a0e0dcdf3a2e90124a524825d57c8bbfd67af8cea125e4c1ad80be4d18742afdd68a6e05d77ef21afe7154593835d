import { createTextNodeElement } from "./hast_utils.js";
//#region src/utils/processLine.ts
function processLine(node, line, state) {
	const lineInfo = typeof state.lineInfo === "function" ? state.lineInfo(line) : state.lineInfo[line - 1];
	if (lineInfo == null) {
		const errorMessage = `processLine: line ${line}, contains no state.lineInfo`;
		console.error(errorMessage, {
			node,
			line,
			state
		});
		throw new Error(errorMessage);
	}
	node.tagName = "div";
	node.properties["data-line"] = lineInfo.lineNumber;
	node.properties["data-alt-line"] = lineInfo.altLineNumber;
	node.properties["data-line-type"] = lineInfo.type;
	node.properties["data-line-index"] = lineInfo.lineIndex;
	if (node.children.length === 0) node.children.push(createTextNodeElement("\n"));
	return node;
}
//#endregion
export { processLine };

//# sourceMappingURL=processLine.js.map