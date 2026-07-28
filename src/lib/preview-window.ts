import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  isCompileSuccessCheckpoint,
  type CompileSuccessCheckpoint,
} from "@/lib/compile-checkpoint";
import type { CompileRequestIdentity } from "@/store/compile";

const PREVIEW_WINDOW_LABEL = "preview";

export type PreviewCompileStatus =
  | "not_run"
  | "compiling"
  | "success"
  | "error"
  | "unavailable";

export interface PreviewWindowState {
  identity: CompileRequestIdentity;
  status: PreviewCompileStatus;
  checkpoint: CompileSuccessCheckpoint | null;
  message?: string;
}

const PREVIEW_COMPILE_STATUSES = new Set<PreviewCompileStatus>([
  "not_run",
  "compiling",
  "success",
  "error",
  "unavailable",
]);

function isCompileRequestIdentity(
  value: unknown,
): value is CompileRequestIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompileRequestIdentity>;
  return (
    typeof candidate.projectId === "string" &&
    candidate.projectId.length > 0 &&
    typeof candidate.mainDocument === "string" &&
    candidate.mainDocument.length > 0 &&
    typeof candidate.projectRevision === "number" &&
    Number.isSafeInteger(candidate.projectRevision) &&
    candidate.projectRevision >= 0 &&
    typeof candidate.requestGeneration === "number" &&
    Number.isSafeInteger(candidate.requestGeneration) &&
    candidate.requestGeneration >= 0
  );
}

/**
 * Detached-window event/query payloads cross a serialization boundary. Treat
 * them as untrusted until every identity field and optional checkpoint has
 * been validated. A success may only advertise the exact request that
 * produced its checkpoint.
 */
export function isPreviewWindowState(
  value: unknown,
): value is PreviewWindowState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PreviewWindowState>;
  if (
    !isCompileRequestIdentity(candidate.identity) ||
    typeof candidate.status !== "string" ||
    !PREVIEW_COMPILE_STATUSES.has(
      candidate.status as PreviewCompileStatus,
    ) ||
    !(
      candidate.checkpoint === null ||
      isCompileSuccessCheckpoint(candidate.checkpoint)
    ) ||
    !(
      candidate.message === undefined ||
      (typeof candidate.message === "string" &&
        candidate.message.length <= 4_096)
    )
  ) {
    return false;
  }

  const checkpoint = candidate.checkpoint;
  if (checkpoint && checkpoint.projectId !== candidate.identity.projectId) {
    return false;
  }
  return (
    candidate.status !== "success" ||
    (checkpoint !== null &&
      checkpoint.mainDocument === candidate.identity.mainDocument &&
      checkpoint.projectRevision ===
        candidate.identity.projectRevision &&
      checkpoint.requestGeneration ===
        candidate.identity.requestGeneration)
  );
}

// Renders `?view=preview` in its own JS context (see main.tsx) and stays in
// sync via the `preview:refresh` / `preview:project` events the main window
// emits (on compile and on project switch).
export async function openPreviewWindow(
  projectId: string,
  title: string,
  initialState?: PreviewWindowState,
): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
  if (existing) {
    await emit("preview:project", { projectId });
    if (initialState) await emit("preview:refresh", initialState);
    await existing.setFocus();
    return;
  }
  const query = new URLSearchParams({
    view: "preview",
    project: projectId,
  });
  if (initialState) {
    query.set("state", JSON.stringify(initialState));
  }
  new WebviewWindow(PREVIEW_WINDOW_LABEL, {
    url: `index.html?${query.toString()}`,
    title: `Preview: ${title || "Oleafly"}`,
    width: 720,
    height: 960,
    resizable: true,
    center: true,
    focus: true,
  });
}

export function refreshPreviewWindow(state?: PreviewWindowState): void {
  if (!isTauri()) return;
  void emit("preview:refresh", state).catch(() => {});
}

export function retargetPreviewWindow(projectId: string): void {
  if (!isTauri()) return;
  void emit("preview:project", { projectId }).catch(() => {});
}
