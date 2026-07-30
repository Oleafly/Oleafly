//#region src/utils/parseLineType.ts
function parseLineType(line) {
	const firstChar = line[0];
	if (firstChar !== "+" && firstChar !== "-" && firstChar !== " " && firstChar !== "\\") {
		console.error(`parseLineType: Invalid firstChar: "${firstChar}", full line: "${line}"`);
		return;
	}
	const processedLine = line.substring(1);
	return {
		line: processedLine === "" ? "\n" : processedLine,
		type: firstChar === " " ? "context" : firstChar === "\\" ? "metadata" : firstChar === "+" ? "addition" : "deletion"
	};
}
//#endregion
export { parseLineType };

//# sourceMappingURL=parseLineType.js.map