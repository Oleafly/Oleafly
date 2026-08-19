import type { GitHubRepo } from "@/lib/github";
import { githubImportRepo } from "@/lib/github";
import { ensurePandoc } from "@/features/pandoc";
import { importDocument } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { toast } from "@/lib/toast";
import { CONVERSION_NOTICE } from "@/features/import-copy";

export type ProjectImportFileKind = "project" | "word" | "markdown";

export function importFileKind(path: string): ProjectImportFileKind | null {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".zip")) return "project";
  if (normalized.endsWith(".docx")) return "word";
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) return "markdown";
  return null;
}

export async function importSelectedFile(path: string): Promise<boolean> {
  const kind = importFileKind(path);
  if (!kind) throw new Error("Choose a .zip, .docx, .md, or .markdown file.");

  const files = useFilesStore.getState();
  if (kind === "project") {
    await files.importProject(path);
    return true;
  }

  if (!(await ensurePandoc())) return false;
  const projectId = await importDocument(path);
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success(CONVERSION_NOTICE);
  return true;
}

export async function importGitHubRepository(repository: GitHubRepo): Promise<void> {
  const projectId = await githubImportRepo(repository.full_name);
  const files = useFilesStore.getState();
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success("Project imported.");
}
