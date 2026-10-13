import { invoke } from "@tauri-apps/api/core";
import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";

type WindowLocation = { projectId: string; path: string | null };

function locationOf(state: { projectId: string | null; activePath: string | null }): WindowLocation | null {
  return state.projectId ? { projectId: state.projectId, path: state.activePath } : null;
}

function sameLocation(left: WindowLocation | null, right: WindowLocation | null): boolean {
  return left?.projectId === right?.projectId && left?.path === right?.path;
}

function noteLocation(location: WindowLocation | null): void {
  invoke("web_process_note_location", { location }).catch((error: unknown) => {
    void logError("remember where the window is", error);
  });
}

async function reopenAfterReload(): Promise<void> {
  const location = await invoke<WindowLocation | null>("web_process_take_restore");
  if (!location) return;
  await useFilesStore.getState().openProject(location.projectId);
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
