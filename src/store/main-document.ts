import { create } from "zustand";
import type { FolderDetection } from "@/lib/folder-detection";
import { logError } from "@/lib/log";
import { mainDocumentMissing } from "@/lib/main-document";
import { projectDocumentCandidates } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export type CandidateStatus = "idle" | "loading" | "ready" | "failed";

interface MainDocumentState {
  projectId: string | null;
  detection: FolderDetection | null;
  status: CandidateStatus;
  changing: boolean;
  reset: (projectId: string | null) => void;
  seed: (projectId: string, detection: FolderDetection) => void;
  load: (projectId: string, options?: { fresh?: boolean }) => Promise<void>;
  openChange: () => void;
  closeChange: () => void;
}

let generation = 0;

export const useMainDocumentStore = create<MainDocumentState>((set, get) => ({
  projectId: null,
  detection: null,
  status: "idle",
  changing: false,
  reset: (projectId) => {
    generation += 1;
    set({ projectId, detection: null, status: "idle", changing: false });
  },
  seed: (projectId, detection) => {
    if (get().projectId !== projectId || detection.candidates.length === 0) return;
    set({ detection, status: "ready" });
  },
  load: async (projectId, options) => {
    const current = get();
    if (current.projectId !== projectId || current.status === "loading") return;
    if (current.status === "ready" && options?.fresh !== true) return;
    const request = generation;
    const stillCurrent = () => request === generation && get().projectId === projectId;
    set({ status: "loading" });
    try {
      const detection = await projectDocumentCandidates(projectId);
      if (stillCurrent()) set({ detection, status: "ready" });
    } catch (error) {
      void logError("look for documents in the folder", error);
      if (stillCurrent()) set({ status: "failed" });
    }
  },
  openChange: () => {
    const { projectId } = get();
    if (!projectId) return;
    set({ changing: true });
    void get().load(projectId, { fresh: true });
  },
  closeChange: () => set({ changing: false }),
}));

export async function chooseMainDocument(path: string): Promise<boolean> {
  const files = useFilesStore.getState();
  const projectId = files.projectId;
  if (!projectId) return false;
  const wasMissing = mainDocumentMissing(files);
  await files.setMainDoc(path);
  if (useFilesStore.getState().projectId !== projectId) return false;
  useSettingsStore.getState().revealEditor();
  await useFilesStore.getState().openFile(path);
  if (wasMissing && useFilesStore.getState().projectId === projectId) {
    const { useCompileStore } = await import("@/store/compile");
    const compile = useCompileStore.getState();
    if (compile.status !== "compiling") void compile.recompile({ origin: "automatic" });
  }
  return true;
}
