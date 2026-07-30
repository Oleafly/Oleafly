import { Element } from "../node_modules/.pnpm/@types_hast@3.0.4/node_modules/@types/hast/index.js";
import { FileDiffMetadata, MergeConflictMarkerRow, RenderRange } from "../types.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { DiffHunksRenderer, DiffHunksRendererOptions, DiffHunksRendererOptionsWithDefaults, HunksRenderResult, LineDecoration, RenderedLineContext, SplitLineDecorationProps, UnifiedInjectedRowPlacement, UnifiedLineDecorationProps } from "./DiffHunksRenderer.js";
import { MergeConflictDiffAction } from "../utils/parseMergeConflictDiffFromFile.js";

//#region src/renderers/UnresolvedFileHunksRenderer.d.ts
interface BaseUnresolvedOptionsWithDefaults extends DiffHunksRendererOptionsWithDefaults {
  mergeConflictActionsType: MergeConflictActionsType;
}
type MergeConflictActionsType = 'none' | 'default' | 'custom';
interface UnresolvedFileHunksRendererOptions extends DiffHunksRendererOptions {
  mergeConflictActionsType?: MergeConflictActionsType;
}
declare class UnresolvedFileHunksRenderer<LAnnotation = undefined> extends DiffHunksRenderer<LAnnotation> {
  private pendingConflictActions;
  private pendingMarkerRows;
  private injectedRows;
  options: UnresolvedFileHunksRendererOptions;
  constructor(options?: UnresolvedFileHunksRendererOptions, onRenderUpdate?: () => unknown, workerManager?: WorkerPoolManager | undefined);
  setConflictState(conflictActions: (MergeConflictDiffAction | undefined)[], markerRows: MergeConflictMarkerRow[], diff: FileDiffMetadata): void;
  private syncInjectedRows;
  private addInjectedRow;
  renderDiff(diff?: FileDiffMetadata | undefined, renderRange?: RenderRange): HunksRenderResult | undefined;
  asyncRender(diff: FileDiffMetadata, renderRange?: RenderRange): Promise<HunksRenderResult>;
  protected createPreElement(split: boolean, totalLines: number): Element;
  protected getUnifiedLineDecoration({
    type,
    lineType
  }: UnifiedLineDecorationProps): LineDecoration;
  protected getSplitLineDecoration({
    side,
    type
  }: SplitLineDecorationProps): LineDecoration;
  protected getUnifiedInjectedRowsForLine: (ctx: RenderedLineContext) => UnifiedInjectedRowPlacement | undefined;
  protected getOptionsWithDefaults(): BaseUnresolvedOptionsWithDefaults;
}
//#endregion
export { UnresolvedFileHunksRenderer, UnresolvedFileHunksRendererOptions };
//# sourceMappingURL=UnresolvedFileHunksRenderer.d.ts.map