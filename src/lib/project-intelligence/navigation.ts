import {
  revealEditorRange,
  waitForEditorDocument,
} from "@oleafly/editor";
import { revealSourceEditor } from "@/components/editor/wysiwyg/controller";
import type { SourceRange } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export interface ProjectNavigationTarget {
  path: string;
  range: Pick<SourceRange, "from" | "to">;
  source?: "outline" | "references" | "diagnostic" | "completion" | "editor";
}

let navigationGeneration = 0;

/**
 * Opens a source location and reveals it only after CodeMirror confirms that
 * the matching document is installed. A newer navigation cancels an older
 * one, so a slow file read can never select its range in a later tab.
 */
export async function navigateToProjectRange(
  target: ProjectNavigationTarget,
): Promise<void> {
  const generation = ++navigationGeneration;
  const before = useFilesStore.getState();
  const projectId = before.projectId;
  if (!projectId || !target.path) return;

  revealSourceEditor();
  const settings = useSettingsStore.getState();
  settings.setHideEditorArea(false);
  if (settings.viewMode === "pdf") settings.setViewMode("editor");

  if (before.activePath !== target.path) {
    await before.openFile(target.path);
  }

  const files = useFilesStore.getState();
  if (
    generation !== navigationGeneration ||
    files.projectId !== projectId ||
    files.activePath !== target.path
  ) {
    return;
  }

  const abort = new AbortController();
  const unsubscribe = useFilesStore.subscribe((state) => {
    if (
      generation !== navigationGeneration ||
      state.projectId !== projectId ||
      state.activePath !== target.path
    ) {
      abort.abort();
    }
  });

  try {
    const view = await waitForEditorDocument(target.path, abort.signal);
    if (!view || abort.signal.aborted || generation !== navigationGeneration) {
      return;
    }
    const max = view.state.doc.length;
    const from = Math.min(Math.max(0, target.range.from), max);
    const to = Math.min(Math.max(from, target.range.to), max);
    revealEditorRange(view, from, to);
  } finally {
    unsubscribe();
  }
}
