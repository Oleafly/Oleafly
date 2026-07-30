//#region src/utils/areMergeConflictActionsEqual.ts
function areMergeConflictActionsEqual(a, b) {
	return a.hunkIndex === b.hunkIndex && a.startContentIndex === b.startContentIndex && a.endContentIndex === b.endContentIndex && a.currentContentIndex === b.currentContentIndex && a.baseContentIndex === b.baseContentIndex && a.incomingContentIndex === b.incomingContentIndex && a.endMarkerContentIndex === b.endMarkerContentIndex && a.conflictIndex === b.conflictIndex && areConflictsEqual(a.conflict, b.conflict);
}
function areConflictsEqual(a, b) {
	return a.conflictIndex === b.conflictIndex && a.startLineIndex === b.startLineIndex && a.startLineNumber === b.startLineNumber && a.separatorLineIndex === b.separatorLineIndex && a.separatorLineNumber === b.separatorLineNumber && a.endLineIndex === b.endLineIndex && a.endLineNumber === b.endLineNumber && a.baseMarkerLineIndex === b.baseMarkerLineIndex && a.baseMarkerLineNumber === b.baseMarkerLineNumber;
}
//#endregion
export { areMergeConflictActionsEqual };

//# sourceMappingURL=areMergeConflictActionsEqual.js.map