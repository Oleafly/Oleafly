import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { applyFolderChange, type FolderChangePayload } from "@/lib/external-file-changes";
import { logError } from "@/lib/log";
import { unwatchProjectFolder, watchProjectFolder } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { folderReachable, useProjectAvailabilityStore } from "@/store/project-availability";

export const FOLDER_CHANGED_EVENT = "project-folder-changed";

export function FolderWatchKeeper() {
  const projectId = useFilesStore((state) => state.projectId);
  const openedInPlace = useFilesStore((state) => state.manifestHome !== "library");
  const reachable = useProjectAvailabilityStore(
    (state) => state.projectId !== projectId || folderReachable(state.availability),
  );
  const relocations = useProjectAvailabilityStore((state) => state.relocations);

  useEffect(() => {
    if (!isTauri() || !projectId || !openedInPlace || !reachable) return;
    void relocations;
    const started = watchProjectFolder(projectId).catch((error) => {
      void logError("watch project folder", error);
      return null;
    });
    return () => {
      void started.then((token) => {
        if (token === null) return;
        void unwatchProjectFolder(projectId, token).catch((error) =>
          logError("stop watching project folder", error),
        );
      });
    };
  }, [projectId, openedInPlace, reachable, relocations]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<FolderChangePayload>(FOLDER_CHANGED_EVENT, (event) => {
      if (event.payload) applyFolderChange(event.payload);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch((error) => logError("listen for folder changes", error));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  return null;
}
