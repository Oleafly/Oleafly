import { AppliedThemeStyleCache, BaseCodeOptions, FileContents, LineAnnotation, PostRenderPhase, PrePropertiesConfig, RenderFileMetadata, RenderRange, SelectedLineRange, ThemeTypes } from "../types.js";
import { GetHoveredLineResult, InteractionManager, InteractionManagerBaseOptions, SelectionWriteOptions } from "../managers/InteractionManager.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { ResizeManager } from "../managers/ResizeManager.js";
import { FileRenderer } from "../renderers/FileRenderer.js";

//#region src/components/File.d.ts
interface FileRenderProps<LAnnotation> {
  file: FileContents;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  deferManagers?: boolean;
  forceRender?: boolean;
  preventEmit?: boolean;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  renderRange?: RenderRange;
}
interface FileHydrateProps<LAnnotation> extends Omit<FileRenderProps<LAnnotation>, 'fileContainer'> {
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}
interface FileOptions<LAnnotation> extends BaseCodeOptions, InteractionManagerBaseOptions<'file'> {
  disableFileHeader?: boolean;
  renderHeaderPrefix?: RenderFileMetadata;
  renderHeaderMetadata?: RenderFileMetadata;
  renderCustomHeader?: RenderFileMetadata;
  /**
   * When true, errors during rendering are rethrown instead of being caught
   * and displayed in the DOM. Useful for testing or when you want to handle
   * errors yourself.
   */
  disableErrorHandling?: boolean;
  renderAnnotation?(annotation: LineAnnotation<LAnnotation>): HTMLElement | undefined;
  renderGutterUtility?(getHoveredRow: () => GetHoveredLineResult<'file'> | undefined): HTMLElement | null | undefined;
  onPostRender?(node: HTMLElement, instance: File<LAnnotation>, phase: PostRenderPhase): unknown;
}
interface AnnotationElementCache<LAnnotation> {
  element: HTMLElement;
  annotation: LineAnnotation<LAnnotation>;
}
interface HydrationSetup<LAnnotation> {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
}
declare class File<LAnnotation = undefined> {
  options: FileOptions<LAnnotation>;
  private workerManager?;
  private isContainerManaged;
  static LoadedCustomComponent: boolean;
  readonly __id: string;
  readonly type = "file";
  protected fileContainer: HTMLElement | undefined;
  protected spriteSVG: SVGElement | undefined;
  protected pre: HTMLPreElement | undefined;
  protected code: HTMLElement | undefined;
  protected bufferBefore: HTMLElement | undefined;
  protected bufferAfter: HTMLElement | undefined;
  protected themeCSSStyle: HTMLStyleElement | undefined;
  protected appliedThemeCSS: AppliedThemeStyleCache | undefined;
  protected hasAdoptedThemeCSS: boolean;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected appliedUnsafeCSS: string | undefined;
  protected gutterUtilityContent: HTMLElement | undefined;
  protected errorWrapper: HTMLElement | undefined;
  protected placeHolder: HTMLElement | undefined;
  protected lastRenderedHeaderHTML: string | undefined;
  protected cachedHeaderHTML: string | undefined;
  protected appliedPreAttributes: PrePropertiesConfig | undefined;
  protected lastRowCount: number | undefined;
  private mounted;
  protected headerElement: HTMLElement | undefined;
  protected headerCustom: HTMLElement | undefined;
  protected headerPrefix: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;
  protected fileRenderer: FileRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected interactionManager: InteractionManager<'file'>;
  protected annotationCache: Map<string, AnnotationElementCache<LAnnotation>>;
  protected lineAnnotations: LineAnnotation<LAnnotation>[];
  protected managersDirty: boolean;
  file: FileContents | undefined;
  protected renderRange: RenderRange | undefined;
  protected enabled: boolean;
  constructor(options?: FileOptions<LAnnotation>, workerManager?: WorkerPoolManager | undefined, isContainerManaged?: boolean);
  private handleHighlightRender;
  rerender(): void;
  onThemeChange(): void;
  setOptions(options: FileOptions<LAnnotation> | undefined): void;
  protected syncInteractionOptions(): void;
  private mergeOptions;
  setThemeType(themeType: ThemeTypes): void;
  private applyCachedThemeState;
  private hasThemeChanged;
  getHoveredLine: () => GetHoveredLineResult<'file'> | undefined;
  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]): void;
  setSelectedLines(range: SelectedLineRange | null, options?: SelectionWriteOptions): void;
  flushManagers(): void;
  cleanUp(recycle?: boolean): void;
  virtualizedSetup(): void;
  hydrate(props: FileHydrateProps<LAnnotation>): void;
  protected hydrateElements(fileContainer: HTMLElement, prerenderedHTML: string | undefined): void;
  protected hydrationSetup({
    file,
    lineAnnotations
  }: HydrationSetup<LAnnotation>): void;
  getOrCreateLineCache(file?: FileContents | undefined): string[];
  render({
    file,
    fileContainer,
    forceRender,
    preventEmit,
    containerWrapper,
    deferManagers,
    lineAnnotations,
    renderRange
  }: FileRenderProps<LAnnotation>): boolean;
  private emitPostRender;
  private removeRenderedCode;
  private clearAuxiliaryNodes;
  private canPartiallyRender;
  renderPlaceholder(height: number): boolean;
  primeHighlightCache(): void;
  private cleanChildNodes;
  private renderAnnotations;
  private renderGutterUtility;
  private injectUnsafeCSS;
  private applyThemeState;
  private hydrateMeasuredScrollbar;
  private applyFullRender;
  private applyPartialRender;
  private getColumns;
  private trimDOMToOverlap;
  private getDOMBoundaryIndices;
  private getLineIndexFromDOMNode;
  private applyBuffers;
  protected shouldDisableVirtualizationBuffers(): boolean;
  private applyHeaderToDOM;
  private clearHeaderSlots;
  private upsertHeaderSlotElement;
  private replaceHeaderSlotContent;
  private createHeaderSlotElement;
  protected getOrCreateFileContainerNode(fileContainer?: HTMLElement, parentNode?: HTMLElement): HTMLElement;
  private adoptReusableShellElements;
  private ensureSpriteSVG;
  private getOrCreatePreNode;
  private syncCodeNodeFromPre;
  private applyPreNodeAttributes;
  private applyErrorToDOM;
  private cleanupErrorWrapper;
}
//#endregion
export { File, FileHydrateProps, FileOptions, FileRenderProps };
//# sourceMappingURL=File.d.ts.map