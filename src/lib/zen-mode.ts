import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore, type ViewMode } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { useZenStore, type ZenLayoutSnapshot } from "@/store/zen";

type SettingsSnapshot = ReturnType<typeof useSettingsStore.getState>;

let fullscreenWork: Promise<void> = Promise.resolve();
let enteredFullscreen = false;

function queueFullscreen(task: () => Promise<void>): void {
  fullscreenWork = fullscreenWork.then(task).catch(() => {});
}

function settleFullscreen(state: "none" | "on"): void {
  if (useZenStore.getState().active) useZenStore.getState().setFullscreen(state);
}

async function goFullscreen(): Promise<void> {
  try {
    const window = getCurrentWindow();
    if (await window.isFullscreen()) {
      enteredFullscreen = false;
      settleFullscreen("none");
      return;
    }
    await window.setFullscreen(true);
    enteredFullscreen = true;
    settleFullscreen("on");
  } catch {
    enteredFullscreen = false;
    settleFullscreen("none");
  }
}

async function leaveFullscreen(): Promise<void> {
  if (!enteredFullscreen) return;
  enteredFullscreen = false;
  try {
    await getCurrentWindow().setFullscreen(false);
  } catch {
    enteredFullscreen = false;
  }
}

export function zenFullscreenSettled(): Promise<void> {
  return fullscreenWork;
}

function snapshotLayout(settings: SettingsSnapshot): ZenLayoutSnapshot {
  const { showTree, railTab, assistantOpen, workspaceHidden, viewMode, terminalOpen } = settings;
  return { showTree, railTab, assistantOpen, workspaceHidden, viewMode, terminalOpen };
}

function previewDetached(projectId: string | null): boolean {
  return projectId !== null && usePreviewDetachedStore.getState().projectId === projectId;
}

export function enterZenMode(): boolean {
  if (useZenStore.getState().active) return true;
  const projectId = useFilesStore.getState().projectId;
  if (!projectId || useTourStore.getState().activeTourId) return false;
  const settings = useSettingsStore.getState();
  const detached = previewDetached(projectId);
  const pdfVisibleAtStart =
    !detached && !settings.workspaceHidden && settings.viewMode !== "editor";
  const fullscreen = isTauri() && settings.zenFullScreen;
  let viewMode: ViewMode = pdfVisibleAtStart ? "split" : "editor";
  if (detached) viewMode = settings.viewMode;
  useZenStore.getState().begin({
    projectId,
    snapshot: snapshotLayout(settings),
    pdfVisibleAtStart,
    fullscreen: fullscreen ? "entering" : "none",
  });
  useSettingsStore.setState({
    showTree: false,
    assistantOpen: false,
    terminalOpen: false,
    workspaceHidden: false,
    viewMode,
  });
  if (fullscreen) queueFullscreen(goFullscreen);
  return true;
}

export function exitZenMode({ restoreLayout = true }: { restoreLayout?: boolean } = {}): void {
  const zen = useZenStore.getState();
  if (!zen.active) return;
  if (restoreLayout && zen.snapshot) useSettingsStore.setState({ ...zen.snapshot });
  zen.end();
  queueFullscreen(leaveFullscreen);
}

export function toggleZenMode(): boolean {
  if (useZenStore.getState().active) {
    exitZenMode();
    return false;
  }
  return enterZenMode();
}

export function openZenCompileLog(): void {
  const settings = useSettingsStore.getState();
  if (previewDetached(useFilesStore.getState().projectId)) {
    void import("@/lib/preview-window").then((module) => module.reattachPreviewWindow());
  }
  if (settings.viewMode === "editor") settings.setViewMode("split");
  useZenStore.getState().setLogsOpen(true);
}

export function toggleZenCompileLog(): void {
  if (useZenStore.getState().logsOpen) useZenStore.getState().setLogsOpen(false);
  else openZenCompileLog();
}
