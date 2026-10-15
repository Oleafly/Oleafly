import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { applyFolderChange, type FolderChangePayload } from "@/lib/external-file-changes";
import { logError } from "@/lib/log";
import {
  COLLAB_LIVE_WRITTEN_EVENT,
  type CollabLiveWritten,
  unwatchProjectFolder,
  watchProjectFolder,
} from "@/lib/tauri";
import { refreshDiskSnapshots, useFilesStore } from "@/store/files";
import { folderReachable, useProjectAvailabilityStore } from "@/store/project-availability";

export const FOLDER_CHANGED_EVENT = "project-folder-changed";

function FolderWatch({ projectId }: Readonly<{ projectId: string }>) {
  useEffect(() => {
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
  }, [projectId]);

  return null;
}

export function FolderWatchKeeper() {
  const projectId = useFilesStore((state) => state.projectId);
  const reachable = useProjectAvailabilityStore(
    (state) => state.projectId !== projectId || folderReachable(state.availability),
  );
  const relocations = useProjectAvailabilityStore((state) => state.relocations);

  useTauriEvent<FolderChangePayload>(
    FOLDER_CHANGED_EVENT,
    (payload) => {
      if (payload) applyFolderChange(payload);
    },
    isTauri(),
  );

  // A live session that stopped names the open files it wrote, which the
  // folder watch never reported. Heard here rather than in the live session,
  // since it can arrive after Live collaboration was switched off. A file the
  // disk holds other text for is checked like any outside change.
  useTauriEvent<CollabLiveWritten>(
    COLLAB_LIVE_WRITTEN_EVENT,
    (payload) => {
      if (!payload) return;
      const changed = refreshDiskSnapshots(payload.projectId, payload.files);
      if (changed.length > 0) applyFolderChange({ projectId: payload.projectId, paths: changed, rescan: false });
    },
    isTauri(),
  );

  if (!isTauri() || !projectId || !reachable) return null;
  return <FolderWatch key={`${projectId}:${relocations}`} projectId={projectId} />;
}
