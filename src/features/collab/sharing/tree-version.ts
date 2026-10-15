import { useMemo, useState } from "react";
import { FOLDER_CHANGED_EVENT } from "@/components/layout/FolderWatchKeeper";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import type { FolderChangePayload } from "@/lib/external-file-changes";
import { useCollabLiveStore } from "../live/live-store";

export interface LiveTree {
  projectId: string;
  version: number;
}

export function useLiveTree(): LiveTree | null {
  const projectId = useCollabLiveStore((state) => (state.status ? state.projectId : null));
  const [version, setVersion] = useState(0);
  useTauriEvent<FolderChangePayload>(
    FOLDER_CHANGED_EVENT,
    (payload) => {
      if (payload?.projectId === projectId && payload.structural) setVersion((value) => value + 1);
    },
    projectId !== null,
  );
  return useMemo(() => (projectId === null ? null : { projectId, version }), [projectId, version]);
}
