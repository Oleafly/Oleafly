import type { GitHubRepo } from "@/lib/github";
import { githubImportRepo } from "@/lib/github";
import { ensurePandoc } from "@/features/pandoc";
import { importArxivEprint, importDocument, type ImportTarget } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { toast } from "@/lib/toast";
import { conversionNotice } from "@/features/import-copy";
import { i18n } from "@/i18n";
import { importRoutes, type SourceFormat } from "@oleafly/conversion-registry";

export const IMPORT_FILE_SOURCES = [
  { kind: "project", extensions: ["zip"] },
  { kind: "word", extensions: ["docx"] },
  { kind: "markdown", extensions: ["md", "markdown"] },
  { kind: "html", extensions: ["html", "htm"] },
  { kind: "typst", extensions: ["typ"] },
] as const;

export function importPickerOptions(kind: ProjectImportFileKind) {
  const source = IMPORT_FILE_SOURCES.find((item) => item.kind === kind);
  if (!source) throw new Error(i18n.t(($) => $.core.import.supportedDocumentTypes));
  const copy = {
    project: {
      filter: i18n.t(($) => $.library.import.picker.projectFilter),
      title: i18n.t(($) => $.library.import.picker.projectTitle),
    },
    word: {
      filter: i18n.t(($) => $.library.import.picker.wordFilter),
      title: i18n.t(($) => $.library.import.picker.wordTitle),
    },
    markdown: {
      filter: i18n.t(($) => $.library.import.picker.markdownFilter),
      title: i18n.t(($) => $.library.import.picker.markdownTitle),
    },
    html: {
      filter: i18n.t(($) => $.library.import.picker.htmlFilter),
      title: i18n.t(($) => $.library.import.picker.htmlTitle),
    },
    typst: {
      filter: i18n.t(($) => $.library.import.picker.typstFilter),
      title: i18n.t(($) => $.library.import.picker.typstTitle),
    },
  }[kind];
  return {
    multiple: false as const,
    filters: [{ name: copy.filter, extensions: [...source.extensions] }],
    title: copy.title,
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
  const labels = {
    latex: i18n.t(($) => $.library.import.targets.latex),
    markdown: i18n.t(($) => $.library.import.targets.markdown),
    typst: i18n.t(($) => $.library.import.targets.typst),
  };
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
  if (!kind) throw new Error(i18n.t(($) => $.core.import.unsupportedFile));

  const files = useFilesStore.getState();
  if (kind === "project") {
    await files.importProject(path);
    return true;
  }

  const selectedTarget = target ?? "latex";
  if (!importTargetsForKind(kind).some((option) => option.target === selectedTarget)) {
    throw new Error(i18n.t(($) => $.core.import.chooseOfferedProjectType));
  }
  if (!(await ensurePandoc())) return false;
  const projectId = await importDocument(path, selectedTarget);
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success(conversionNotice());
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
      throw new Error(i18n.t(($) => $.core.import.invalidArxivId));
    }
  }
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v[1-9]\d*)?$/i.test(id)) {
    throw new Error(i18n.t(($) => $.core.import.invalidArxivId));
  }
  return id;
}

export async function importArxivPaper(arxivId: string): Promise<boolean> {
  const id = normalizeArxivImportId(arxivId);
  const projectId = await importArxivEprint(id);
  const files = useFilesStore.getState();
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success(i18n.t(($) => $.core.import.arxivImported));
  return true;
}

export async function importGitHubRepository(repository: GitHubRepo): Promise<void> {
  const projectId = await githubImportRepo(repository.full_name);
  const files = useFilesStore.getState();
  await files.refreshProjects();
  await files.openProject(projectId);
  toast.success(i18n.t(($) => $.core.project.imported));
}
