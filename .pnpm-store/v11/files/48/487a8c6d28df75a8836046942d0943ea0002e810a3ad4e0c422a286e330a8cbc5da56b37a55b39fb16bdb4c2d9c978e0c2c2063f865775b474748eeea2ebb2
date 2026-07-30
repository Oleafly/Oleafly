import { FileContents, LineAnnotation, NumericScrollLineAnchor, PendingCodeViewLayoutReset, RenderWindow, StickySpecs, ThemeTypes, VirtualFileMetrics } from "../types.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { File, FileOptions, FileRenderProps } from "./File.js";
import { Virtualizer } from "./Virtualizer.js";
import { CodeView } from "./CodeView.js";

//#region src/components/VirtualizedFile.d.ts
declare class VirtualizedFile<LAnnotation = undefined> extends File<LAnnotation> {
  private virtualizer;
  private metrics;
  readonly __id: string;
  top: number | undefined;
  height: number;
  private cache;
  private isVisible;
  private isSetup;
  private layoutDirty;
  private forceRenderOverride;
  private currentCollapsed;
  constructor(options: FileOptions<LAnnotation> | undefined, virtualizer: Virtualizer | CodeView<LAnnotation>, metrics?: VirtualFileMetrics, workerManager?: WorkerPoolManager, isContainerManaged?: boolean);
  setMetrics(metrics: VirtualFileMetrics, force?: boolean): void;
  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]): void;
  private syncLineAnnotations;
  private hasLineAnnotations;
  getLineHeight(lineIndex: number, hasMetadataLine?: boolean): number;
  setOptions(options: FileOptions<LAnnotation> | undefined): void;
  setThemeType(themeType: ThemeTypes): void;
  private resetLayoutCache;
  reconcileHeights(): boolean;
  onRender: (dirty: boolean) => boolean;
  prepareCodeViewItem(file: FileContents, top: number, reset?: PendingCodeViewLayoutReset, lineAnnotations?: LineAnnotation<LAnnotation>[]): number;
  getLinePosition(lineNumber: number): {
    top: number;
    height: number;
  } | undefined;
  getNumericScrollAnchor(localViewportTop: number): NumericScrollLineAnchor | undefined;
  getVirtualizedHeight(): number;
  getAdvancedStickySpecs(windowSpecs?: RenderWindow): StickySpecs | undefined;
  cleanUp(recycle?: boolean): void;
  private computeApproximateSize;
  setVisibility(visible: boolean): void;
  rerender(): void;
  render({
    fileContainer,
    file,
    forceRender,
    lineAnnotations,
    ...props
  }: FileRenderProps<LAnnotation>): boolean;
  syncVirtualizedTop(): void;
  protected shouldDisableVirtualizationBuffers(): boolean;
  private isSimpleMode;
  private isAdvancedMode;
  private addLayoutCheckpoint;
  private getLayoutCheckpointBeforeLineIndex;
  private getLayoutCheckpointBeforeTop;
  private getVirtualizedTop;
  private getSimpleVirtualizer;
  private isResizeDebuggingEnabled;
  private computeRenderRangeFromWindow;
}
//#endregion
export { VirtualizedFile };
//# sourceMappingURL=VirtualizedFile.d.ts.map