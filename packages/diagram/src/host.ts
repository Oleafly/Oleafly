/**
 * Services the host app injects into the diagram composer. Wraps the app's
 * compile backend, project file access, document editor, and AI provider so
 * this package stays free of store/Tauri/AI imports.
 */
export interface DiagramHost {
  /** Compile a standalone document in isolation; returns the log and whether a PDF exists. */
  compileIsolated(projectId: string, source: string): Promise<{ log?: string | null; has_pdf: boolean }>;
  /** Bytes of the last isolated compile's PDF. */
  readIsolatedPdf(projectId: string): Promise<ArrayBuffer | number[]>;
  /** Rasterize a PDF page to a PNG data URI at the given scale. */
  pdfToPng(bytes: Uint8Array, page: number, scale: number): Promise<string>;
  listFiles(projectId: string): Promise<{ path: string }[]>;
  readFileContent(projectId: string, path: string): Promise<string>;
  writeFileContent(projectId: string, path: string, content: string): Promise<void>;
  /** Write binary file content given as base64. */
  writeProjectBytes(projectId: string, relPath: string, dataBase64: string): Promise<void>;
  /** Insert LaTeX at the caret of the app's main document editor. */
  insertAtCursor(text: string): void;
  /** Relative path of the project's main document (e.g. "main.tex"). */
  getMainDoc(): string;
  /** Reflect an on-disk write of `path` into the app's open-editor state. */
  applyExternalWrite(path: string, content: string): void;
  saveActive(): Promise<void>;
  refreshTree(): Promise<void>;
  /** Save the figure source as a new image project on the home screen. */
  createImageProject(name: string, source: string): Promise<unknown>;
  refreshProjects(): Promise<void>;
  /**
   * One-shot AI repair of failed TikZ. Returns corrected figure code.
   * Throw an Error with a user-readable message on failure (including when
   * no AI provider is configured). Omit to hide the Fix with AI button.
   */
  fixWithAi?(code: string, logTail: string): Promise<string>;
}
