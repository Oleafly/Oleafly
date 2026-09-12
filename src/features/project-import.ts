import type { GitHubRepo } from "@/lib/github";
import { githubImportRepo } from "@/lib/github";
import { ensurePandoc } from "@/features/pandoc";
import { importArxivEprint, importDocument, type ImportTarget } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { toast } from "@/lib/toast";
import { CONVERSION_NOTICE } from "@/features/import-copy";
import { importRoutes, type SourceFormat } from "@oleafly/conversion-registry";

export const IMPORT_FILE_SOURCES = [
  { kind: "project", title: "Existing project", extensions: ["zip"], description: "A .zip archive of a project folder." },
  { kind: "word", title: "Word document", extensions: ["docx"], description: "Convert .docx to LaTeX, Markdown, or Typst." },
  { kind: "markdown", title: "Markdown document", extensions: ["md", "markdown"], description: "Convert Markdown to LaTeX or Typst." },
  { kind: "html", title: "HTML page", extensions: ["html", "htm"], description: "Convert HTML to LaTeX, Markdown, or Typst." },
  { kind: "typst", title: "Typst document", extensions: ["typ"], description: "Convert Typst to LaTeX or Markdown." },
] as const;

export function importPickerOptions(kind: ProjectImportFileKind) {
  const source = IMPORT_FILE_SOURCES.find((item) => item.kind === kind);
  if (!source) throw new Error("Choose one of the supported document types.");
  return {
    multiple: false as const,
    filters: [{ name: source.title, extensions: [...source.extensions] }],
    title: `Import ${source.title.toLowerCase()}`,
  };
}

export type ProjectImportFileKind =
  | "project"
  | "word"
  | "markdown"
  | "html"
  | "typst";

export function importFileKind(path: string): ProjectImportFileKind | null {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".zip")) return "project";
  if (normalized.endsWith(".docx")) return "word";
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) return "markdown";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "html";
  if (normalized.endsWith(".typ")) return "typst";
  return null;
}

/** Project kinds the registry can import a file kind into. */
export function importTargetsForKind(
  kind: ProjectImportFileKind,
): { target: ImportTarget; label: string; recommended?: boolean }[] {
  if (kind === "project") return [];
  const source: SourceFormat = kind === "word" ? "docx" : kind;
  const labels = { latex: "LaTeX project", markdown: "Markdown project", typst: "Typst project" };
  return importRoutes().filter((route) => route.source === source && route.pandoc)
    .flatMap((route) => {
      const target = route.target;
      return target === "latex" || target === "markdown" || target === "typst"
        ? [{ target, label: labels[target], recommended: target === "latex" }]
        : [];
    });
}

export async function importSelectedFile(
  path: string,
  target?: ImportTarget,
): Promise<boolean> {
  const kind = importFileKind(path);
  if (!kind) {
    throw new Error("Choose a .zip, .docx, .md, .html, .htm, or .typ file.");
  }

  const files = useFilesStore.getState();
  if (kind === "project") {
    await files.importProject(path);
    return true;
  }

  const selectedTarget = target ?? "latex";
  if (!importTargetsForKind(kind).some((option) => option.target === selectedTarget)) {
    throw new Error("Choose one of the project types offered for this file.");
  }
  if (!(await ensurePandoc())) return false;
  const projectId = await importDocument(path, selectedTarget);
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success(CONVERSION_NOTICE);
  return true;
}

/** Download an arXiv e-print and open it as a new project. */
export function normalizeArxivImportId(input: string): string {
  let id = input.trim().replace(/^arxiv:\s*/i, "");
  if (/^https?:\/\//i.test(id)) {
    try {
      const url = new URL(id);
      if (url.hostname !== "arxiv.org" && url.hostname !== "www.arxiv.org" && url.hostname !== "export.arxiv.org") throw new Error();
      id = url.pathname.replace(/^\/(?:abs|pdf|src|e-print)\//, "").replace(/\.pdf$/, "");
    } catch {
      throw new Error("Paste an arXiv paper link or an id such as 2301.01234.");
    }
  }
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v[1-9]\d*)?$/i.test(id)) {
    throw new Error("Paste an arXiv paper link or an id such as 2301.01234.");
  }
  return id;
}

export async function importArxivPaper(arxivId: string): Promise<boolean> {
  const id = normalizeArxivImportId(arxivId);
  const projectId = await importArxivEprint(id);
  const files = useFilesStore.getState();
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success("arXiv source imported. Compile the project to check the result.");
  return true;
}

export async function importGitHubRepository(repository: GitHubRepo): Promise<void> {
  const projectId = await githubImportRepo(repository.full_name);
  const files = useFilesStore.getState();
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success("Project imported.");
}
