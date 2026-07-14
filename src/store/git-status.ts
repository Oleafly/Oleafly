import { create } from "zustand";
import { gitStatus } from "@/lib/tauri";

interface GitStatusState {
  count: number;
  refresh: (projectId: string | null) => Promise<void>;
}

// Bumped on every refresh so a slow response from a previous project can't
// overwrite the count of the project the user has since switched to.
let refreshSeq = 0;

export const useGitStatusStore = create<GitStatusState>((set) => ({
  count: 0,
  refresh: async (projectId) => {
    const seq = ++refreshSeq;
    if (!projectId) {
      set({ count: 0 });
      return;
    }
    try {
      const changes = await gitStatus(projectId);
      if (seq === refreshSeq) set({ count: changes.length });
    } catch {
      if (seq === refreshSeq) set({ count: 0 });
    }
  },
}));
