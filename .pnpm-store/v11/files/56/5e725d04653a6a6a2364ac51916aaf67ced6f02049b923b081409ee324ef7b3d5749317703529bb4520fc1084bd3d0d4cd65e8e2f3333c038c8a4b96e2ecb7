import { MERGE_CONFLICT_BASE_MARKER_REGEX, MERGE_CONFLICT_END_MARKER_REGEX, MERGE_CONFLICT_SEPARATOR_MARKER_REGEX, MERGE_CONFLICT_START_MARKER_REGEX } from "../constants.js";
//#region src/utils/getMergeConflictLineTypes.ts
function trimLineEnding(line) {
	return line.replace(/(?:\r\n|\n|\r)$/, "");
}
function getMergeConflictLineTypes(lines) {
	return getMergeConflictParseResult(lines).lineTypes;
}
function getMergeConflictParseResult(lines) {
	return parseMergeConflicts(lines);
}
function getMergeConflictActionLineNumber(conflict) {
	return Math.max(1, conflict.startLineNumber - 1);
}
function parseMergeConflicts(lines) {
	const lineTypes = new Array(lines.length);
	const stack = [];
	const regions = [];
	for (let index = 0; index < lines.length; index++) {
		const line = trimLineEnding(lines[index]);
		if (MERGE_CONFLICT_START_MARKER_REGEX.test(line)) {
			stack.push({
				stage: "current",
				startLineIndex: index
			});
			lineTypes[index] = "marker-start";
			continue;
		}
		const frame = stack.at(-1);
		if (frame == null) {
			lineTypes[index] = "none";
			continue;
		}
		if (MERGE_CONFLICT_BASE_MARKER_REGEX.test(line)) {
			frame.stage = "base";
			frame.baseMarkerLineIndex = index;
			lineTypes[index] = "marker-base";
			continue;
		}
		if (MERGE_CONFLICT_SEPARATOR_MARKER_REGEX.test(line)) {
			frame.stage = "incoming";
			frame.separatorLineIndex = index;
			lineTypes[index] = "marker-separator";
			continue;
		}
		if (MERGE_CONFLICT_END_MARKER_REGEX.test(line)) {
			const completedFrame = stack.pop();
			lineTypes[index] = "marker-end";
			if (completedFrame?.separatorLineIndex != null) {
				const conflictIndex = regions.length;
				regions.push({
					conflictIndex,
					startLineIndex: completedFrame.startLineIndex,
					startLineNumber: completedFrame.startLineIndex + 1,
					separatorLineIndex: completedFrame.separatorLineIndex,
					separatorLineNumber: completedFrame.separatorLineIndex + 1,
					endLineIndex: index,
					endLineNumber: index + 1,
					baseMarkerLineIndex: completedFrame.baseMarkerLineIndex,
					baseMarkerLineNumber: completedFrame.baseMarkerLineIndex != null ? completedFrame.baseMarkerLineIndex + 1 : void 0
				});
			}
			continue;
		}
		lineTypes[index] = frame.stage;
	}
	return {
		lineTypes,
		regions
	};
}
//#endregion
export { getMergeConflictActionLineNumber, getMergeConflictLineTypes, getMergeConflictParseResult };

//# sourceMappingURL=getMergeConflictLineTypes.js.map