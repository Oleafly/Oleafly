import "../constants.js";
import { getExpandedRegion, getTrailingExpandedRegion } from "./virtualDiffLayout.js";
//#region src/utils/iterateOverDiff.ts
function iterateOverDiff({ diff, diffStyle, startingLine = 0, totalLines = Infinity, expandedHunks, collapsedContextThreshold = 1, callback }) {
	const iterationStart = getIterationStartState({
		diff,
		diffStyle,
		startingLine,
		expandedHunks,
		collapsedContextThreshold
	});
	const state = {
		viewportStart: startingLine,
		viewportEnd: startingLine + totalLines,
		isWindowedHighlight: startingLine > 0 || totalLines < Infinity,
		splitCount: iterationStart.splitCount,
		unifiedCount: iterationStart.unifiedCount,
		finalHunkIndex: diff.hunks.length - 1,
		shouldBreak() {
			if (!state.isWindowedHighlight) return false;
			const breakUnified = state.unifiedCount >= startingLine + totalLines;
			const breakSplit = state.splitCount >= startingLine + totalLines;
			if (diffStyle === "unified") return breakUnified;
			else if (diffStyle === "split") return breakSplit;
			else return breakUnified && breakSplit;
		},
		shouldSkip(unifiedHeight, splitHeight) {
			if (!state.isWindowedHighlight) return false;
			const skipUnified = state.unifiedCount + unifiedHeight < startingLine;
			const skipSplit = state.splitCount + splitHeight < startingLine;
			if (diffStyle === "unified") return skipUnified;
			else if (diffStyle === "split") return skipSplit;
			else return skipUnified && skipSplit;
		},
		incrementCounts(unifiedValue, splitValue) {
			if (diffStyle === "unified" || diffStyle === "both") state.unifiedCount += unifiedValue;
			if (diffStyle === "split" || diffStyle === "both") state.splitCount += splitValue;
		},
		isInWindow(unifiedHeight, splitHeight) {
			if (!state.isWindowedHighlight) return true;
			const unifiedInWindow = state.isInUnifiedWindow(unifiedHeight);
			const splitInWindow = state.isInSplitWindow(splitHeight);
			if (diffStyle === "unified") return unifiedInWindow;
			else if (diffStyle === "split") return splitInWindow;
			else return unifiedInWindow || splitInWindow;
		},
		isInUnifiedWindow(unifiedHeight) {
			return !state.isWindowedHighlight || state.unifiedCount >= startingLine - unifiedHeight && state.unifiedCount < startingLine + totalLines;
		},
		isInSplitWindow(splitHeight) {
			return !state.isWindowedHighlight || state.splitCount >= startingLine - splitHeight && state.splitCount < startingLine + totalLines;
		},
		emit(props, silent = false) {
			if (!silent) if (diffStyle === "unified") state.incrementCounts(1, 0);
			else if (diffStyle === "split") state.incrementCounts(0, 1);
			else state.incrementCounts(1, 1);
			return callback(props) ?? false;
		}
	};
	hunkIterator: for (let hunkIndex = iterationStart.hunkIndex; hunkIndex < diff.hunks.length; hunkIndex++) {
		const hunk = diff.hunks[hunkIndex];
		if (hunk == null) throw new Error("iterateOverDiff: invalid hunk index");
		if (state.shouldBreak()) break;
		const leadingRegion = getExpandedRegion({
			isPartial: diff.isPartial,
			rangeSize: hunk.collapsedBefore,
			expandedHunks,
			hunkIndex,
			collapsedContextThreshold
		});
		const trailingRegion = hunkIndex === state.finalHunkIndex ? getTrailingExpandedRegion({
			fileDiff: diff,
			hunkIndex,
			expandedHunks,
			collapsedContextThreshold,
			errorPrefix: "iterateOverDiff"
		}) : void 0;
		const expandedLineCount = leadingRegion.fromStart + leadingRegion.fromEnd;
		function getTrailingCollapsedAfter(unifiedLineIndex, splitLineIndex) {
			if (trailingRegion == null || trailingRegion.collapsedLines <= 0 || trailingRegion.fromStart + trailingRegion.fromEnd > 0) return 0;
			if (diffStyle === "unified") return unifiedLineIndex === hunk.unifiedLineStart + hunk.unifiedLineCount - 1 ? trailingRegion.collapsedLines : 0;
			return splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1 ? trailingRegion.collapsedLines : 0;
		}
		let consumedCollapsed = leadingRegion.collapsedLines === 0;
		function consumePendingCollapsed() {
			if (consumedCollapsed) return 0;
			consumedCollapsed = true;
			return leadingRegion.collapsedLines;
		}
		if (!state.shouldSkip(expandedLineCount, expandedLineCount)) {
			let unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.rangeSize;
			let splitLineIndex = hunk.splitLineStart - leadingRegion.rangeSize;
			let deletionLineIndex = hunk.deletionLineIndex - leadingRegion.rangeSize;
			let additionLineIndex = hunk.additionLineIndex - leadingRegion.rangeSize;
			let deletionLineNumber = hunk.deletionStart - leadingRegion.rangeSize;
			let additionLineNumber = hunk.additionStart - leadingRegion.rangeSize;
			if (walkContextLines(state, leadingRegion.fromStart, diffStyle, (index) => {
				return state.emit({
					hunkIndex,
					hunk,
					collapsedBefore: 0,
					collapsedAfter: 0,
					type: "context-expanded",
					deletionLine: {
						lineNumber: deletionLineNumber + index,
						lineIndex: deletionLineIndex + index,
						noEOFCR: false,
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index
					},
					additionLine: {
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index,
						lineIndex: additionLineIndex + index,
						lineNumber: additionLineNumber + index,
						noEOFCR: false
					}
				});
			})) break hunkIterator;
			unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.fromEnd;
			splitLineIndex = hunk.splitLineStart - leadingRegion.fromEnd;
			deletionLineIndex = hunk.deletionLineIndex - leadingRegion.fromEnd;
			additionLineIndex = hunk.additionLineIndex - leadingRegion.fromEnd;
			deletionLineNumber = hunk.deletionStart - leadingRegion.fromEnd;
			additionLineNumber = hunk.additionStart - leadingRegion.fromEnd;
			if (walkContextLines(state, leadingRegion.fromEnd, diffStyle, (index) => {
				return state.emit({
					hunkIndex,
					hunk,
					collapsedBefore: consumePendingCollapsed(),
					collapsedAfter: 0,
					type: "context-expanded",
					deletionLine: {
						lineNumber: deletionLineNumber + index,
						lineIndex: deletionLineIndex + index,
						noEOFCR: false,
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index
					},
					additionLine: {
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index,
						lineIndex: additionLineIndex + index,
						lineNumber: additionLineNumber + index,
						noEOFCR: false
					}
				});
			}, () => {
				consumePendingCollapsed();
			})) break hunkIterator;
		} else {
			state.incrementCounts(expandedLineCount, expandedLineCount);
			consumePendingCollapsed();
		}
		let unifiedLineIndex = hunk.unifiedLineStart;
		let splitLineIndex = hunk.splitLineStart;
		let deletionLineIndex = hunk.deletionLineIndex;
		let additionLineIndex = hunk.additionLineIndex;
		let deletionLineNumber = hunk.deletionStart;
		let additionLineNumber = hunk.additionStart;
		const lastContent = hunk.hunkContent.at(-1);
		for (const content of hunk.hunkContent) {
			if (state.shouldBreak()) break hunkIterator;
			const isLastContent = content === lastContent;
			if (content.type === "context") {
				if (!state.shouldSkip(content.lines, content.lines)) {
					if (walkContextLines(state, content.lines, diffStyle, (index) => {
						const isLastLine = isLastContent && index === content.lines - 1;
						const unifiedRowIndex = unifiedLineIndex + index;
						const splitRowIndex = splitLineIndex + index;
						return state.emit({
							hunkIndex,
							hunk,
							collapsedBefore: consumePendingCollapsed(),
							collapsedAfter: getTrailingCollapsedAfter(unifiedRowIndex, splitRowIndex),
							type: "context",
							deletionLine: {
								lineNumber: deletionLineNumber + index,
								lineIndex: deletionLineIndex + index,
								noEOFCR: isLastLine && hunk.noEOFCRDeletions,
								unifiedLineIndex: unifiedRowIndex,
								splitLineIndex: splitRowIndex
							},
							additionLine: {
								unifiedLineIndex: unifiedRowIndex,
								splitLineIndex: splitRowIndex,
								lineIndex: additionLineIndex + index,
								lineNumber: additionLineNumber + index,
								noEOFCR: isLastLine && hunk.noEOFCRAdditions
							}
						});
					}, () => {
						consumePendingCollapsed();
					})) break hunkIterator;
				} else {
					state.incrementCounts(content.lines, content.lines);
					consumePendingCollapsed();
				}
				unifiedLineIndex += content.lines;
				splitLineIndex += content.lines;
				deletionLineIndex += content.lines;
				additionLineIndex += content.lines;
				deletionLineNumber += content.lines;
				additionLineNumber += content.lines;
			} else {
				const splitCount = Math.max(content.deletions, content.additions);
				const unifiedCount = content.deletions + content.additions;
				if (!state.shouldSkip(unifiedCount, splitCount)) {
					const iterationRanges = getChangeIterationRanges(state, content, diffStyle);
					if ((iterationRanges[0]?.[0] ?? 0) > 0) consumePendingCollapsed();
					for (const [rangeStart, rangeEnd] of iterationRanges) for (let index = rangeStart; index < rangeEnd; index++) {
						const collapsedAfter = getTrailingCollapsedAfter(unifiedLineIndex + index, diffStyle === "unified" ? splitLineIndex + (index < content.deletions ? index : index - content.deletions) : splitLineIndex + index);
						if (state.emit(getChangeLineData({
							hunkIndex,
							hunk,
							collapsedBefore: consumePendingCollapsed(),
							collapsedAfter,
							diffStyle,
							index,
							unifiedLineIndex,
							splitLineIndex,
							additionLineIndex,
							deletionLineIndex,
							additionLineNumber,
							deletionLineNumber,
							content,
							isLastContent,
							unifiedCount,
							splitCount
						}), true)) break hunkIterator;
					}
				}
				consumePendingCollapsed();
				state.incrementCounts(unifiedCount, splitCount);
				unifiedLineIndex += unifiedCount;
				splitLineIndex += splitCount;
				deletionLineIndex += content.deletions;
				additionLineIndex += content.additions;
				deletionLineNumber += content.deletions;
				additionLineNumber += content.additions;
			}
		}
		if (trailingRegion != null) {
			const { collapsedLines, fromStart, fromEnd } = trailingRegion;
			const len = fromStart + fromEnd;
			if (walkContextLines(state, len, diffStyle, (index) => {
				const isLastLine = index === len - 1;
				return state.emit({
					hunkIndex: diff.hunks.length,
					hunk: void 0,
					collapsedBefore: 0,
					collapsedAfter: isLastLine ? collapsedLines : 0,
					type: "context-expanded",
					deletionLine: {
						lineNumber: deletionLineNumber + index,
						lineIndex: deletionLineIndex + index,
						noEOFCR: false,
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index
					},
					additionLine: {
						unifiedLineIndex: unifiedLineIndex + index,
						splitLineIndex: splitLineIndex + index,
						lineIndex: additionLineIndex + index,
						lineNumber: additionLineNumber + index,
						noEOFCR: false
					}
				});
			}, void 0, () => state.shouldBreak())) break hunkIterator;
		}
	}
}
function getIterationStartState({ diff, diffStyle, startingLine, expandedHunks, collapsedContextThreshold }) {
	if (startingLine <= 0 || diffStyle === "both") return {
		hunkIndex: 0,
		splitCount: 0,
		unifiedCount: 0
	};
	const prefixCounts = getHunkPrefixCounts({
		diff,
		expandedHunks,
		collapsedContextThreshold
	});
	let low = 0;
	let high = diff.hunks.length - 1;
	let result = diff.hunks.length;
	while (low <= high) {
		const mid = low + high >> 1;
		const counts = prefixCounts[mid + 1];
		if (counts == null) throw new Error("iterateOverDiff: invalid hunk prefix index");
		if ((diffStyle === "unified" ? counts.unifiedCount : counts.splitCount) > startingLine) {
			result = mid;
			high = mid - 1;
		} else low = mid + 1;
	}
	if (result >= diff.hunks.length) {
		const counts = prefixCounts[diff.hunks.length];
		if (counts == null) throw new Error("iterateOverDiff: invalid terminal hunk prefix index");
		return {
			hunkIndex: diff.hunks.length,
			splitCount: counts.splitCount,
			unifiedCount: counts.unifiedCount
		};
	}
	const counts = prefixCounts[result];
	if (counts == null) throw new Error("iterateOverDiff: invalid selected hunk prefix index");
	return {
		hunkIndex: result,
		splitCount: counts.splitCount,
		unifiedCount: counts.unifiedCount
	};
}
function getHunkPrefixCounts({ diff, expandedHunks, collapsedContextThreshold }) {
	let splitCount = 0;
	let unifiedCount = 0;
	const finalHunkIndex = diff.hunks.length - 1;
	const prefixCounts = [{
		splitCount: 0,
		unifiedCount: 0
	}];
	for (let index = 0; index < diff.hunks.length; index++) {
		const hunk = diff.hunks[index];
		if (hunk == null) throw new Error("iterateOverDiff: invalid hunk summary index");
		const leadingRegion = getExpandedRegion({
			isPartial: diff.isPartial,
			rangeSize: hunk.collapsedBefore,
			expandedHunks,
			hunkIndex: index,
			collapsedContextThreshold
		});
		const leadingCount = leadingRegion.fromStart + leadingRegion.fromEnd;
		splitCount += leadingCount + hunk.splitLineCount;
		unifiedCount += leadingCount + hunk.unifiedLineCount;
		const trailingRegion = index === finalHunkIndex ? getTrailingExpandedRegion({
			fileDiff: diff,
			hunkIndex: index,
			expandedHunks,
			collapsedContextThreshold,
			errorPrefix: "iterateOverDiff"
		}) : void 0;
		if (trailingRegion != null) {
			const trailingCount = trailingRegion.fromStart + trailingRegion.fromEnd;
			splitCount += trailingCount;
			unifiedCount += trailingCount;
		}
		prefixCounts.push({
			splitCount,
			unifiedCount
		});
	}
	return prefixCounts;
}
function getContextLineIterationBounds(state, count, diffStyle) {
	if (!state.isWindowedHighlight || count <= 0) return [0, count];
	const ranges = [];
	function pushRange(currentCount) {
		const start = Math.max(0, state.viewportStart - currentCount);
		const end = Math.min(count, state.viewportEnd - currentCount);
		if (end > start) ranges.push([start, end]);
	}
	if (diffStyle !== "split") pushRange(state.unifiedCount);
	if (diffStyle !== "unified") pushRange(state.splitCount);
	if (ranges.length === 0) return [0, 0];
	let start = ranges[0][0];
	let end = ranges[0][1];
	for (let index = 1; index < ranges.length; index++) {
		const range = ranges[index];
		start = Math.min(start, range[0]);
		end = Math.max(end, range[1]);
	}
	return [start, end];
}
function walkContextLines(state, count, diffStyle, callback, onSkippedStart, shouldBreak) {
	const [startIndex, endIndex] = getContextLineIterationBounds(state, count, diffStyle);
	if (startIndex > 0) {
		state.incrementCounts(startIndex, startIndex);
		onSkippedStart?.();
	}
	let index = startIndex;
	while (index < count) {
		if (shouldBreak?.() === true) return true;
		if (index >= endIndex) {
			state.incrementCounts(count - index, count - index);
			break;
		}
		if (state.isInWindow(0, 0)) {
			if (callback(index) === true) return true;
		} else state.incrementCounts(1, 1);
		index++;
	}
	return false;
}
function getChangeIterationRanges(state, content, diffStyle) {
	if (!state.isWindowedHighlight) return [[0, diffStyle === "unified" ? content.deletions + content.additions : Math.max(content.deletions, content.additions)]];
	const useUnified = diffStyle !== "split";
	const useSplit = diffStyle !== "unified";
	const iterationSpace = diffStyle === "unified" ? "unified" : "split";
	const iterationRanges = [];
	function getVisibleRange(start, count) {
		if (start + count <= state.viewportStart || start >= state.viewportEnd) return;
		const visibleStart = Math.max(0, state.viewportStart - start);
		const visibleEnd = Math.min(count, state.viewportEnd - start);
		return visibleEnd > visibleStart ? [visibleStart, visibleEnd] : void 0;
	}
	function mapRangeToIteration(range, kind) {
		if (iterationSpace === "split") return range;
		return kind === "additions" ? [range[0] + content.deletions, range[1] + content.deletions] : range;
	}
	function pushRange(range, kind) {
		if (range == null) return;
		const [start, end] = mapRangeToIteration(range, kind);
		if (end > start) iterationRanges.push([start, end]);
	}
	if (useUnified) {
		pushRange(getVisibleRange(state.unifiedCount, content.deletions), "deletions");
		pushRange(getVisibleRange(state.unifiedCount + content.deletions, content.additions), "additions");
	}
	if (useSplit) {
		pushRange(getVisibleRange(state.splitCount, content.deletions), "deletions");
		pushRange(getVisibleRange(state.splitCount, content.additions), "additions");
	}
	if (iterationRanges.length === 0) return iterationRanges;
	iterationRanges.sort((a, b) => a[0] - b[0]);
	const merged = [iterationRanges[0]];
	for (const [start, end] of iterationRanges.slice(1)) {
		const last = merged[merged.length - 1];
		if (start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}
function getChangeLineData({ hunkIndex, hunk, collapsedAfter, collapsedBefore, diffStyle, index, unifiedLineIndex, splitLineIndex, additionLineIndex, deletionLineIndex, additionLineNumber, deletionLineNumber, content, isLastContent, unifiedCount, splitCount }) {
	const unifiedDeletionLineIndex = index < content.deletions ? unifiedLineIndex + index : void 0;
	const unifiedAdditionLineIndex = diffStyle === "unified" ? index >= content.deletions ? unifiedLineIndex + index : void 0 : index < content.additions ? unifiedLineIndex + content.deletions + index : void 0;
	const resolvedSplitLineIndex = diffStyle === "unified" ? splitLineIndex + (index < content.deletions ? index : index - content.deletions) : splitLineIndex + index;
	const deletionLineIndexValue = index < content.deletions ? deletionLineIndex + index : void 0;
	const deletionLineNumberValue = index < content.deletions ? deletionLineNumber + index : void 0;
	const additionLineIndexValue = diffStyle === "unified" ? index >= content.deletions ? additionLineIndex + (index - content.deletions) : void 0 : index < content.additions ? additionLineIndex + index : void 0;
	const additionLineNumberValue = diffStyle === "unified" ? index >= content.deletions ? additionLineNumber + (index - content.deletions) : void 0 : index < content.additions ? additionLineNumber + index : void 0;
	const noEOFCRDeletion = diffStyle === "unified" ? isLastContent && index === content.deletions - 1 && hunk.noEOFCRDeletions : isLastContent && index === splitCount - 1 && hunk.noEOFCRDeletions;
	const noEOFCRAddition = diffStyle === "unified" ? isLastContent && index === unifiedCount - 1 && hunk.noEOFCRAdditions : isLastContent && index === splitCount - 1 && hunk.noEOFCRAdditions;
	const deletionLine = deletionLineIndexValue != null && deletionLineNumberValue != null && unifiedDeletionLineIndex != null ? {
		lineNumber: deletionLineNumberValue,
		lineIndex: deletionLineIndexValue,
		noEOFCR: noEOFCRDeletion,
		unifiedLineIndex: unifiedDeletionLineIndex,
		splitLineIndex: resolvedSplitLineIndex
	} : void 0;
	const additionLine = additionLineIndexValue != null && additionLineNumberValue != null && unifiedAdditionLineIndex != null ? {
		unifiedLineIndex: unifiedAdditionLineIndex,
		splitLineIndex: resolvedSplitLineIndex,
		lineIndex: additionLineIndexValue,
		lineNumber: additionLineNumberValue,
		noEOFCR: noEOFCRAddition
	} : void 0;
	if (deletionLine == null && additionLine != null) return {
		type: "change",
		hunkIndex,
		hunk,
		collapsedAfter,
		collapsedBefore,
		deletionLine: void 0,
		additionLine
	};
	else if (deletionLine != null && additionLine == null) return {
		type: "change",
		hunkIndex,
		hunk,
		collapsedAfter,
		collapsedBefore,
		deletionLine,
		additionLine: void 0
	};
	if (deletionLine == null || additionLine == null) throw new Error("iterateOverDiff: missing change line data");
	return {
		type: "change",
		hunkIndex,
		hunk,
		collapsedAfter,
		collapsedBefore,
		deletionLine,
		additionLine
	};
}
//#endregion
export { iterateOverDiff };

//# sourceMappingURL=iterateOverDiff.js.map