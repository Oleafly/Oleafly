import { DiffLineAnnotation, ExpansionDirections, FileDiffMetadata, NumericScrollLineAnchor, PendingCodeViewLayoutReset, RenderWindow, SelectionSide, StickySpecs, ThemeTypes, VirtualFileMetrics } from "../types.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { FileDiff, FileDiffOptions, FileDiffRenderProps } from "./FileDiff.js";
import { Virtualizer } from "./Virtualizer.js";
import { CodeView } from "./CodeView.js";

//#region src/components/VirtualizedFileDiff.d.ts
declare class VirtualizedFileDiff<LAnnotation = undefined> extends FileDiff<LAnnotation> {
  readonly __id: string;
  top: number | undefined;
  height: number;
  private metrics;
  private cache;
  private isVisible;
  private isSetup;
  private virtualizer;
  private layoutDirty;
  private forceRenderOverride;
  private currentCollapsed;
  constructor(options: FileDiffOptions<LAnnotation> | undefined, virtualizer: Virtualizer | CodeView<LAnnotation>, metrics?: Partial<VirtualFileMetrics>, workerManager?: WorkerPoolManager, isContainerManaged?: boolean);
  setMetrics(metrics?: Partial<VirtualFileMetrics>, force?: boolean): void;
  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void;
  private syncLineAnnotations;
  private setFileAnnotationHeight;
  private hasFileAnnotations;
  private getLineHeight;
  private getEstimatedLineHeight;
  setOptions(options: FileDiffOptions<LAnnotation> | undefined): void;
  setThemeType(themeType: ThemeTypes): void;
  private resetLayoutCache;
  reconcileHeights(): boolean;
  onRender: (dirty: boolean) => boolean;
  prepareCodeViewItem(fileDiff: FileDiffMetadata, top: number, reset?: PendingCodeViewLayoutReset, lineAnnotations?: DiffLineAnnotation<LAnnotation>[]): number;
  getLinePosition(lineNumber: number, side?: SelectionSide): {
    top: number;
    height: number;
  } | undefined;
  getNumericScrollAnchor(localViewportTop: number): NumericScrollLineAnchor | undefined;
  getVirtualizedHeight(): number;
  getAdvancedStickySpecs(windowSpecs?: RenderWindow): StickySpecs | undefined;
  cleanUp(recycle?: boolean): void;
  expandHunk: (hunkIndex: number, direction: ExpansionDirections, expansionLineCountOverride?: number) => void;
  setVisibility(visible: boolean): void;
  rerender(): void;
  private computeApproximateSize;
  private getActiveEstimatedHeight;
  private ensureEstimatedDiffHeights;
  private validateComputedHeight;
  render({
    fileContainer,
    oldFile,
    newFile,
    fileDiff,
    forceRender,
    lineAnnotations,
    ...props
  }?: FileDiffRenderProps<LAnnotation>): boolean;
  syncVirtualizedTop(): void;
  protected shouldDisableVirtualizationBuffers(): boolean;
  private isSimpleMode;
  private isAdvancedMode;
  private getVirtualizedTop;
  private getSimpleVirtualizer;
  private isResizeDebuggingEnabled;
  private getDiffStyle;
  private getHunkSeparatorType;
  private approximateLayoutCheckpoints;
  private getLayoutCheckpointBeforeLineIndex;
  private getLayoutCheckpointBeforeTop;
  private getExpandedLineCount;
  private computeRenderRangeFromWindow;
}
//#endregion
export { VirtualizedFileDiff };
//# sourceMappingURL=VirtualizedFileDiff.d.ts.map