import { getDefaultHunkSeparatorHeight } from "./computeVirtualFileMetrics.js";
//#region src/utils/virtualDiffLayout.ts
function getExpandedRegion({ isPartial, rangeSize, expandedHunks, hunkIndex, collapsedContextThreshold }) {
	const normalizedRangeSize = Math.max(rangeSize, 0);
	if (normalizedRangeSize === 0 || isPartial) return {
		fromStart: 0,
		fromEnd: 0,
		rangeSize: normalizedRangeSize,
		collapsedLines: normalizedRangeSize,
		renderAll: false
	};
	if (expandedHunks === true || normalizedRangeSize <= collapsedContextThreshold) return {
		fromStart: normalizedRangeSize,
		fromEnd: 0,
		rangeSize: normalizedRangeSize,
		collapsedLines: 0,
		renderAll: true
	};
	const region = expandedHunks?.get(hunkIndex);
	const fromStart = Math.min(Math.max(region?.fromStart ?? 0, 0), normalizedRangeSize);
	const fromEnd = Math.min(Math.max(region?.fromEnd ?? 0, 0), normalizedRangeSize);
	const expandedCount = fromStart + fromEnd;
	const renderAll = expandedCount >= normalizedRangeSize;
	return {
		fromStart: renderAll ? normalizedRangeSize : fromStart,
		fromEnd: renderAll ? 0 : fromEnd,
		rangeSize: normalizedRangeSize,
		collapsedLines: Math.max(normalizedRangeSize - expandedCount, 0),
		renderAll
	};
}
function hasTrailingContext(fileDiff) {
	const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
	if (lastHunk == null || fileDiff.isPartial || fileDiff.additionLines.length === 0 || fileDiff.deletionLines.length === 0) return false;
	const additionRemaining = fileDiff.additionLines.length - (lastHunk.additionLineIndex + lastHunk.additionCount);
	const deletionRemaining = fileDiff.deletionLines.length - (lastHunk.deletionLineIndex + lastHunk.deletionCount);
	return additionRemaining > 0 || deletionRemaining > 0;
}
function getTrailingContextRangeSize({ fileDiff, errorPrefix }) {
	const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
	if (lastHunk == null || fileDiff.isPartial || fileDiff.additionLines.length === 0 || fileDiff.deletionLines.length === 0) return 0;
	const additionRemaining = fileDiff.additionLines.length - (lastHunk.additionLineIndex + lastHunk.additionCount);
	const deletionRemaining = fileDiff.deletionLines.length - (lastHunk.deletionLineIndex + lastHunk.deletionCount);
	if (additionRemaining <= 0 && deletionRemaining <= 0) return 0;
	if (additionRemaining !== deletionRemaining) throw new Error(`${errorPrefix}: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${fileDiff.name}`);
	return Math.min(additionRemaining, deletionRemaining);
}
function getTrailingExpandedRegion({ fileDiff, hunkIndex, expandedHunks, collapsedContextThreshold, errorPrefix }) {
	if (hunkIndex !== fileDiff.hunks.length - 1) return;
	const trailingRangeSize = getTrailingContextRangeSize({
		fileDiff,
		errorPrefix
	});
	if (trailingRangeSize <= 0) return;
	if (expandedHunks === true || trailingRangeSize <= collapsedContextThreshold) return {
		fromStart: trailingRangeSize,
		fromEnd: 0,
		rangeSize: trailingRangeSize,
		collapsedLines: 0,
		renderAll: true
	};
	const region = expandedHunks?.get(fileDiff.hunks.length);
	const fromStart = Math.min(Math.max(region?.fromStart ?? 0, 0), trailingRangeSize);
	return {
		fromStart,
		fromEnd: 0,
		rangeSize: trailingRangeSize,
		collapsedLines: trailingRangeSize - fromStart,
		renderAll: fromStart >= trailingRangeSize
	};
}
function getHunkSeparatorHeight({ type, metrics }) {
	return metrics.hunkSeparatorHeight ?? getDefaultHunkSeparatorHeight(type);
}
function getHunkSeparatorGap({ type, metrics }) {
	return type === "simple" || type === "metadata" || type === "line-info-basic" ? 0 : metrics.spacing;
}
function hasLeadingHunkSeparator({ type, hunkIndex, hunkSpecs }) {
	switch (type) {
		case "simple": return hunkIndex > 0;
		case "metadata": return hunkSpecs != null;
		case "line-info":
		case "line-info-basic":
		case "custom": return true;
	}
}
function hasTrailingHunkSeparator(type) {
	return type !== "simple" && type !== "metadata";
}
function getLeadingHunkSeparatorLayout({ type, metrics, hunkIndex, hunkSpecs }) {
	if (!hasLeadingHunkSeparator({
		type,
		hunkIndex,
		hunkSpecs
	})) return;
	const height = getHunkSeparatorHeight({
		type,
		metrics
	});
	const gap = getHunkSeparatorGap({
		type,
		metrics
	});
	const gapBefore = hunkIndex > 0 ? gap : 0;
	const gapAfter = gap;
	return {
		height,
		gapBefore,
		gapAfter,
		totalHeight: gapBefore + height + gapAfter
	};
}
function getTrailingHunkSeparatorLayout({ type, metrics }) {
	if (!hasTrailingHunkSeparator(type)) return;
	const height = getHunkSeparatorHeight({
		type,
		metrics
	});
	const gapBefore = getHunkSeparatorGap({
		type,
		metrics
	});
	return {
		height,
		gapBefore,
		gapAfter: 0,
		totalHeight: gapBefore + height
	};
}
//#endregion
export { getExpandedRegion, getHunkSeparatorGap, getHunkSeparatorHeight, getLeadingHunkSeparatorLayout, getTrailingContextRangeSize, getTrailingExpandedRegion, getTrailingHunkSeparatorLayout, hasLeadingHunkSeparator, hasTrailingContext, hasTrailingHunkSeparator };

//# sourceMappingURL=virtualDiffLayout.js.map