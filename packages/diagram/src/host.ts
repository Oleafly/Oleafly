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
  writeFileContent(projectId: string, path: string, content: string): Promise<void>;
  writeProjectBytes(projectId: string, relPath: string, dataBase64: string): Promise<void>;
  insertAtCursor(text: string): void;
  getMainDoc(): string;
  applyExternalWrite(path: string, content: string): void;
  saveActive(): Promise<void>;
  refreshTree(): Promise<void>;
  createImageProject(name: string, source: string): Promise<string>;
  createDiagramProject(name: string, source: string): Promise<string>;
  refreshProjects(): Promise<void>;
  findProjectIdByName(name: string): Promise<string | null>;
  listProjectNames(): Promise<{ id: string; name: string }[]>;
  saveFigureToCache(name: string, pngBase64: string, tikz: string): Promise<{ hash: string; alreadyCached: boolean }>;
  saveBytesToDisk(defaultName: string, extension: string, dataBase64: string): Promise<boolean>;
  // Lets the user pick an arbitrary .tikz/.tex file from disk (not tied to
  // any project) to load into the composer as a draft. Resolves null if the
  // user cancels the picker.
  pickTikzFile(): Promise<{ name: string; content: string } | null>;
  fixWithAi?(code: string, logTail: string): Promise<string>;
}
