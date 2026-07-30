import { HUNK_HEADER } from "../constants.js";
//#region src/utils/trimPatchContext.ts
/**
* A utility function to trim out excess context lines from a patch file.  It
* will maintain line numbers, and properly update the hunk context markers, as
* well as be able to create new hunks where necessary if there's excessive
* context between changes
*/
function trimPatchContext(patch, contextSize = 10) {
	const lines = [];
	let currentHunk;
	for (const line of patch.split("\n")) {
		const parsedHunkHeader = line.match(HUNK_HEADER);
		if (parsedHunkHeader != null) {
			if (currentHunk != null) {
				if (currentHunk.hunkLines.length > 0) {
					flushContextLines(currentHunk, contextSize, "trailing");
					flushHunk(currentHunk, lines);
				}
				currentHunk = void 0;
			}
			const additionStart = parseInt(parsedHunkHeader[3]);
			const deletionStart = parseInt(parsedHunkHeader[1]);
			const additionCount = parseInt(parsedHunkHeader[4] ?? "1");
			const deletionCount = parseInt(parsedHunkHeader[2] ?? "1");
			if (isNaN(additionStart) || isNaN(deletionStart) || isNaN(additionCount) || isNaN(deletionCount)) lines.push(line);
			else currentHunk = {
				additionStart,
				deletionStart,
				additionCount: 0,
				deletionCount: 0,
				hunkLines: [],
				contextLines: []
			};
			continue;
		}
		if (currentHunk == null) {
			lines.push(line);
			continue;
		}
		if (line.startsWith(" ")) currentHunk.contextLines.push(line);
		else if (line !== "") {
			if (currentHunk.hunkLines.length > 0 && currentHunk.contextLines.length > contextSize * 2) {
				const omittedContextLineCount = currentHunk.contextLines.length - contextSize * 2;
				const nextContextLines = currentHunk.contextLines.slice(-contextSize);
				flushContextLines(currentHunk, contextSize, "trailing");
				const { additionCount: emittedAdditionCount, deletionCount: emittedDeletionCount } = currentHunk;
				flushHunk(currentHunk, lines);
				currentHunk = {
					additionStart: currentHunk.additionStart + emittedAdditionCount + omittedContextLineCount,
					deletionStart: currentHunk.deletionStart + emittedDeletionCount + omittedContextLineCount,
					deletionCount: 0,
					additionCount: 0,
					contextLines: nextContextLines,
					hunkLines: []
				};
			}
			flushContextLines(currentHunk, contextSize, currentHunk.hunkLines.length === 0 ? "leading" : "before-change");
			currentHunk.hunkLines.push(line);
			if (line.startsWith("+")) currentHunk.additionCount += 1;
			else if (line.startsWith("-")) currentHunk.deletionCount += 1;
		}
	}
	if (currentHunk != null && currentHunk.hunkLines.length > 0) {
		flushContextLines(currentHunk, contextSize, "trailing");
		flushHunk(currentHunk, lines);
	}
	const result = lines.join("\n");
	return patch.endsWith("\n") ? `${result}\n` : result;
}
function flushContextLines(hunk, contextSize, mode) {
	if (mode === "leading" && hunk.contextLines.length > contextSize) {
		const difference = hunk.contextLines.length - contextSize;
		hunk.contextLines.splice(0, difference);
		hunk.additionStart += difference;
		hunk.deletionStart += difference;
	}
	if (mode === "trailing" && hunk.contextLines.length > contextSize) hunk.contextLines.length = contextSize;
	if (hunk.contextLines.length > 0) {
		hunk.hunkLines.push(...hunk.contextLines);
		hunk.additionCount += hunk.contextLines.length;
		hunk.deletionCount += hunk.contextLines.length;
		hunk.contextLines.length = 0;
	}
	return hunk;
}
function flushHunk(hunk, lines) {
	lines.push(`@@ -${formatHunkRange(hunk.deletionStart, hunk.deletionCount)} +${formatHunkRange(hunk.additionStart, hunk.additionCount)} @@`);
	lines.push(...hunk.hunkLines);
}
function formatHunkRange(start, count) {
	return count === 1 ? `${start}` : `${start},${count}`;
}
//#endregion
export { trimPatchContext };

//# sourceMappingURL=trimPatchContext.js.map