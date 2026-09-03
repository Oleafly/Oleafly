import { activeSelectionText } from "@/components/editor/selection-text";
import {
  documentStats,
  sumDocumentStats,
  type DocumentStats,
} from "@/lib/document-stats";
import { readDocumentSources } from "@/lib/document-sources";
import * as tauri from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { countWords } from "@/lib/wordcount";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

export interface ProjectInfoSnapshot {
  root: string;
  fileCount: number;
  unreadable: string[];
  stats: DocumentStats;
  selectionWords: number | null;
}

export interface DocumentStatsRequest {
  mainDocument: string;
  overrides: Record<string, string>;
}

export interface DocumentStatsFile {
  path: string;
  stats: DocumentStats;
}

export interface DocumentStatsResult {
  root: string;
  fileCount: number;
  unreadable: string[];
  stats: DocumentStats;
  files: DocumentStatsFile[];
}

type DocumentStatsBinding = (
  projectId: string,
  request: DocumentStatsRequest,
) => Promise<DocumentStatsResult>;

function documentStatsBinding(): DocumentStatsBinding | null {
  const candidate = (tauri as unknown as { documentStats?: unknown }).documentStats;
  return typeof candidate === "function"
    ? (candidate as DocumentStatsBinding)
    : null;
}

function dirtyBuffers(): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [path, file] of Object.entries(useFilesStore.getState().files)) {
    if (file.dirty) overrides[path] = file.content;
  }
  return overrides;
}

async function collectNatively(
  projectId: string,
  root: string,
): Promise<Omit<ProjectInfoSnapshot, "selectionWords"> | null> {
  const binding = documentStatsBinding();
  if (!binding) return null;
  try {
    const result = await binding(projectId, {
      mainDocument: root,
      overrides: dirtyBuffers(),
    });
    return {
      root,
      fileCount: result.fileCount,
      unreadable: result.unreadable,
      stats: result.stats,
    };
  } catch {
    return null;
  }
}

/**
 * Counts the whole document: the root plus every file it `\input`s, with
 * unsaved buffers preferred over disk. Reading is why this is async, and why
 * nothing here runs until the panel is actually opened.
 */
export async function collectProjectInfo(): Promise<ProjectInfoSnapshot> {
  const files = useFilesStore.getState();
  const { mainDoc } = resolveEffectiveMainDoc();
  // Without a project there is nothing to walk; count the open buffer alone so
  // a scratch file still reports something truthful.
  const root = files.projectId ? mainDoc : (files.activePath ?? mainDoc);
  const selected = activeSelectionText();
  const selectionWords = selected === null ? null : countWords(selected).words;

  if (!files.projectId) {
    const content = files.activePath
      ? (files.files[files.activePath]?.content ?? "")
      : "";
    return {
      root,
      fileCount: 1,
      unreadable: [],
      stats: documentStats(content),
      selectionWords,
    };
  }

  const native = await collectNatively(files.projectId, root);
  if (native) return { ...native, selectionWords };

  const sources = await readDocumentSources(
    files.projectId,
    useIndexStore.getState().index,
    root,
  );
  return {
    root,
    fileCount: sources.paths.length,
    unreadable: sources.unreadable,
    stats: sumDocumentStats(sources.texts.map(documentStats)),
    selectionWords,
  };
}
