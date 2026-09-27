import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { refreshOpenFilesFromDisk } from "@/lib/external-file-changes";
import { logError } from "@/lib/log";
import { probeProjectAvailability } from "@/lib/tauri";
import { useApprovalModeStore } from "@/store/approval-mode";
import { clearFolderPause } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useGitStatusStore } from "@/store/git-status";
import {
  folderReachable,
  type ProjectAvailabilityEvent,
  useProjectAvailabilityStore,
} from "@/store/project-availability";

let runningCheck: { projectId: string; done: Promise<void> } | null = null;

async function checkFolder(projectId: string, generation: number): Promise<void> {
  try {
    const reports = await probeProjectAvailability([projectId]);
    const current = useProjectAvailabilityStore.getState();
    if (current.projectId !== projectId || current.locationGeneration !== generation) return;
    const report = reports.find((entry) => entry.project_id === projectId);
    current.report(projectId, report?.availability ?? "ok");
  } catch (error) {
    void logError("check project folder", error);
  }
}

export function recheckProjectAvailability(): Promise<void> {
  const { projectId, locationGeneration } = useProjectAvailabilityStore.getState();
  if (!projectId) return Promise.resolve();
  if (runningCheck?.projectId === projectId) return runningCheck.done;
  const check = {
    projectId,
    done: checkFolder(projectId, locationGeneration).finally(() => {
      if (runningCheck === check) runningCheck = null;
    }),
  };
  runningCheck = check;
  return check.done;
}

function resume(projectId: string): void {
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return;
  files.resumeAutosave(projectId);
  void files.refreshTree().catch((error) => logError("refresh files after the folder returned", error));
  refreshOpenFilesFromDisk(projectId);
  clearFolderPause();
  void useGitStatusStore.getState().refresh(projectId);
  window.dispatchEvent(new Event("oleafly:git-changed"));
}

export function ProjectAvailabilityKeeper() {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<ProjectAvailabilityEvent>("project-availability", (event) => {
      useProjectAvailabilityStore.getState().apply(event.payload);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch((error) => logError("listen for project folder changes", error));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  useEffect(
    () =>
      useProjectAvailabilityStore.subscribe((state, previous) => {
        if (!state.projectId || state.projectId !== previous.projectId) return;
        if (state.grantResets !== previous.grantResets) {
          useApprovalModeStore.getState().forget(state.projectId);
        }
        const returned =
          folderReachable(state.availability) && !folderReachable(previous.availability);
        if (returned || state.relocations !== previous.relocations) resume(state.projectId);
      }),
    [],
  );

  useEffect(() => {
    const onFocus = () => {
      if (!folderReachable(useProjectAvailabilityStore.getState().availability)) {
        void recheckProjectAvailability();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
