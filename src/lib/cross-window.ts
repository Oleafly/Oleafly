import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  COMPILE_SUCCEEDED_EVENT,
  type CompileSuccessCheckpoint,
} from "@/lib/compile-checkpoint";

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

export function currentCompileProducerId(): string {
  return isTauri() ? getCurrentWindow().label : "local";
}

export function notifyCompileSucceeded(
  checkpoint: CompileSuccessCheckpoint,
): void {
  if (!isTauri()) return;
  // This event is deliberately success-only. Failed/best-effort output keeps
  // its local log and status, but must never make another window mark a stale
  // PDF successful.
  void emit(COMPILE_SUCCEEDED_EVENT, checkpoint).catch(() => {});
}
