import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

/** Broadcast that project files changed (other windows should reload buffers). */
export function notifyProjectFilesChanged(
  projectId: string | null,
  paths?: string[],
): void {
  if (!isTauri() || !projectId) return;
  // Tag the source window so a window can ignore its own broadcast (Tauri emit
  // delivers to every webview, including the emitter).
  void emit("project:files-changed", {
    projectId,
    paths: paths ?? [],
    from: getCurrentWindow().label,
  }).catch(() => {});
}

/** Broadcast that a compile finished so other windows can reload the PDF. */
export function notifyCompileDone(projectId: string | null): void {
  if (!isTauri() || !projectId) return;
  void emit("compile:done", { projectId, from: getCurrentWindow().label }).catch(() => {});
}
