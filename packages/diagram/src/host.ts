import type { DiagramFixPrompt, DiagramLanguageId } from "./languages/types";

export interface DiagramRenderDiagnostic {
  severity: "error" | "warning";
  message: string;
  line: number | null;
  column: number | null;
}

export type DiagramTypstImage = { format: "svg"; svg: string } | { format: "png"; pngBase64: string };

export type DiagramTypstRender =
  | { status: "rendered"; image: DiagramTypstImage; diagnostics: DiagramRenderDiagnostic[] }
  | { status: "failed"; diagnostics: DiagramRenderDiagnostic[] };

export interface DiagramTypstRequest {
  source: string;
  format: "png" | "svg";
  ppi?: number;
  projectId?: string | null;
  document?: boolean;
}

export interface DiagramInsertTarget {
  projectId: string;
  language: DiagramLanguageId;
}

export interface DiagramProjectPick {
  id: string;
  name: string;
  typst?: boolean;
  language?: DiagramLanguageId;
}

// Services the host app injects into the diagram composer, so this package
// stays free of store/Tauri/AI imports.
export interface DiagramHost {
  compileIsolated(projectId: string, source: string): Promise<{ log?: string | null; has_pdf: boolean }>;
  readIsolatedPdf(projectId: string): Promise<ArrayBuffer | number[]>;
  pdfToPng(
    bytes: Uint8Array,
    page: number,
    scale: number,
    background?: string,
  ): Promise<string>;
  listFiles(projectId: string): Promise<{ path: string }[]>;
  writeFileContent(projectId: string, path: string, content: string): Promise<unknown>;
  writeProjectBytes(projectId: string, relPath: string, dataBase64: string): Promise<unknown>;
  insertAtCursor(text: string): void;
  getMainDoc(): string;
  applyExternalWrite(projectId: string, path: string, content: string): void;
  saveActive(): Promise<void>;
  refreshTree(): Promise<void>;
  createImageProject(name: string, source: string): Promise<string>;
  createDiagramProject(name: string, source: string, language?: DiagramLanguageId): Promise<string>;
  refreshProjects(): Promise<void>;
  findProjectIdByName(name: string): Promise<string | null>;
  listProjectNames(): Promise<DiagramProjectPick[]>;
  saveFigureToCache(name: string, pngBase64: string, tikz: string): Promise<{ hash: string; alreadyCached: boolean }>;
  saveBytesToDisk(defaultName: string, extension: string, dataBase64: string): Promise<boolean>;
  // Lets the user pick an arbitrary .tikz/.tex file from disk (not tied to
  // any project) to load into the composer as a draft. Resolves null if the
  // user cancels the picker.
  pickTikzFile(accept?: string): Promise<{ name: string; content: string } | null>;
  fixWithAi?(code: string, logTail: string, prompt?: DiagramFixPrompt): Promise<string>;
  insertTarget?(): DiagramInsertTarget | null;
  typstContext?(): { projectId: string | null; typstVersion: string | null };
  renderTypst?(request: DiagramTypstRequest): Promise<DiagramTypstRender>;
  renderMermaid?(source: string, options: { scale: number; background: string }): Promise<{ svg: string; pngBase64: string }>;
}
