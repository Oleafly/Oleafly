import { FileDiffMetadata, HunkExpansionRegion, HunkSeparators, VirtualFileMetrics } from "../types.js";

//#region src/utils/computeEstimatedDiffHeights.d.ts
interface ComputeEstimatedDiffHeightsOptions {
  fileDiff: FileDiffMetadata;
  metrics: VirtualFileMetrics;
  disableFileHeader: boolean;
  hunkSeparators: HunkSeparators;
  expandUnchanged: boolean;
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined;
  collapsedContextThreshold: number;
}
interface EstimatedDiffHeights {
  splitHeight: number;
  unifiedHeight: number;
}
declare function computeEstimatedDiffHeights({
  fileDiff,
  metrics,
  disableFileHeader,
  hunkSeparators,
  expandUnchanged,
  expandedHunks: configuredExpandedHunks,
  collapsedContextThreshold
}: ComputeEstimatedDiffHeightsOptions): EstimatedDiffHeights;
//#endregion
export { ComputeEstimatedDiffHeightsOptions, EstimatedDiffHeights, computeEstimatedDiffHeights };
//# sourceMappingURL=computeEstimatedDiffHeights.d.ts.map