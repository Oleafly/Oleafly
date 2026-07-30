import { FileDiffMetadata, HunkExpansionRegion, HunkSeparators, VirtualFileMetrics } from "../types.js";

//#region src/utils/virtualDiffLayout.d.ts
interface ExpandedRegionResult {
  fromStart: number;
  fromEnd: number;
  rangeSize: number;
  collapsedLines: number;
  renderAll: boolean;
}
interface GetExpandedRegionProps {
  isPartial: boolean;
  rangeSize: number;
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined;
  hunkIndex: number;
  collapsedContextThreshold: number;
}
interface GetTrailingContextRangeSizeProps {
  fileDiff: FileDiffMetadata;
  errorPrefix: string;
}
interface GetTrailingExpandedRegionProps extends GetTrailingContextRangeSizeProps {
  hunkIndex: number;
  expandedHunks: GetExpandedRegionProps['expandedHunks'];
  collapsedContextThreshold: number;
}
interface HunkSeparatorLayout {
  height: number;
  gapBefore: number;
  gapAfter: number;
  totalHeight: number;
}
interface HunkSeparatorBaseProps {
  type: HunkSeparators;
  metrics: VirtualFileMetrics;
}
interface LeadingHunkSeparatorLayoutProps extends HunkSeparatorBaseProps {
  hunkIndex: number;
  hunkSpecs: string | undefined;
}
declare function getExpandedRegion({
  isPartial,
  rangeSize,
  expandedHunks,
  hunkIndex,
  collapsedContextThreshold
}: GetExpandedRegionProps): ExpandedRegionResult;
declare function hasTrailingContext(fileDiff: FileDiffMetadata): boolean;
declare function getTrailingContextRangeSize({
  fileDiff,
  errorPrefix
}: GetTrailingContextRangeSizeProps): number;
declare function getTrailingExpandedRegion({
  fileDiff,
  hunkIndex,
  expandedHunks,
  collapsedContextThreshold,
  errorPrefix
}: GetTrailingExpandedRegionProps): ExpandedRegionResult | undefined;
declare function getHunkSeparatorHeight({
  type,
  metrics
}: HunkSeparatorBaseProps): number;
declare function getHunkSeparatorGap({
  type,
  metrics
}: HunkSeparatorBaseProps): number;
declare function hasLeadingHunkSeparator({
  type,
  hunkIndex,
  hunkSpecs
}: Omit<LeadingHunkSeparatorLayoutProps, 'metrics'>): boolean;
declare function hasTrailingHunkSeparator(type: HunkSeparators): boolean;
declare function getLeadingHunkSeparatorLayout({
  type,
  metrics,
  hunkIndex,
  hunkSpecs
}: LeadingHunkSeparatorLayoutProps): HunkSeparatorLayout | undefined;
declare function getTrailingHunkSeparatorLayout({
  type,
  metrics
}: HunkSeparatorBaseProps): HunkSeparatorLayout | undefined;
//#endregion
export { ExpandedRegionResult, GetExpandedRegionProps, GetTrailingContextRangeSizeProps, GetTrailingExpandedRegionProps, HunkSeparatorLayout, getExpandedRegion, getHunkSeparatorGap, getHunkSeparatorHeight, getLeadingHunkSeparatorLayout, getTrailingContextRangeSize, getTrailingExpandedRegion, getTrailingHunkSeparatorLayout, hasLeadingHunkSeparator, hasTrailingContext, hasTrailingHunkSeparator };
//# sourceMappingURL=virtualDiffLayout.d.ts.map