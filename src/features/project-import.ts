import type { GitHubRepo } from "@/lib/github";
import { githubImportRepo } from "@/lib/github";
import { ensurePandoc } from "@/features/pandoc";
import { importArxivEprint, importDocument, type ImportTarget } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { toast } from "@/lib/toast";
import { CONVERSION_NOTICE } from "@/features/import-copy";

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
  switch (kind) {
    case "word":
      return [
        { target: "latex", label: "LaTeX project", recommended: true },
        { target: "markdown", label: "Markdown project" },
        { target: "typst", label: "Typst project" },
      ];
    case "markdown":
      return [
        { target: "latex", label: "LaTeX project", recommended: true },
        { target: "typst", label: "Typst project" },
      ];
    case "html":
      return [
        { target: "latex", label: "LaTeX project", recommended: true },
        { target: "markdown", label: "Markdown project" },
        { target: "typst", label: "Typst project" },
      ];
    case "typst":
      return [
        { target: "latex", label: "LaTeX project", recommended: true },
        { target: "markdown", label: "Markdown project" },
      ];
    case "project":
      return [];
  }
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

  if (!(await ensurePandoc())) return false;
  const projectId = await importDocument(path, target ?? "latex");
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success(CONVERSION_NOTICE);
  return true;
}

/** Download an arXiv e-print and open it as a new project. */
export async function importArxivPaper(arxivId: string): Promise<boolean> {
  const id = arxivId.trim().replace(/^arXiv:/i, "");
  if (!id) throw new Error("Enter an arXiv id like 2301.01234.");
  const projectId = await importArxivEprint(id);
  const files = useFilesStore.getState();
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success("arXiv source imported. The project compiles from its own main file.");
  return true;
}

export async function importGitHubRepository(repository: GitHubRepo): Promise<void> {
  const projectId = await githubImportRepo(repository.full_name);
  const files = useFilesStore.getState();
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success("Project imported.");
}
