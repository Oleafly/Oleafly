import type { CompileResult, DocumentEngineDescriptor } from "@/lib/tauri";

export type NotebookEngineId = "quarto" | "calepin";
export type NotebookOutput = "pdf" | "html";

const NOTEBOOK_ENGINES: ReadonlySet<string> = new Set<NotebookEngineId>(["quarto", "calepin"]);

export function notebookEngineId(
  engine: Pick<DocumentEngineDescriptor, "id"> | null | undefined,
): NotebookEngineId | null {
  const id: string | undefined = engine?.id;
  return id !== undefined && NOTEBOOK_ENGINES.has(id) ? (id as NotebookEngineId) : null;
}

export const isNotebookEngine = (
  engine: Pick<DocumentEngineDescriptor, "id"> | null | undefined,
): boolean => notebookEngineId(engine) !== null;

export const isQuartoEngine = (
  engine: Pick<DocumentEngineDescriptor, "id"> | null | undefined,
): boolean => notebookEngineId(engine) === "quarto";

export const isCalepinEngine = (
  engine: Pick<DocumentEngineDescriptor, "id"> | null | undefined,
): boolean => notebookEngineId(engine) === "calepin";

export function notebookOutput(engine: DocumentEngineDescriptor | null | undefined): NotebookOutput | null {
  if (!isNotebookEngine(engine)) return null;
  const output = (engine as { notebook_output?: unknown }).notebook_output;
  return output === "html" ? "html" : "pdf";
}

export function shownHtmlOutput<T extends { readonly projectId: string; readonly mainDocument: string }>(
  output: T | null,
  files: { readonly projectId: string | null; readonly mainDoc: string; readonly engine: DocumentEngineDescriptor },
  target: string,
): T | null {
  if (output?.mainDocument !== target || output.projectId !== files.projectId) return null;
  return notebookOutput(files.engine) === "html" || output.mainDocument !== files.mainDoc ? output : null;
}

export function compiledHtmlOutput(result: CompileResult | null | undefined): string | null {
  const output = (result as { html_output?: unknown } | null | undefined)?.html_output;
  return typeof output === "string" && output.length > 0 ? output : null;
}

export const QUARTO_SOURCE_EXTENSIONS: readonly string[] = ["qmd", "rmd"];

export function isQuartoSourcePath(path: string | null | undefined): boolean {
  const name = path?.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && QUARTO_SOURCE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

const CALEPIN_IMPORT = /#import\s+"\/\.calepin\/(?:[^"\n]*\/)?calepin\.typ"/u;

export function usesCalepin(source: string): boolean {
  return CALEPIN_IMPORT.test(source);
}
