import { activeSelectionText } from "@/components/editor/selection-text";
import {
  documentStats,
  sumDocumentStats,
  type DocumentStats,
} from "@/lib/document-stats";
import { readDocumentSources } from "@/lib/document-sources";
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
