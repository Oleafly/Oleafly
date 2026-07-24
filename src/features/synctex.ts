import { synctexForward, synctexInverse } from "@/lib/tauri";
import { getCurrentLine, gotoLine, selectWordNearLine } from "@/components/editor/cm/controller";
import { gotoRect } from "@/components/pdf/pdfController";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { logError } from "@/lib/log";

export function goToSyncTex() {
  const s = useSettingsStore.getState();
  if (s.viewMode === "editor") {
    s.setViewMode("split");
    requestAnimationFrame(() => void forwardFromCursor());
  } else {
    void forwardFromCursor();
  }
}

export async function forwardFromCursor() {
  const { projectId, mainDoc, activePath } = useFilesStore.getState();
  const engineState = useFilesStore.getState();
  if (!engineState.engineLoaded || !engineState.engine.capabilities.supports_synctex) return;
  if (!projectId || !activePath) {
    void logError("synctex forward", "no active project/file");
    return;
  }
  const line = getCurrentLine();
  if (line == null) {
    void logError("synctex forward", "could not determine cursor line");
    return;
  }
  try {
    const rect = await synctexForward(projectId, mainDoc, activePath, line);
    if (!rect) {
      void logError(
        "synctex forward",
        `no rect for ${activePath}:${line} (file not in synctex - recompile?)`
      );
      return;
    }
    gotoRect(rect);
  } catch (e) {
    void logError("synctex forward", e);
  }
}

// So a just-opened file has time to mount before we move the cursor into it.
function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (k: number) =>
      k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1));
    step(n);
  });
}

export async function openFileAndGotoLine(file: string | null, line: number) {
  const store = useFilesStore.getState();
  const activePath = store.activePath;
  const activeBase = activePath?.split("/").pop();
  const targetBase = file?.split("/").pop();
  if (targetBase && targetBase !== activeBase) {
    const match = store.tree.find((f) => !f.is_dir && f.path.split("/").pop() === targetBase);
    if (match && match.path !== activePath) {
      await store.openFile(match.path);
      await nextFrames(2);
    }
  }
  gotoLine(line);
}

// In a multi-file project the click may land on content from a different file
// (an `\input` child), so switch to that file before jumping. `hit.file` is a
// basename; resolve it against the project tree.
export async function inverseFromClick(page: number, x: number, y: number, word?: string) {
  const store = useFilesStore.getState();
  const { projectId, mainDoc } = store;
  if (!projectId) return;
  if (!store.engineLoaded || !store.engine.capabilities.supports_synctex) return;
  const currentLine = getCurrentLine();
  if (word && currentLine != null) selectWordNearLine(currentLine, word);
  try {
    const hit = await synctexInverse(projectId, mainDoc, page, x, y);
    if (!hit) return;

    const { activePath, tree } = useFilesStore.getState();
    const activeBase = activePath?.split("/").pop();
    if (hit.file && hit.file !== activeBase) {
      const match = tree.find(
        (f) => !f.is_dir && f.path.split("/").pop() === hit.file
      );
      if (match && match.path !== activePath) {
        await store.openFile(match.path);
        await nextFrames(2); // let the editor mount the new file
      }
    }
    // SyncTeX only resolves to a line (its column is coarse and often lands on a
    // `\begin`/`\end`). If we know the word that was clicked, place the cursor on
    // the nearest matching word; otherwise fall back to the line start.
    if (word && selectWordNearLine(hit.line, word)) return;
    gotoLine(hit.line);
  } catch (e) {
    void logError("synctex inverse", e);
  }
}
