import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ZoteroLibraryStatus } from "@oleafly/backend-port";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { logError } from "@/lib/log";
import { loadProjectLinks } from "@/features/zotero-cite";
import { useZoteroStaleStore } from "@/features/zotero-actions";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useZoteroLibraryStore } from "@/store/zotero-library";

export const ZOTERO_CHANGED_EVENT = "zotero-library-changed";

function hasEntries(record: Readonly<Record<string, string>>): boolean {
  for (const key in record) {
    if (Object.hasOwn(record, key)) return true;
  }
  return false;
}

function refreshProject(projectId: string): void {
  void loadProjectLinks(projectId)
    .then(() => useZoteroStaleStore.getState().refresh())
    .catch((error: unknown) => logError("read Zotero links for the project", error));
}

export function ZoteroKeeper() {
  const tauri = isTauri();
  useTauriEvent<ZoteroLibraryStatus>(
    ZOTERO_CHANGED_EVENT,
    (status) => {
      if (status) useZoteroLibraryStore.getState().applyStatus(status);
    },
    tauri,
  );

  useEffect(() => {
    if (!tauri) return;
    const store = useZoteroLibraryStore.getState();
    void store.load().then(() => useZoteroLibraryStore.getState().syncInBackground());
    const onFocus = () => useZoteroLibraryStore.getState().syncInBackground();
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tauri]);

  const projectId = useFilesStore((state) => state.projectId);
  const textsLoaded = useIndexStore((state) => hasEntries(state.texts));

  useEffect(() => {
    if (!tauri || !projectId || !textsLoaded) return;
    refreshProject(projectId);
    return useZoteroLibraryStore.subscribe((state, previous) => {
      if (state.status?.generation !== previous.status?.generation) refreshProject(projectId);
    });
  }, [tauri, projectId, textsLoaded]);

  return null;
}
