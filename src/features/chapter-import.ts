import type { ChapterImportPlan, ChapterSourceFile } from "@oleafly/editor/chapter-import";
import type { FileEntry } from "@oleafly/backend-port";
import { notifyProjectFilesChanged } from "@/lib/cross-window";
import { eachInOrder } from "@/lib/each-in-order";
import { isEditorMutationLocked } from "@/lib/editor-mutation-lease";
import { applyReferencePlan } from "@/lib/file-references/follow-rename";
import { normalizeSourceText } from "@/lib/project-sources";
import {
  listFiles,
  type ProjectInfo,
  readFileBase64,
  readFileContent,
  writeProjectBytes,
} from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";
import { readProjectSources } from "@/store/project-index";

export interface ThesisSnapshot {
  readonly projectId: string;
  readonly main: string;
  readonly files: readonly ChapterSourceFile[];
  readonly paths: readonly string[];
}

export interface PaperSnapshot {
  readonly projectId: string;
  readonly name: string;
  readonly main: string;
  readonly files: readonly ChapterSourceFile[];
  readonly assets: readonly string[];
}

export interface ChapterImportOutcome {
  readonly written: readonly string[];
  readonly mainUpdated: boolean;
}

const PAPER_SOURCE = /\.(?:tex|ltx|latex)$/iu;
const THESIS_SOURCE = /\.(?:tex|ltx|latex|sty|cls)$/iu;

function readableFiles(entries: readonly FileEntry[]): string[] {
  return entries.filter((entry) => !entry.is_dir && !entry.unreadable && !entry.placeholder).map((entry) => entry.path);
}

export async function loadThesis(): Promise<ThesisSnapshot | null> {
  const files = useFilesStore.getState();
  const { projectId, tree } = files;
  if (!projectId) return null;
  const main = resolveEffectiveMainDoc().mainDoc;
  const { texts } = await readProjectSources(
    projectId,
    readableFiles(tree).filter((path) => THESIS_SOURCE.test(path)),
  );
  return {
    projectId,
    main,
    files: Object.entries(texts).map(([path, content]) => ({ path, content })),
    paths: tree.map((entry) => entry.path),
  };
}

export async function loadPaper(project: ProjectInfo): Promise<PaperSnapshot> {
  const paths = readableFiles(await listFiles(project.id));
  const sources = paths.filter((path) => PAPER_SOURCE.test(path));
  const files = await Promise.all(
    sources.map(async (path) => ({ path, content: normalizeSourceText(await readFileContent(project.id, path)) })),
  );
  return {
    projectId: project.id,
    name: project.name,
    main: project.main_doc,
    files,
    assets: paths.filter((path) => !PAPER_SOURCE.test(path)),
  };
}

function stillOpen(projectId: string): void {
  if (useFilesStore.getState().projectId !== projectId) throw new Error("The open project changed.");
}

export async function writeChapterImport(
  thesis: ThesisSnapshot,
  paper: PaperSnapshot,
  plan: ChapterImportPlan,
): Promise<ChapterImportOutcome> {
  const { projectId } = thesis;
  if (isEditorMutationLocked(projectId)) throw new Error("The project is busy with another change.");
  const written: string[] = [];
  await eachInOrder(plan.assets, async (asset) => {
    stillOpen(projectId);
    const data = await readFileBase64(paper.projectId, asset.from);
    const result = await writeProjectBytes(projectId, asset.to, data);
    useFilesStore.getState().recordMutationGeneration(projectId, result.generation);
    written.push(asset.to);
  });
  if (written.length > 0) notifyProjectFilesChanged(projectId, [...written]);
  await eachInOrder(plan.files, async (file) => {
    stillOpen(projectId);
    await useFilesStore.getState().writeProjectFile(projectId, file.path, file.content);
    written.push(file.path);
  });
  const main = thesis.files.find((file) => file.path === thesis.main);
  if (!main || plan.mainEdits.length === 0) return { written, mainUpdated: plan.mainEdits.length === 0 };
  const references = plan.mainEdits.length;
  const failed = await applyReferencePlan(projectId, {
    files: [{ path: main.path, text: main.content, edits: plan.mainEdits, references }],
    references,
  });
  return { written, mainUpdated: failed.length === 0 };
}
