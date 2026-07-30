//#region src/utils/iterateOverFile.ts
/**
* Iterates over lines in a file with optional windowing support.
*
* Similar to `iterateOverDiff` but simplified for linear file content.
* Supports viewport windowing for virtualization scenarios.
*
* @param props - Configuration for iteration
* @param props.lines - Pre-split array of lines (use splitFileContents() to create from string)
* @param props.startingLine - Optional starting line index (0-based, default: 0)
* @param props.totalLines - Optional max lines to iterate (default: Infinity)
* @param props.callback - Callback invoked for each line in the window.
*                         Return `true` to stop iteration early.
*
* @example
* ```typescript
* const lines = splitFileContents('line1\nline2\nline3');
* iterateOverFile({
*   lines,
*   startingLine: 0,
*   totalLines: 10,
*   callback: ({ lineIndex, lineNumber, content, isLastLine }) => {
*     console.log(`Line ${lineNumber}: ${content}`);
*     if (content.includes('stop')) return true; // Stop iteration
*   }
* });
* ```
*/
function iterateOverFile({ lines, startingLine = 0, totalLines = Infinity, callback }) {
	const len = Math.min(startingLine + totalLines, lines.length);
	const lastLineIndex = (() => {
		const lastLine = lines.at(-1);
		if (lastLine === "" || lastLine === "\n" || lastLine === "\r\n" || lastLine === "\r") return Math.max(0, lines.length - 2);
		return lines.length - 1;
	})();
	for (let lineIndex = startingLine; lineIndex < len; lineIndex++) {
		const isLastLine = lineIndex === lastLineIndex;
		if (callback({
			lineIndex,
			lineNumber: lineIndex + 1,
			content: lines[lineIndex],
			isLastLine
		}) === true || isLastLine) break;
	}
}
//#endregion
export { iterateOverFile };

//# sourceMappingURL=iterateOverFile.js.map