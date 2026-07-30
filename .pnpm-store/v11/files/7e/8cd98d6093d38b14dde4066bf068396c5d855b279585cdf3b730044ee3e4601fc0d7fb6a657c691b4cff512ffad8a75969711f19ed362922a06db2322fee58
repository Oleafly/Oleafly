import { getVirtualFileHeaderRegion, getVirtualFilePaddingBottom } from "./computeVirtualFileMetrics.js";
import { getExpandedRegion, getLeadingHunkSeparatorLayout, getTrailingExpandedRegion, getTrailingHunkSeparatorLayout } from "./virtualDiffLayout.js";
//#region src/utils/computeEstimatedDiffHeights.ts
function computeEstimatedDiffHeights({ fileDiff, metrics, disableFileHeader, hunkSeparators, expandUnchanged, expandedHunks: configuredExpandedHunks, collapsedContextThreshold }) {
	let splitHeight = getVirtualFileHeaderRegion(metrics, disableFileHeader);
	let unifiedHeight = splitHeight;
	const expandedHunks = expandUnchanged ? true : configuredExpandedHunks;
	const finalHunkIndex = fileDiff.hunks.length - 1;
	for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex++) {
		const hunk = fileDiff.hunks[hunkIndex];
		if (hunk == null) throw new Error("computeEstimatedDiffHeights: invalid hunk index");
		const leadingRegion = getExpandedRegion({
			isPartial: fileDiff.isPartial,
			rangeSize: hunk.collapsedBefore,
			expandedHunks,
			hunkIndex,
			collapsedContextThreshold
		});
		const leadingExpandedHeight = (leadingRegion.fromStart + leadingRegion.fromEnd) * metrics.lineHeight;
		splitHeight += leadingExpandedHeight;
		unifiedHeight += leadingExpandedHeight;
		if (leadingRegion.collapsedLines > 0) {
			const separatorHeight = getLeadingHunkSeparatorLayout({
				type: hunkSeparators,
				metrics,
				hunkIndex,
				hunkSpecs: hunk.hunkSpecs
			})?.totalHeight ?? 0;
			splitHeight += separatorHeight;
			unifiedHeight += separatorHeight;
		}
		splitHeight += hunk.splitLineCount * metrics.lineHeight;
		unifiedHeight += hunk.unifiedLineCount * metrics.lineHeight;
		const metadataLineCounts = getNoNewlineMetadataLineCounts(hunk);
		splitHeight += metadataLineCounts.split * metrics.lineHeight;
		unifiedHeight += metadataLineCounts.unified * metrics.lineHeight;
		const trailingRegion = hunkIndex === finalHunkIndex ? getTrailingExpandedRegion({
			fileDiff,
			hunkIndex,
			expandedHunks,
			collapsedContextThreshold,
			errorPrefix: "computeEstimatedDiffHeights"
		}) : void 0;
		if (trailingRegion != null) {
			const trailingExpandedHeight = (trailingRegion.fromStart + trailingRegion.fromEnd) * metrics.lineHeight;
			splitHeight += trailingExpandedHeight;
			unifiedHeight += trailingExpandedHeight;
			if (trailingRegion.collapsedLines > 0) {
				const separatorHeight = getTrailingHunkSeparatorLayout({
					type: hunkSeparators,
					metrics
				})?.totalHeight ?? 0;
				splitHeight += separatorHeight;
				unifiedHeight += separatorHeight;
			}
		}
	}
	if (fileDiff.hunks.length > 0) {
		const paddingBottom = getVirtualFilePaddingBottom(metrics);
		splitHeight += paddingBottom;
		unifiedHeight += paddingBottom;
	}
	return {
		splitHeight,
		unifiedHeight
	};
}
function getNoNewlineMetadataLineCounts(hunk) {
	if (!hunk.noEOFCRAdditions && !hunk.noEOFCRDeletions) return {
		split: 0,
		unified: 0
	};
	const lastContent = hunk.hunkContent.at(-1);
	if (lastContent == null) return {
		split: 0,
		unified: 0
	};
	if (lastContent.type === "context") {
		const metadataRows = lastContent.lines > 0 ? 1 : 0;
		return {
			split: metadataRows,
			unified: metadataRows
		};
	}
	return getChangeNoNewlineMetadataLineCounts(hunk, lastContent);
}
function getChangeNoNewlineMetadataLineCounts(hunk, content) {
	const unified = (content.deletions > 0 && hunk.noEOFCRDeletions ? 1 : 0) + (content.additions > 0 && hunk.noEOFCRAdditions ? 1 : 0);
	const splitDeletionHasMetadata = content.deletions > 0 && hunk.noEOFCRDeletions;
	const splitAdditionHasMetadata = content.additions > 0 && hunk.noEOFCRAdditions;
	return {
		split: splitDeletionHasMetadata || splitAdditionHasMetadata ? 1 : 0,
		unified
	};
}
//#endregion
export { computeEstimatedDiffHeights };

//# sourceMappingURL=computeEstimatedDiffHeights.js.map