import { availableMonitors } from "@tauri-apps/api/window";
import { usePreviewDetachedStore, setPreviewDetached, wantsDetachedPreview } from "@/store/preview-detached";
import { readPreviewGeometry } from "@/lib/preview-geometry";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { i18n } from "@/i18n";
import { isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  isCompileSuccessCheckpoint,
  type CompileSuccessCheckpoint,
} from "@/lib/compile-checkpoint";
import type { CompileRequestIdentity } from "@/store/compile";
import { currentProjectStateRevision } from "@/lib/project-state-revision";
import { logError } from "@/lib/log";

const PREVIEW_WINDOW_LABEL = "preview";
let trackedPreview: WebviewWindow | null = null;
let trackedProject: string | null = null;
let projectGeneration = 0;

function trackPreview(preview: WebviewWindow, projectId: string, created: boolean) {
  trackedPreview = preview;
  trackedProject = projectId;
  const markOpen = () => {
    if (trackedPreview === preview) setPreviewDetached(projectId, true);
  };
  if (created) markOpen();
  else void preview.once("tauri://created", markOpen);
  void preview.once("tauri://destroyed", () => {
    if (trackedPreview !== preview) return;
    trackedPreview = null;
    trackedProject = null;
    setPreviewDetached(projectId, false);
  });
}

// A project switch closes the old preview without discarding its saved layout.
export async function restorePreviewWindow(projectId: string | null, title: string): Promise<void> {
  if (!isTauri()) return;
  const generation = ++projectGeneration;
  if (projectId !== null && trackedProject === projectId) return;
  const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
  if (generation !== projectGeneration) return;
  if (projectId !== null && trackedProject === projectId) return;
  trackedPreview = null;
  trackedProject = null;
  usePreviewDetachedStore.setState({ projectId: null });
  if (existing) await existing.destroy();
  if (generation === projectGeneration && projectId && wantsDetachedPreview(projectId)) {
    await openPreviewWindow(projectId, title);
  }
}

export async function reattachPreviewWindow(): Promise<void> {
  const preview = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
  if (preview) await preview.close();
}

export type PreviewCompileStatus =
  | "not_run"
  | "compiling"
  | "success"
  | "error"
  | "unavailable";

export interface PreviewWindowState {
  projectStateRevision: number;
  identity: CompileRequestIdentity;
  status: PreviewCompileStatus;
  checkpoint: CompileSuccessCheckpoint | null;
  message?: string;
}

export type PreviewWindowStateInput = Omit<
  PreviewWindowState,
  "projectStateRevision"
> & {
  projectStateRevision?: number;
};

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
    typeof candidate.projectStateRevision !== "number" ||
    !Number.isSafeInteger(candidate.projectStateRevision) ||
    candidate.projectStateRevision < 0 ||
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
  const exactCheckpoint =
    checkpoint !== null &&
    checkpoint.projectId === candidate.identity.projectId &&
    checkpoint.mainDocument === candidate.identity.mainDocument &&
    checkpoint.projectRevision ===
      candidate.identity.projectRevision &&
    checkpoint.requestGeneration ===
      candidate.identity.requestGeneration;
  // A non-success attempt may retain an older PDF in the viewer, but that
  // checkpoint must not be advertised as output from the current identity.
  return candidate.status === "success"
    ? exactCheckpoint
    : checkpoint === null || exactCheckpoint;
}

function stampProjectStateRevision(
  state: PreviewWindowStateInput,
): PreviewWindowState {
  return {
    ...state,
    projectStateRevision:
      state.projectStateRevision ?? currentProjectStateRevision(),
  };
}

// Renders `?view=preview` in its own JS context (see main.tsx) and stays in
// sync via the `preview:refresh` / `preview:project` events the main window
// emits (on compile and on project switch).
export async function openPreviewWindow(
  projectId: string,
  title: string,
  initialState?: PreviewWindowStateInput,
): Promise<void> {
  if (!isTauri()) return;
  const generation = projectGeneration;
  const stampedState = initialState
    ? stampProjectStateRevision(initialState)
    : undefined;
  const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
  if (generation !== projectGeneration) return;
  if (existing) {
    await emit("preview:project", { projectId });
    if (stampedState) await emit("preview:refresh", stampedState);
    if (trackedProject !== projectId) trackPreview(existing, projectId, true);
    await existing.setFocus();
    return;
  }
  const query = new URLSearchParams({
    view: "preview",
    project: projectId,
  });
  if (stampedState) {
    query.set("state", JSON.stringify(stampedState));
  }
  const geometry = readPreviewGeometry(projectId);
  // Restore only positions that still intersect a connected monitor.
  const monitors = geometry ? await availableMonitors().catch(() => []) : [];
  if (generation !== projectGeneration) return;
  const onScreen = geometry && monitors.some((monitor) => {
    const x = monitor.position.x / monitor.scaleFactor;
    const y = monitor.position.y / monitor.scaleFactor;
    return geometry.x + geometry.width > x + 80 && geometry.x < x + monitor.size.width / monitor.scaleFactor - 80 &&
      geometry.y >= y && geometry.y < y + monitor.size.height / monitor.scaleFactor - 80;
  });
  const preview = new WebviewWindow(PREVIEW_WINDOW_LABEL, {
    url: `index.html?${query.toString()}`,
    title: i18n.t(($) => $.shell.windows.preview, { title: title || "Oleafly" }),
    width: geometry?.width ?? 720,
    height: geometry?.height ?? 960,
    ...(onScreen && geometry ? { x: geometry.x, y: geometry.y } : {}),
    resizable: true,
    center: !onScreen,
    focus: true,
  });
  trackPreview(preview, projectId, false);
  void preview.once("tauri://error", (event) => {
    void logError("preview-window", event.payload);
  });
}

export function refreshPreviewWindow(state?: PreviewWindowStateInput): void {
  if (!isTauri()) return;
  void emit(
    "preview:refresh",
    state ? stampProjectStateRevision(state) : undefined,
  ).catch(() => {});
}

export function retargetPreviewWindow(projectId: string): void {
  if (!isTauri()) return;
  void emit("preview:project", { projectId }).catch(() => {});
}
