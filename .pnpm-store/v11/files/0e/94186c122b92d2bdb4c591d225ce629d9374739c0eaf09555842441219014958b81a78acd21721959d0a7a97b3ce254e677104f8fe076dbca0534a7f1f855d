import { Element, ElementContent, Properties } from "../node_modules/.pnpm/@types_hast@3.0.4/node_modules/@types/hast/index.js";
import { BaseDiffOptions, BaseDiffOptionsWithDefaults, CustomPreProperties, DiffLineAnnotation, ExpansionDirections, FileDiffMetadata, FileHeaderRenderMode, HunkData, HunkExpansionRegion, LineTypes, RenderDiffOptions, RenderRange, ThemedDiffResult } from "../types.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
import { DiffLineMetadata } from "../utils/iterateOverDiff.js";

//#region src/renderers/DiffHunksRenderer.d.ts
interface DiffHunksRendererOptions extends BaseDiffOptions {
  headerRenderMode?: FileHeaderRenderMode;
}
interface DiffHunksRendererOptionsWithDefaults extends Omit<BaseDiffOptionsWithDefaults, 'themeType'> {
  headerRenderMode: FileHeaderRenderMode;
}
interface UnifiedLineDecorationProps {
  type: 'context' | 'context-expanded' | 'change';
  lineType: LineTypes;
  additionLineIndex: number | undefined;
  deletionLineIndex: number | undefined;
}
interface SplitLineDecorationProps {
  side: 'deletions' | 'additions';
  type: 'context' | 'context-expanded' | 'change';
  lineIndex: number | undefined;
}
interface LineDecoration {
  gutterLineType: LineTypes;
  gutterProperties?: Properties;
  contentProperties?: Properties;
}
interface RenderedLineContext {
  type: 'context' | 'context-expanded' | 'change';
  hunkIndex: number;
  lineIndex: number;
  unifiedLineIndex: number;
  splitLineIndex: number;
  deletionLine?: DiffLineMetadata;
  additionLine?: DiffLineMetadata;
}
interface InjectedRow {
  content: Element;
  gutter: Element;
}
interface SplitInjectedRow {
  deletion: InjectedRow | undefined;
  addition: InjectedRow | undefined;
}
interface UnifiedInjectedRowPlacement {
  before?: InjectedRow[];
  after?: InjectedRow[];
}
interface SplitInjectedRowPlacement {
  before?: SplitInjectedRow[];
  after?: SplitInjectedRow[];
}
interface HunksRenderResult {
  unifiedGutterAST: ElementContent[] | undefined;
  unifiedContentAST: ElementContent[] | undefined;
  deletionsGutterAST: ElementContent[] | undefined;
  deletionsContentAST: ElementContent[] | undefined;
  additionsGutterAST: ElementContent[] | undefined;
  additionsContentAST: ElementContent[] | undefined;
  hunkData: HunkData[];
  css: string;
  preNode: Element;
  headerElement: Element | undefined;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
  rowCount: number;
  bufferBefore: number;
  bufferAfter: number;
}
declare class DiffHunksRenderer<LAnnotation = undefined> {
  options: DiffHunksRendererOptions;
  private onRenderUpdate?;
  private workerManager?;
  readonly __id: string;
  private highlighter;
  private diff;
  private expandedHunks;
  private deletionAnnotations;
  private additionAnnotations;
  private computedLang;
  private renderCache;
  constructor(options?: DiffHunksRendererOptions, onRenderUpdate?: (() => unknown) | undefined, workerManager?: WorkerPoolManager | undefined);
  cleanUp(): void;
  recycle(): void;
  clearRenderCache(): void;
  setOptions(options: DiffHunksRendererOptions): void;
  mergeOptions(options: Partial<DiffHunksRendererOptions>): void;
  expandHunk(index: number, direction: ExpansionDirections, expansionLineCount?: number): void;
  getExpandedHunk(hunkIndex: number): HunkExpansionRegion;
  getExpandedHunksMap(): Map<number, HunkExpansionRegion>;
  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void;
  protected getUnifiedLineDecoration({
    lineType
  }: UnifiedLineDecorationProps): LineDecoration;
  protected getSplitLineDecoration({
    side,
    type
  }: SplitLineDecorationProps): LineDecoration;
  private createAnnotationElement;
  protected getUnifiedInjectedRowsForLine?: (ctx: RenderedLineContext) => UnifiedInjectedRowPlacement | undefined;
  protected getSplitInjectedRowsForLine?: (ctx: RenderedLineContext) => SplitInjectedRowPlacement | undefined;
  protected getOptionsWithDefaults(): DiffHunksRendererOptionsWithDefaults;
  private initializeHighlighter;
  hydrate(diff: FileDiffMetadata | undefined): void;
  private getRenderOptions;
  renderDiff(diff?: FileDiffMetadata | undefined, renderRange?: RenderRange): HunksRenderResult | undefined;
  asyncRender(diff: FileDiffMetadata, renderRange?: RenderRange): Promise<HunksRenderResult>;
  protected createPreElement(split: boolean, totalLines: number, customProperties?: CustomPreProperties): Element;
  private asyncHighlight;
  private renderDiffWithHighlighter;
  onHighlightSuccess(diff: FileDiffMetadata, result: ThemedDiffResult, options: RenderDiffOptions, highlighted?: boolean): void;
  private getMatchingWorkerResultCache;
  private hasHighlightedRenderCache;
  onHighlightError(error: unknown): void;
  private getTokenizeMaxLength;
  private processDiffResult;
  renderCodeAST(type: 'unified' | 'deletions' | 'additions', result: HunksRenderResult): ElementContent[] | undefined;
  renderFullAST(result: HunksRenderResult, children?: ElementContent[]): Element;
  renderFullHTML(result: HunksRenderResult, tempChildren?: ElementContent[]): string;
  renderPartialHTML(children: ElementContent[], columnType?: 'unified' | 'deletions' | 'additions'): string;
  private pushFileLevelAnnotations;
  private getAnnotations;
  private renderHeader;
}
//#endregion
export { DiffHunksRenderer, DiffHunksRendererOptions, DiffHunksRendererOptionsWithDefaults, HunksRenderResult, InjectedRow, LineDecoration, RenderedLineContext, SplitInjectedRow, SplitInjectedRowPlacement, SplitLineDecorationProps, UnifiedInjectedRowPlacement, UnifiedLineDecorationProps };
//# sourceMappingURL=DiffHunksRenderer.d.ts.map