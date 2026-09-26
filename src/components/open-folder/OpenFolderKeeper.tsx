import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logError } from "@/lib/log";
import { isLinkedHome, mainDocumentMissing } from "@/lib/main-document";
import { useFilesStore } from "@/store/files";
import { loadFolderAccess, useFolderAccessStore } from "@/store/folder-access";
import { useGitStatusStore } from "@/store/git-status";
import { useMainDocumentStore } from "@/store/main-document";
import { useOpenFolderStore } from "@/store/open-folder";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import { useSettingsStore } from "@/store/settings";

const BACKGROUND_SEARCH_DELAY_MS = 1500;

function switchProject(projectId: string | null): void {
  useMainDocumentStore.getState().reset(projectId);
  if (projectId) void loadFolderAccess(projectId);
  else useFolderAccessStore.getState().reset(null);
}

function takePresentedFolder(): void {
  const opened = useOpenFolderStore.getState().opened;
  const files = useFilesStore.getState();
  if (!opened || files.loading || files.projectId !== opened.project_id) return;
  useMainDocumentStore.getState().seed(opened.project_id, opened.detection);
  if (opened.detection.decision !== "auto") {
    const settings = useSettingsStore.getState();
    settings.setShowTree(true);
    settings.setRailTab("files");
  }
  if (opened.detection.decision !== "ask") useOpenFolderStore.getState().dismiss();
}

function searchNeeded(): string | null {
  const files = useFilesStore.getState();
  const candidates = useMainDocumentStore.getState();
  if (
    !files.projectId ||
    files.loading ||
    !isLinkedHome(files.manifestHome) ||
    mainDocumentMissing(files) ||
    candidates.projectId !== files.projectId ||
    candidates.status !== "idle"
  ) {
    return null;
  }
  return files.projectId;
}

export function OpenFolderKeeper() {
  useEffect(() => {
    const initial = useFilesStore.getState().projectId;
    if (useFolderAccessStore.getState().projectId !== initial) switchProject(initial);
    return useFilesStore.subscribe((state, previous) => {
      if (state.projectId !== previous.projectId) {
        const opened = useOpenFolderStore.getState().opened;
        if (opened && previous.projectId === opened.project_id) {
          useOpenFolderStore.getState().dismiss();
        }
        switchProject(state.projectId);
      }
      takePresentedFolder();
    });
  }, []);

  useEffect(() => {
    takePresentedFolder();
    return useOpenFolderStore.subscribe(takePresentedFolder);
  }, []);

  useEffect(
    () =>
      useFolderAccessStore.subscribe((state, previous) => {
        const projectId = state.projectId;
        if (!projectId || projectId !== previous.projectId) return;
        if (state.trust?.trusted !== true || previous.trust?.trusted !== false) return;
        if (useFilesStore.getState().projectId !== projectId) return;
        void useFilesStore.getState().refreshEngine();
        void useGitStatusStore.getState().refresh(projectId);
        window.dispatchEvent(new Event("oleafly:git-changed"));
      }),
    [],
  );

  useEffect(
    () =>
      useProjectAvailabilityStore.subscribe((state, previous) => {
        if (!state.projectId || state.projectId !== previous.projectId) return;
        if (state.projectId !== useFolderAccessStore.getState().projectId) return;
        if (state.grantResets !== previous.grantResets || state.relocations !== previous.relocations) {
          void loadFolderAccess(state.projectId);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<string>("project-trust-changed", (event) => {
      void useFolderAccessStore.getState().refreshTrust(event.payload);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch((error) => logError("listen for folder trust changes", error));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  const projectId = useFilesStore((state) => state.projectId);
  const projectLoading = useFilesStore((state) => state.loading);
  const linked = useFilesStore((state) => isLinkedHome(state.manifestHome));
  const missing = useFilesStore(mainDocumentMissing);
  const unsearched = useMainDocumentStore(
    (state) => state.projectId === projectId && state.status === "idle",
  );
  const pendingSearch =
    projectId && !projectLoading && linked && !missing && unsearched ? projectId : null;
  useEffect(() => {
    if (!pendingSearch) return;
    const timer = setTimeout(() => {
      if (searchNeeded() === pendingSearch) {
        void useMainDocumentStore.getState().load(pendingSearch);
      }
    }, BACKGROUND_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pendingSearch]);

  return null;
}
