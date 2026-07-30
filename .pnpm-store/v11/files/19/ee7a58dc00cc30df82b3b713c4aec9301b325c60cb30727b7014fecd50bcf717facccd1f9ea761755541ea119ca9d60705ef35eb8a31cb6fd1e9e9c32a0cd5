//#region src/utils/parseMergeConflictDiffFromFile.ts
function getMergeConflictActionAnchor(action, fileDiff) {
	const hunk = fileDiff.hunks[action.hunkIndex];
	if (hunk == null) return;
	return {
		hunkIndex: action.hunkIndex,
		lineIndex: getUnifiedLineStartForContent(hunk, action.startContentIndex)
	};
}
function parseMergeConflictDiffFromFile(file, maxContextLines = 6) {
	maxContextLines = Math.max(maxContextLines, 1);
	const s = {
		deletionLines: [],
		additionLines: [],
		conflictStack: [],
		conflictBuilders: [],
		actions: [],
		hunks: [],
		nextConflictIndex: 0,
		splitLineCount: 0,
		unifiedLineCount: 0,
		lastHunkEnd: 0,
		activeHunk: void 0,
		maxContextLines,
		maxContextLines2: maxContextLines * 2
	};
	const contents = file.contents;
	const contentLength = contents.length;
	if (contentLength > 0) {
		let lineStart = 0;
		let lineIndex = 0;
		let newlinePos = contents.indexOf("\n", lineStart);
		while (newlinePos !== -1) {
			processLine(s, contents.slice(lineStart, newlinePos + 1), lineIndex);
			lineStart = newlinePos + 1;
			lineIndex++;
			newlinePos = contents.indexOf("\n", lineStart);
		}
		if (lineStart < contentLength) processLine(s, contents.slice(lineStart), lineIndex);
	}
	if (s.conflictStack.length > 0) throw new Error("parseMergeConflictDiffFromFile: unfinished merge conflict marker stack");
	if (s.activeHunk != null && s.activeHunk.hunkContent.length > 0) {
		flushBufferedContext(s, s.activeHunk, "trailing");
		finalizeActiveHunk(s);
	}
	for (let conflictIndex = 0; conflictIndex < s.conflictBuilders.length; conflictIndex++) {
		const builder = s.conflictBuilders[conflictIndex];
		if (builder == null || !builder.completed) throw new Error(`parseMergeConflictDiffFromFile: failed to build merge conflict action ${conflictIndex}`);
	}
	if (s.hunks.length > 0 && s.additionLines.length > 0 && s.deletionLines.length > 0) {
		const lastHunk = s.hunks[s.hunks.length - 1];
		const collapsedAfter = Math.max(s.additionLines.length - (lastHunk.additionStart + lastHunk.additionCount - 1), 0);
		s.splitLineCount += collapsedAfter;
		s.unifiedLineCount += collapsedAfter;
	}
	const currentContents = s.deletionLines.join("");
	const incomingContents = s.additionLines.join("");
	const currentFile = createResolvedConflictFile(file, "current", currentContents);
	const incomingFile = createResolvedConflictFile(file, "incoming", incomingContents);
	let type = "change";
	if (incomingContents === "") type = "deleted";
	else if (currentContents === "") type = "new";
	const fileDiff = {
		name: file.name,
		prevName: void 0,
		type,
		hunks: s.hunks,
		splitLineCount: s.splitLineCount,
		unifiedLineCount: s.unifiedLineCount,
		isPartial: false,
		deletionLines: s.deletionLines,
		additionLines: s.additionLines,
		cacheKey: file.cacheKey != null ? `${file.cacheKey}:merge-conflict-diff` : void 0
	};
	return {
		fileDiff,
		currentFile,
		incomingFile,
		actions: s.actions,
		markerRows: buildMergeConflictMarkerRows(fileDiff, s.actions)
	};
}
function processLine(s, line, index) {
	const frame = s.conflictStack[s.conflictStack.length - 1];
	if (frame == null) {
		if (line.length >= 7 && line.charCodeAt(0) === 60 && getMergeConflictMarkerType(line) === "start") {
			handleStartMarker(s, line, index);
			return;
		}
		emitContextLine(s, line);
		return;
	}
	const markerType = getMergeConflictMarkerType(line);
	if (markerType === "start") {
		handleStartMarker(s, line, index);
		return;
	}
	if (markerType === "base") {
		frame.stage = "base";
		frame.baseMarkerLineIndex = index;
		frame.markerLines.base = line;
		return;
	}
	if (markerType === "separator") {
		frame.stage = "incoming";
		frame.separatorLineIndex = index;
		frame.markerLines.separator = line;
		return;
	}
	if (markerType === "end") {
		const completedFrame = s.conflictStack.pop();
		if (completedFrame == null) throw new Error("parseMergeConflictDiffFromFile: encountered end marker before start marker");
		finalizeConflict(s, completedFrame, index, line);
		return;
	}
	if (frame.stage === "current") emitChangeLine(s, "deletion", line, frame.conflictIndex, "current");
	else if (frame.stage === "base") emitContextLine(s, line, frame.conflictIndex);
	else emitChangeLine(s, "addition", line, frame.conflictIndex, "incoming");
}
function ensureActiveHunk(s) {
	s.activeHunk ??= createHunkBuilder(s.additionLines.length + 1, s.deletionLines.length + 1);
	return s.activeHunk;
}
function assignConflictContent(s, conflictIndex, role, contentIndex) {
	const builder = s.conflictBuilders[conflictIndex];
	if (builder == null) throw new Error(`parseMergeConflictDiffFromFile: failed to locate conflict action ${conflictIndex}`);
	const action = builder.action;
	const hunkIndex = s.hunks.length;
	if (action.hunkIndex < 0) action.hunkIndex = hunkIndex;
	else if (action.hunkIndex !== hunkIndex) throw new Error(`parseMergeConflictDiffFromFile: conflict ${conflictIndex} spans multiple hunks and cannot be anchored`);
	if (action.startContentIndex < 0) action.startContentIndex = contentIndex;
	action.endContentIndex = contentIndex;
	action.endMarkerContentIndex = contentIndex;
	if (role === "current") {
		action.currentContentIndex ??= contentIndex;
		return;
	}
	if (role === "base") {
		action.baseContentIndex ??= contentIndex;
		return;
	}
	action.incomingContentIndex = contentIndex;
}
function appendChangeLine(hunk, lineType, additionLineIndex, deletionLineIndex) {
	const hunkContent = hunk.hunkContent;
	const lastContent = hunkContent[hunkContent.length - 1];
	if (lastContent?.type === "change") {
		if (lineType === "addition") lastContent.additions++;
		else lastContent.deletions++;
		return hunkContent.length - 1;
	}
	hunkContent.push({
		type: "change",
		additions: lineType === "addition" ? 1 : 0,
		deletions: lineType === "deletion" ? 1 : 0,
		additionLineIndex,
		deletionLineIndex
	});
	return hunkContent.length - 1;
}
function flushBufferedContext(s, hunk, mode) {
	let count = hunk.contextBufferCount;
	let addStart = hunk.contextBufferAdditionStart;
	let delStart = hunk.contextBufferDeletionStart;
	if (mode === "leading" && count > s.maxContextLines) {
		const difference = count - s.maxContextLines;
		addStart += difference;
		delStart += difference;
		count = s.maxContextLines;
		hunk.additionStart += difference;
		hunk.deletionStart += difference;
		hunk.additionLineIndex += difference;
		hunk.deletionLineIndex += difference;
	}
	if (mode === "trailing" && count > s.maxContextLines) count = s.maxContextLines;
	if (count === 0) {
		hunk.contextBufferCount = 0;
		hunk.contextBufferBaseConflicts = void 0;
		return;
	}
	const hunkContent = hunk.hunkContent;
	const lastContent = hunkContent[hunkContent.length - 1];
	let contentIndex;
	if (lastContent?.type === "context") {
		lastContent.lines += count;
		contentIndex = hunkContent.length - 1;
	} else {
		hunkContent.push({
			type: "context",
			lines: count,
			additionLineIndex: addStart,
			deletionLineIndex: delStart
		});
		contentIndex = hunkContent.length - 1;
	}
	hunk.additionCount += count;
	hunk.deletionCount += count;
	const baseConflicts = hunk.contextBufferBaseConflicts;
	if (baseConflicts != null) {
		const bufferStartOffset = addStart - hunk.contextBufferAdditionStart;
		for (const [offset, conflictIndex] of baseConflicts) if (offset >= bufferStartOffset && offset < bufferStartOffset + count) assignConflictContent(s, conflictIndex, "base", contentIndex);
	}
	hunk.contextBufferCount = 0;
	hunk.contextBufferBaseConflicts = void 0;
}
function finalizeActiveHunk(s) {
	if (s.activeHunk == null) return;
	const hunk = s.activeHunk;
	s.activeHunk = void 0;
	if (hunk.hunkContent.length === 0) return;
	let hunkSplitLineCount = 0;
	let hunkUnifiedLineCount = 0;
	for (const content of hunk.hunkContent) if (content.type === "context") {
		hunkSplitLineCount += content.lines;
		hunkUnifiedLineCount += content.lines;
	} else {
		hunkSplitLineCount += Math.max(content.additions, content.deletions);
		hunkUnifiedLineCount += content.additions + content.deletions;
	}
	const collapsedBefore = Math.max(hunk.additionStart - 1 - s.lastHunkEnd, 0);
	const finalizedHunk = {
		collapsedBefore,
		additionStart: hunk.additionStart,
		additionCount: hunk.additionCount,
		additionLines: hunk.additionLines,
		additionLineIndex: hunk.additionLineIndex,
		deletionStart: hunk.deletionStart,
		deletionCount: hunk.deletionCount,
		deletionLines: hunk.deletionLines,
		deletionLineIndex: hunk.deletionLineIndex,
		hunkContent: hunk.hunkContent,
		hunkContext: void 0,
		hunkSpecs: `@@ -${formatHunkRange(hunk.deletionStart, hunk.deletionCount)} +${formatHunkRange(hunk.additionStart, hunk.additionCount)} @@\n`,
		splitLineStart: s.splitLineCount + collapsedBefore,
		splitLineCount: hunkSplitLineCount,
		unifiedLineStart: s.unifiedLineCount + collapsedBefore,
		unifiedLineCount: hunkUnifiedLineCount,
		noEOFCRAdditions: false,
		noEOFCRDeletions: false
	};
	s.hunks.push(finalizedHunk);
	s.splitLineCount += collapsedBefore + hunkSplitLineCount;
	s.unifiedLineCount += collapsedBefore + hunkUnifiedLineCount;
	s.lastHunkEnd = hunk.additionStart + hunk.additionCount - 1;
}
function splitHunkWithBufferedContext(s) {
	if (s.activeHunk == null) return;
	const hunk = s.activeHunk;
	const count = hunk.contextBufferCount;
	const omittedContextLineCount = count - s.maxContextLines2;
	const nextAddStart = hunk.contextBufferAdditionStart + count - s.maxContextLines;
	const nextDelStart = hunk.contextBufferDeletionStart + count - s.maxContextLines;
	let nextBaseConflicts;
	if (hunk.contextBufferBaseConflicts != null) {
		const tailOffset = count - s.maxContextLines;
		for (const [offset, ci] of hunk.contextBufferBaseConflicts) if (offset >= tailOffset) {
			nextBaseConflicts ??= /* @__PURE__ */ new Map();
			nextBaseConflicts.set(offset - tailOffset, ci);
		}
	}
	flushBufferedContext(s, hunk, "trailing");
	const emittedAdditionCount = hunk.additionCount;
	const emittedDeletionCount = hunk.deletionCount;
	finalizeActiveHunk(s);
	s.activeHunk = createHunkBuilder(hunk.additionStart + emittedAdditionCount + omittedContextLineCount, hunk.deletionStart + emittedDeletionCount + omittedContextLineCount);
	s.activeHunk.contextBufferAdditionStart = nextAddStart;
	s.activeHunk.contextBufferDeletionStart = nextDelStart;
	s.activeHunk.contextBufferCount = s.maxContextLines;
	s.activeHunk.contextBufferBaseConflicts = nextBaseConflicts;
}
function emitContextLine(s, line, baseConflictIndex = -1) {
	const hunk = ensureActiveHunk(s);
	if (hunk.contextBufferCount === 0) {
		hunk.contextBufferAdditionStart = s.additionLines.length;
		hunk.contextBufferDeletionStart = s.deletionLines.length;
	}
	s.additionLines.push(line);
	s.deletionLines.push(line);
	if (baseConflictIndex >= 0) {
		hunk.contextBufferBaseConflicts ??= /* @__PURE__ */ new Map();
		hunk.contextBufferBaseConflicts.set(hunk.contextBufferCount, baseConflictIndex);
	}
	hunk.contextBufferCount++;
}
function emitChangeLine(s, lineType, line, conflictIndex, role) {
	let hunk = ensureActiveHunk(s);
	if (hunk.hunkContent.length > 0 && hunk.contextBufferCount > s.maxContextLines2) {
		splitHunkWithBufferedContext(s);
		hunk = s.activeHunk;
	}
	flushBufferedContext(s, hunk, hunk.hunkContent.length === 0 ? "leading" : "before-change");
	const additionLineIndex = s.additionLines.length;
	const deletionLineIndex = s.deletionLines.length;
	if (lineType === "addition") s.additionLines.push(line);
	else s.deletionLines.push(line);
	const contentIndex = appendChangeLine(hunk, lineType, additionLineIndex, deletionLineIndex);
	if (lineType === "addition") {
		hunk.additionCount++;
		hunk.additionLines++;
	} else {
		hunk.deletionCount++;
		hunk.deletionLines++;
	}
	assignConflictContent(s, conflictIndex, role, contentIndex);
}
function finalizeConflict(s, frame, endLineIndex, endMarkerLine) {
	if (frame.separatorLineIndex == null || frame.markerLines.separator == null) throw new Error(`parseMergeConflictDiffFromFile: conflict ${frame.conflictIndex} is missing a separator marker`);
	const builder = s.conflictBuilders[frame.conflictIndex];
	if (builder == null) throw new Error(`parseMergeConflictDiffFromFile: failed to finalize conflict ${frame.conflictIndex}`);
	const action = builder.action;
	action.markerLines.separator = frame.markerLines.separator;
	action.markerLines.end = endMarkerLine;
	if (frame.markerLines.base != null) action.markerLines.base = frame.markerLines.base;
	action.conflict = {
		conflictIndex: frame.conflictIndex,
		startLineIndex: frame.startLineIndex,
		startLineNumber: frame.startLineIndex + 1,
		separatorLineIndex: frame.separatorLineIndex,
		separatorLineNumber: frame.separatorLineIndex + 1,
		endLineIndex,
		endLineNumber: endLineIndex + 1,
		baseMarkerLineIndex: frame.baseMarkerLineIndex,
		baseMarkerLineNumber: frame.baseMarkerLineIndex != null ? frame.baseMarkerLineIndex + 1 : void 0
	};
	const fallbackContentIndex = action.currentContentIndex ?? action.incomingContentIndex;
	action.currentContentIndex ??= fallbackContentIndex;
	action.incomingContentIndex ??= fallbackContentIndex;
	if (action.startContentIndex < 0 && fallbackContentIndex != null) action.startContentIndex = fallbackContentIndex;
	if (action.endContentIndex < 0 && fallbackContentIndex != null) action.endContentIndex = fallbackContentIndex;
	if (action.endMarkerContentIndex < 0 && fallbackContentIndex != null) action.endMarkerContentIndex = fallbackContentIndex;
	if (action.hunkIndex < 0 || action.startContentIndex < 0 || action.endContentIndex < 0 || action.endMarkerContentIndex < 0) throw new Error(`parseMergeConflictDiffFromFile: failed to anchor merge conflict ${frame.conflictIndex}`);
	s.actions[action.conflictIndex] = action;
	builder.completed = true;
}
function handleStartMarker(s, line, lineIndex) {
	const conflictIndex = s.nextConflictIndex;
	s.nextConflictIndex++;
	s.conflictStack.push({
		conflictIndex,
		stage: "current",
		startLineIndex: lineIndex,
		markerLines: { start: line }
	});
	s.conflictBuilders[conflictIndex] = {
		completed: false,
		action: {
			conflict: {
				conflictIndex,
				startLineIndex: lineIndex,
				startLineNumber: lineIndex + 1,
				separatorLineIndex: lineIndex,
				separatorLineNumber: lineIndex + 1,
				endLineIndex: lineIndex,
				endLineNumber: lineIndex + 1,
				baseMarkerLineIndex: void 0,
				baseMarkerLineNumber: void 0
			},
			conflictIndex,
			hunkIndex: -1,
			startContentIndex: -1,
			endContentIndex: -1,
			endMarkerContentIndex: -1,
			markerLines: {
				start: line,
				separator: "",
				end: ""
			}
		}
	};
}
function createHunkBuilder(additionStart, deletionStart) {
	return {
		additionStart,
		deletionStart,
		additionCount: 0,
		deletionCount: 0,
		additionLines: 0,
		deletionLines: 0,
		additionLineIndex: Math.max(additionStart - 1, 0),
		deletionLineIndex: Math.max(deletionStart - 1, 0),
		hunkContent: [],
		contextBufferAdditionStart: Math.max(additionStart - 1, 0),
		contextBufferDeletionStart: Math.max(deletionStart - 1, 0),
		contextBufferCount: 0,
		contextBufferBaseConflicts: void 0
	};
}
function formatHunkRange(start, count) {
	return count === 1 ? `${start}` : `${start},${count}`;
}
function getMergeConflictMarkerType(line) {
	if (line.length < 7) return;
	const markerCode = line.charCodeAt(0);
	if (markerCode !== 60 && markerCode !== 62 && markerCode !== 61 && markerCode !== 124) return;
	const lineEnd = getLineContentEndIndex(line);
	if (lineEnd < 7) return;
	let markerLength = 1;
	while (markerLength < lineEnd && line.charCodeAt(markerLength) === markerCode) markerLength++;
	if (markerLength < 7) return;
	if (markerCode === 61) return markerLength === lineEnd ? "separator" : void 0;
	if (markerLength !== lineEnd && !isWhitespaceCode(line.charCodeAt(markerLength))) return;
	if (markerCode === 60) return "start";
	if (markerCode === 62) return "end";
	return "base";
}
function getLineContentEndIndex(line) {
	let end = line.length;
	if (end > 0 && line.charCodeAt(end - 1) === 10) end--;
	if (end > 0 && line.charCodeAt(end - 1) === 13) end--;
	return end;
}
function isWhitespaceCode(code) {
	return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}
function createResolvedConflictFile(file, side, contents) {
	return {
		...file,
		contents,
		cacheKey: file.cacheKey != null ? `${file.cacheKey}:merge-conflict-${side}` : void 0
	};
}
function buildMergeConflictMarkerRows(fileDiff, actions) {
	const markerRows = [];
	const hunkLineStartCache = new Array(fileDiff.hunks.length);
	const getLineStart = (hunkIndex, contentIndex) => {
		const hunk = fileDiff.hunks[hunkIndex];
		if (hunk == null) return 0;
		let starts = hunkLineStartCache[hunkIndex];
		if (starts == null) {
			starts = new Array(hunk.hunkContent.length + 1);
			let lineIndex = hunk.unifiedLineStart;
			starts[0] = lineIndex;
			for (let index = 0; index < hunk.hunkContent.length; index++) {
				const content = hunk.hunkContent[index];
				lineIndex += content.type === "context" ? content.lines : content.deletions + content.additions;
				starts[index + 1] = lineIndex;
			}
			hunkLineStartCache[hunkIndex] = starts;
		}
		return starts[Math.max(contentIndex, 0)] ?? hunk.unifiedLineStart;
	};
	const getLineEnd = (hunkIndex, contentIndex) => {
		const lineStart = getLineStart(hunkIndex, contentIndex);
		const lineEndExclusive = hunkLineStartCache[hunkIndex]?.[Math.max(contentIndex + 1, 0)] ?? getLineStart(hunkIndex, contentIndex + 1);
		return Math.max(lineStart, lineEndExclusive - 1);
	};
	for (const action of actions) {
		if (action == null) continue;
		const hunk = fileDiff.hunks[action.hunkIndex];
		if (hunk == null) continue;
		const actionLineIndex = getLineStart(action.hunkIndex, action.startContentIndex);
		markerRows.push(createMergeConflictMarkerRow(action, "marker-start", action.startContentIndex, action.markerLines.start, actionLineIndex));
		if (action.baseContentIndex != null) {
			const currentContentIndex = action.currentContentIndex;
			const incomingContentIndex = action.incomingContentIndex;
			if (currentContentIndex == null || incomingContentIndex == null) continue;
			const baseMarkerLine = action.markerLines.base;
			if (baseMarkerLine == null) continue;
			const currentChange = hunk.hunkContent[currentContentIndex];
			const baseContext = hunk.hunkContent[action.baseContentIndex];
			const incomingChange = hunk.hunkContent[incomingContentIndex];
			if (currentChange?.type !== "change" || baseContext?.type !== "context" || incomingChange?.type !== "change") continue;
			const currentStart = getLineStart(action.hunkIndex, currentContentIndex);
			const incomingStart = getLineStart(action.hunkIndex, incomingContentIndex);
			markerRows.push(createMergeConflictMarkerRow(action, "marker-base", action.baseContentIndex, baseMarkerLine, currentStart + currentChange.deletions));
			markerRows.push(createMergeConflictMarkerRow(action, "marker-separator", action.baseContentIndex, action.markerLines.separator, incomingStart), createMergeConflictMarkerRow(action, "marker-end", action.endMarkerContentIndex, action.markerLines.end, getLineEnd(action.hunkIndex, action.endMarkerContentIndex)));
			continue;
		}
		const currentContentIndex = action.currentContentIndex;
		if (currentContentIndex == null) continue;
		const content = hunk.hunkContent[currentContentIndex];
		if (content?.type !== "change") continue;
		const contentStart = getLineStart(action.hunkIndex, currentContentIndex);
		const separatorLineIndex = content.deletions > 0 ? contentStart + content.deletions : actionLineIndex;
		markerRows.push(createMergeConflictMarkerRow(action, "marker-separator", currentContentIndex, action.markerLines.separator, separatorLineIndex), createMergeConflictMarkerRow(action, "marker-end", action.endMarkerContentIndex, action.markerLines.end, getLineEnd(action.hunkIndex, action.endMarkerContentIndex)));
	}
	return markerRows;
}
function createMergeConflictMarkerRow(action, type, contentIndex, lineText, lineIndex) {
	return {
		type,
		hunkIndex: action.hunkIndex,
		contentIndex,
		conflictIndex: action.conflictIndex,
		lineText,
		lineIndex
	};
}
function getUnifiedLineStartForContent(hunk, contentIndex) {
	let lineIndex = hunk.unifiedLineStart;
	for (let index = 0; index < contentIndex; index++) {
		const content = hunk.hunkContent[index];
		lineIndex += content.type === "context" ? content.lines : content.deletions + content.additions;
	}
	return lineIndex;
}
//#endregion
export { buildMergeConflictMarkerRows, getMergeConflictActionAnchor, parseMergeConflictDiffFromFile };

//# sourceMappingURL=parseMergeConflictDiffFromFile.js.map