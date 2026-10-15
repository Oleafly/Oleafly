import { invoke } from "@tauri-apps/api/core";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";

type WindowLocation = { projectId: string; path: string | null; openTabs: string[] };

type ReloadRestore = {
  reason: "unresponsive" | "unresponsive_again";
  location: WindowLocation | null;
};

const MAX_REOPENED_TABS = 20;

function locationOf(state: {
  projectId: string | null;
  activePath: string | null;
  openTabs: readonly string[];
}): WindowLocation | null {
  return state.projectId
    ? { projectId: state.projectId, path: state.activePath, openTabs: [...state.openTabs] }
    : null;
}

function sameTabs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function sameLocation(left: WindowLocation | null, right: WindowLocation | null): boolean {
  if (!left || !right) return left === right;
  return left.projectId === right.projectId && left.path === right.path && sameTabs(left.openTabs, right.openTabs);
}

function noteLocation(location: WindowLocation | null): void {
  invoke("web_process_note_location", { location }).catch((error: unknown) => {
    void logError("remember where the window is", error);
  });
}

function explainReload(reason: ReloadRestore["reason"]): void {
  const message =
    reason === "unresponsive_again"
      ? i18n.t(($) => $.shell.stuckWindow.reloadedAgain)
      : i18n.t(($) => $.shell.stuckWindow.reloaded);
  toast.info(message, undefined, true);
}

async function reopenTabs(location: WindowLocation): Promise<void> {
  for (const path of location.openTabs.slice(0, MAX_REOPENED_TABS)) {
    const current = useFilesStore.getState();
    if (current.projectId !== location.projectId) return;
    if (current.openTabs.includes(path)) continue;
    await current.openFile(path).catch((error: unknown) => {
      void logError("reopen a tab after the window was reloaded", error);
    });
  }
}

async function reopenAfterReload(): Promise<void> {
  const restore = await invoke<ReloadRestore | null>("web_process_take_restore");
  if (!restore) return;
  explainReload(restore.reason);
  const location = restore.location;
  if (!location) return;
  await useFilesStore.getState().openProject(location.projectId);
  await reopenTabs(location);
  const opened = useFilesStore.getState();
  if (location.path && opened.projectId === location.projectId && opened.activePath !== location.path) {
    await opened.openFile(location.path);
  }
}

export async function startStuckWindowRestore(): Promise<() => void> {
  await reopenAfterReload().catch((error: unknown) => {
    void logError("reopen the project after the window was reloaded", error);
  });
  let noted = locationOf(useFilesStore.getState());
  noteLocation(noted);
  return useFilesStore.subscribe((state) => {
    const next = locationOf(state);
    if (sameLocation(next, noted)) return;
    noted = next;
    noteLocation(next);
  });
}
