import { Element, ElementContent } from "../node_modules/.pnpm/@types_hast@3.0.4/node_modules/@types/hast/index.js";
import { BaseCodeOptions, DiffsHighlighter, FileContents, FileHeaderRenderMode, LineAnnotation, RenderFileOptions, RenderRange, ThemedFileResult } from "../types.js";
import { WorkerPoolManager } from "../worker/WorkerPoolManager.js";
//#region src/renderers/FileRenderer.d.ts
interface FileRenderResult {
  gutterAST: ElementContent[];
  contentAST: ElementContent[];
  preAST: Element;
  headerAST: Element | undefined;
  css: string;
  totalLines: number;
  themeStyles: string;
  baseThemeType: 'light' | 'dark' | undefined;
  rowCount: number;
  bufferBefore: number;
  bufferAfter: number;
}
interface FileRendererOptions extends BaseCodeOptions {
  headerRenderMode?: FileHeaderRenderMode;
}
declare class FileRenderer<LAnnotation = undefined> {
  options: FileRendererOptions;
  private onRenderUpdate?;
  private workerManager?;
  readonly __id: string;
  private highlighter;
  private renderCache;
  private computedLang;
  private lineAnnotations;
  private lineCache;
  constructor(options?: FileRendererOptions, onRenderUpdate?: (() => unknown) | undefined, workerManager?: WorkerPoolManager | undefined);
  setOptions(options: FileRendererOptions): void;
  mergeOptions(options: Partial<FileRendererOptions>): void;
  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]): void;
  cleanUp(): void;
  recycle(): void;
  clearRenderCache(): void;
  hydrate(file: FileContents): void;
  private getRenderOptions;
  getOrCreateLineCache(file: FileContents): string[];
  renderFile(file?: FileContents | undefined, renderRange?: RenderRange): FileRenderResult | undefined;
  asyncRender(file: FileContents, renderRange?: RenderRange): Promise<FileRenderResult>;
  private asyncHighlight;
  private renderFileWithHighlighter;
  private processFileResult;
  private renderHeader;
  renderFullHTML(result: FileRenderResult): string;
  renderFullAST(result: FileRenderResult, children?: ElementContent[]): Element;
  renderCodeAST(result: FileRenderResult): ElementContent[];
  renderPartialHTML(children: ElementContent[], includeCodeNode?: boolean): string;
  initializeHighlighter(): Promise<DiffsHighlighter>;
  onHighlightSuccess(file: FileContents, result: ThemedFileResult, options: RenderFileOptions, highlighted?: boolean): void;
  private getMatchingWorkerResultCache;
  private hasHighlightedRenderCache;
  onHighlightError(error: unknown): void;
  private getTokenizeMaxLength;
  private createPreElement;
}
//#endregion
export { FileRenderResult, FileRenderer, FileRendererOptions };
//# sourceMappingURL=FileRenderer.d.ts.map