import { create } from "zustand";
import { logError } from "@/lib/log";
import type { CollabAccessLogStatus } from "@/lib/tauri";
import { collabAccessLogStatus } from "@/lib/tauri-collab";

interface AccessLogSwitches {
  byProject: Readonly<Record<string, CollabAccessLogStatus>>;
  load: (projectId: string) => Promise<void>;
  set: (projectId: string, status: CollabAccessLogStatus) => void;
}

export const useAccessLogSwitches = create<AccessLogSwitches>((set) => ({
  byProject: {},
  load: async (projectId) => {
    let status: CollabAccessLogStatus;
    try {
      status = await collabAccessLogStatus(projectId);
    } catch (error) {
      void logError("collab access log status", error);
      return;
    }
    set((state) => ({ byProject: { ...state.byProject, [projectId]: status } }));
  },
  set: (projectId, status) => set((state) => ({ byProject: { ...state.byProject, [projectId]: status } })),
}));
