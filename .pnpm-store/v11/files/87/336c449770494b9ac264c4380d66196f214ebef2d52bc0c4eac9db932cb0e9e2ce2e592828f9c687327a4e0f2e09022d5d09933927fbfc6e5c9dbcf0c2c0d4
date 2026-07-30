import { AppliedThemeStyleCache, BaseDiffOptions, CustomPreProperties, DiffLineAnnotation, ExpansionDirections, FileContents, FileDiffMetadata, HunkData, HunkSeparators, PostRenderPhase, PrePropertiesConfig, RenderHeaderMetadataCallback, RenderHeaderPrefixCallback, RenderRange, SelectedLineRange, ThemeTypes } from "../types.js";
import { GetHoveredLineResult, GetLineIndexUtility, InteractionManager, InteractionManagerBaseOptions, SelectionWriteOptions } from "../managers/InteractionManager.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { ResizeManager } from "../managers/ResizeManager.js";
import { ScrollSyncManager } from "../managers/ScrollSyncManager.js";
import { DiffHunksRenderer, DiffHunksRendererOptions, HunksRenderResult } from "../renderers/DiffHunksRenderer.js";

//#region src/components/FileDiff.d.ts
interface FileDiffRenderProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  deferManagers?: boolean;
  forceRender?: boolean;
  preventEmit?: boolean;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  renderRange?: RenderRange;
}
interface FileDiffHydrationProps<LAnnotation> extends Omit<FileDiffRenderProps<LAnnotation>, 'fileContainer'> {
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}
type FileDiffType = 'file-diff' | 'unresolved-file';
interface FileDiffOptions<LAnnotation> extends Omit<BaseDiffOptions, 'hunkSeparators'>, InteractionManagerBaseOptions<'diff'> {
  hunkSeparators?: Exclude<HunkSeparators, 'custom'>
  /**
  * @deprecated Custom hunk separator functions are deprecated and will be
  * removed in a future version.
  */
  | ((hunk: HunkData, instance: FileDiff<LAnnotation>) => HTMLElement | DocumentFragment | null | undefined);
  disableFileHeader?: boolean;
  renderHeaderPrefix?: RenderHeaderPrefixCallback;
  renderHeaderMetadata?: RenderHeaderMetadataCallback;
  renderCustomHeader?: RenderHeaderMetadataCallback;
  /**
   * When true, errors during rendering are rethrown instead of being caught
   * and displayed in the DOM. Useful for testing or when you want to handle
   * errors yourself.
   */
  disableErrorHandling?: boolean;
  renderAnnotation?(annotation: DiffLineAnnotation<LAnnotation>): HTMLElement | undefined;
  renderGutterUtility?(getHoveredRow: () => GetHoveredLineResult<'diff'> | undefined): HTMLElement | null | undefined;
  onPostRender?(node: HTMLElement, instance: FileDiff<LAnnotation>, phase: PostRenderPhase): unknown;
}
interface AnnotationElementCache<LAnnotation> {
  element: HTMLElement;
  annotation: DiffLineAnnotation<LAnnotation>;
}
interface CustomHunkElementCache {
  element: HTMLElement;
  hunkData: HunkData;
}
interface HydrationSetup<LAnnotation> {
  fileDiff: FileDiffMetadata | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  oldFile?: FileContents;
  newFile?: FileContents;
}
declare class FileDiff<LAnnotation = undefined> {
  options: FileDiffOptions<LAnnotation>;
  protected workerManager?: WorkerPoolManager | undefined;
  protected isContainerManaged: boolean;
  static LoadedCustomComponent: boolean;
  readonly __id: string;
  readonly type: FileDiffType;
  protected fileContainer: HTMLElement | undefined;
  protected spriteSVG: SVGElement | undefined;
  protected pre: HTMLPreElement | undefined;
  protected codeUnified: HTMLElement | undefined;
  protected codeDeletions: HTMLElement | undefined;
  protected codeAdditions: HTMLElement | undefined;
  protected bufferBefore: HTMLElement | undefined;
  protected bufferAfter: HTMLElement | undefined;
  protected themeCSSStyle: HTMLStyleElement | undefined;
  protected appliedThemeCSS: AppliedThemeStyleCache | undefined;
  protected hasAdoptedThemeCSS: boolean;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected appliedUnsafeCSS: string | undefined;
  protected gutterUtilityContent: HTMLElement | undefined;
  protected headerElement: HTMLElement | undefined;
  protected headerPrefix: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;
  protected headerCustom: HTMLElement | undefined;
  protected separatorCache: Map<string, CustomHunkElementCache>;
  protected errorWrapper: HTMLElement | undefined;
  protected placeHolder: HTMLElement | undefined;
  protected hunksRenderer: DiffHunksRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected scrollSyncManager: ScrollSyncManager;
  protected interactionManager: InteractionManager<'diff'>;
  protected annotationCache: Map<string, AnnotationElementCache<LAnnotation>>;
  protected lineAnnotations: DiffLineAnnotation<LAnnotation>[];
  protected managersDirty: boolean;
  protected deletionFile: FileContents | undefined;
  protected additionFile: FileContents | undefined;
  fileDiff: FileDiffMetadata | undefined;
  protected renderRange: RenderRange | undefined;
  protected appliedPreAttributes: PrePropertiesConfig | undefined;
  protected lastRenderedHeaderHTML: string | undefined;
  protected cachedHeaderHTML: string | undefined;
  protected lastRowCount: number | undefined;
  private mounted;
  protected enabled: boolean;
  constructor(options?: FileDiffOptions<LAnnotation>, workerManager?: WorkerPoolManager | undefined, isContainerManaged?: boolean);
  protected handleHighlightRender: () => void;
  protected getHunksRendererOptions(options: FileDiffOptions<LAnnotation>): DiffHunksRendererOptions;
  protected createHunksRenderer(options: FileDiffOptions<LAnnotation>): DiffHunksRenderer<LAnnotation>;
  getLineIndex: GetLineIndexUtility;
  setOptions(options: FileDiffOptions<LAnnotation> | undefined): void;
  protected syncInteractionOptions(): void;
  private mergeOptions;
  setThemeType(themeType: ThemeTypes): void;
  private applyCachedThemeState;
  private hasThemeChanged;
  getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined;
  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void;
  private canPartiallyRender;
  setSelectedLines(range: SelectedLineRange | null, options?: SelectionWriteOptions): void;
  flushManagers(): void;
  cleanUp(recycle?: boolean): void;
  virtualizedSetup(): void;
  hydrate(props: FileDiffHydrationProps<LAnnotation>): void;
  protected hydrateElements(fileContainer: HTMLElement, prerenderedHTML: string | undefined): void;
  protected hydrationSetup({
    fileDiff,
    oldFile,
    newFile,
    lineAnnotations
  }: HydrationSetup<LAnnotation>): void;
  rerender(): void;
  onThemeChange(): void;
  handleExpandHunk: (hunkIndex: number, direction: ExpansionDirections, expansionLineCountOverride?: number) => void;
  expandHunk: (hunkIndex: number, direction: ExpansionDirections, expansionLineCountOverride?: number) => void;
  render({
    oldFile,
    newFile,
    fileDiff,
    deferManagers,
    forceRender,
    preventEmit,
    lineAnnotations,
    fileContainer,
    containerWrapper,
    renderRange
  }: FileDiffRenderProps<LAnnotation>): boolean;
  protected emitPostRender(unmount?: boolean): void;
  private removeRenderedCode;
  private clearAuxiliaryNodes;
  renderPlaceholder(height: number): boolean;
  primeHighlightCache(): void;
  private cleanChildNodes;
  private renderSeparators;
  protected renderAnnotations(): void;
  protected renderGutterUtility(): void;
  protected getOrCreateFileContainer(fileContainer?: HTMLElement, parentNode?: HTMLElement): HTMLElement;
  private adoptReusableShellElements;
  private ensureSpriteSVG;
  private getOrCreatePreNode;
  protected syncCodeNodesFromPre(pre: HTMLPreElement): void;
  private applyHeaderToDOM;
  private clearHeaderSlots;
  private upsertHeaderSlotElement;
  private replaceHeaderSlotContent;
  private createHeaderSlotElement;
  protected injectUnsafeCSS(): void;
  private applyThemeState;
  private hydrateMeasuredScrollbar;
  private applyHunksToDOM;
  private applyPartialRender;
  private insertPartialHTML;
  private renderPartialColumn;
  private mergeBuffersIfNecessary;
  private applyRowSpan;
  private trimColumnRows;
  private trimColumns;
  private getBufferSize;
  private updateBufferSize;
  private getCodeColumns;
  private applyBuffers;
  protected shouldDisableVirtualizationBuffers(): boolean;
  protected applyPreNodeAttributes(pre: HTMLPreElement, {
    additionsContentAST,
    deletionsContentAST,
    totalLines
  }: HunksRenderResult, customProperties?: CustomPreProperties): void;
  private applyErrorToDOM;
  private cleanupErrorWrapper;
}
//#endregion
export { FileDiff, FileDiffHydrationProps, FileDiffOptions, FileDiffRenderProps, FileDiffType };
//# sourceMappingURL=FileDiff.d.ts.map