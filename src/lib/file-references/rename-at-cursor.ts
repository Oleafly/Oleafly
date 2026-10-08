import type { EditorView } from "@codemirror/view";
import {
  latexSearchPaths,
  type PathReference,
  pathReferenceAt,
  referenceLanguageForPath,
  resolvePathReference,
} from "@oleafly/editor/file-references";
import { i18n } from "@/i18n";
import { decodeAppError } from "@/lib/app-error";
import { showLookupResult } from "@/lib/index/nav";
import { isFileConflictError } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { useFileRenameStore } from "@/store/file-rename";
import { useFilesStore } from "@/store/files";
import { projectFolderIsReadOnly, readOnlyFolderMessage } from "@/store/folder-access";
import { useIndexStore } from "@/store/project-index";
import { projectFilesOf } from "./follow-rename";

export type PromptRenameResult =
  | { status: "renamed" }
  | { status: "unchanged" }
  | { status: "invalid" }
  | { status: "exists"; path: string }
  | { status: "failed" };

export function pathReferenceUnderCursor(view: EditorView): PathReference | null {
  const path = useFilesStore.getState().activePath;
  const language = path ? referenceLanguageForPath(path) : null;
  if (!language) return null;
  return pathReferenceAt(language, view.state.doc.toString(), view.state.selection.main.head);
}

function searchPathsFor(path: string, text: string) {
  const sources = Object.entries(useIndexStore.getState().texts)
    .filter(([source]) => source !== path)
    .map(([source, sourceText]) => ({ path: source, text: sourceText }));
  return latexSearchPaths([...sources, { path, text }]);
}

export function startFileRenameAtCursor(view: EditorView): boolean {
  const reference = pathReferenceUnderCursor(view);
  const files = useFilesStore.getState();
  if (!reference || !files.activePath) return false;
  if (projectFolderIsReadOnly(files.projectId)) {
    showLookupResult(readOnlyFolderMessage());
    return true;
  }
  const text = view.state.doc.toString();
  const resolved = resolvePathReference(reference, {
    sourcePath: files.activePath,
    project: projectFilesOf(files.tree, files.mainDoc),
    searchPaths: reference.language === "latex" ? searchPathsFor(files.activePath, text) : undefined,
  });
  if (!resolved) {
    showLookupResult(i18n.t(($) => $.core.navigation.pathNotInProject, { path: reference.raw }));
    return true;
  }
  useFileRenameStore.getState().open(resolved);
  return true;
}

export function normalizeRenameDestination(value: string): string | null {
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.endsWith("/") || /^(?:\/|~|[A-Za-z]:\/)/.test(path)) return null;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

export async function renameFromPrompt(from: string, value: string): Promise<PromptRenameResult> {
  const to = normalizeRenameDestination(value);
  if (!to) return { status: "invalid" };
  if (to === from) return { status: "unchanged" };
  try {
    await useFilesStore.getState().renameEntry(from, to);
    return { status: "renamed" };
  } catch (error) {
    if (isFileConflictError(error)) return { status: "exists", path: to };
    notifyError(
      "rename file",
      error,
      decodeAppError(error) ? undefined : i18n.t(($) => $.workspace.files.renameFailed, { path: from }),
    );
    return { status: "failed" };
  }
}
