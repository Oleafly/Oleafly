import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { isFolderProject } from "@/lib/library-projects";
import { onProjectWriteFailure } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { loadFolderAccess, refreshFolderStatus, useFolderAccessStore } from "@/store/folder-access";
import { useGitStatusStore } from "@/store/git-status";
import { useOpenFolderStore } from "@/store/open-folder";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import { useSettingsStore } from "@/store/settings";

function switchProject(projectId: string | null): void {
  if (projectId) void loadFolderAccess(projectId);
  else useFolderAccessStore.getState().reset(null);
}

const ACTIVATION_RECHECK_MS = 300;

function linkedFolderProject(): string | null {
  const { projectId, projects } = useFilesStore.getState();
  const access = useFolderAccessStore.getState();
  if (!projectId || access.projectId !== projectId) return null;
  if (access.status !== null) return projectId;
  const project = projects.find((entry) => entry.id === projectId);
  return project && isFolderProject(project) ? projectId : null;
}

function takePresentedFolder(): void {
  const opened = useOpenFolderStore.getState().opened;
  const files = useFilesStore.getState();
  if (!opened || files.loading || files.projectId !== opened.project_id) return;
  if (opened.detection.decision !== "auto") {
    const settings = useSettingsStore.getState();
    if (!settings.showTree) settings.setShowTree(true);
    if (settings.railTab !== "files") settings.setRailTab("files");
  }
  if (opened.detection.decision !== "ask") useOpenFolderStore.getState().dismiss();
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

  useEffect(
    () =>
      onProjectWriteFailure((projectId) => {
        if (linkedFolderProject() === projectId) void refreshFolderStatus(projectId);
      }),
    [],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocus = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const projectId = linkedFolderProject();
        if (projectId) void refreshFolderStatus(projectId);
      }, ACTIVATION_RECHECK_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  useTauriEvent<string>(
    "project-trust-changed",
    (projectId) => void useFolderAccessStore.getState().refreshTrust(projectId),
    isTauri(),
  );

  return null;
}
