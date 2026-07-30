import { BaseCodeOptions, SupportedLanguages, ThemeTypes, ThemedToken } from "../types.js";
import { RecallToken } from "../shiki-stream/types.js";
//#region src/components/FileStream.d.ts
interface FileStreamOptions extends BaseCodeOptions {
  lang?: SupportedLanguages;
  startingLineIndex?: number;
  onPreRender?(instance: FileStream): unknown;
  onPostRender?(instance: FileStream): unknown;
  onStreamStart?(controller: WritableStreamDefaultController): unknown;
  onStreamWrite?(token: ThemedToken | RecallToken): unknown;
  onStreamClose?(): unknown;
  onStreamAbort?(reason: unknown): unknown;
}
declare class FileStream {
  options: FileStreamOptions;
  readonly __id: string;
  private highlighter;
  private stream;
  private abortController;
  private fileContainer;
  private pre;
  private code;
  private gutterElement;
  private contentElement;
  private themeCSSStyle;
  private appliedThemeCSS;
  private currentRowCount;
  constructor(options?: FileStreamOptions);
  cleanUp(): void;
  setThemeType(themeType: ThemeTypes): void;
  private initializeHighlighter;
  private queuedSetupArgs;
  setup(_source: ReadableStream<string>, _wrapper: HTMLElement): Promise<void>;
  private setupStream;
  private queuedTokens;
  private handleWrite;
  private currentLineIndex;
  private currentLineElement;
  private render;
  private getOrCreateStreamColumns;
  private updateRowSpan;
  private createLine;
  private getOrCreateFileContainer;
  private applyThemeState;
}
//#endregion
export { FileStream, FileStreamOptions };
//# sourceMappingURL=FileStream.d.ts.map