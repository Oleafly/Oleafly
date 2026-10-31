import { create } from "zustand";
import type { GitFileChange } from "@oleafly/backend-port";
import { sameGitChanges } from "@/lib/git-changes";
import { gitStatus } from "@/lib/tauri";
import { projectFolderAvailable, reportLocationError } from "@/store/project-availability";

interface GitStatusState {
  count: number;
  projectId: string | null;
  changes: readonly GitFileChange[];
  refresh: (projectId: string | null) => Promise<void>;
  apply: (projectId: string, changes: readonly GitFileChange[]) => void;
}

const NO_CHANGES: readonly GitFileChange[] = [];

let refreshSeq = 0;

export const useGitStatusStore = create<GitStatusState>((set, get) => ({
  count: 0,
  projectId: null,
  changes: NO_CHANGES,
  refresh: async (projectId) => {
    const seq = ++refreshSeq;
    if (!projectId) {
      set({ count: 0, projectId: null, changes: NO_CHANGES });
      return;
    }
    if (!projectFolderAvailable(projectId)) return;
    try {
      const changes = await gitStatus(projectId);
      if (seq !== refreshSeq) return;
      get().apply(projectId, changes);
    } catch (error) {
      if (reportLocationError(projectId, error)) return;
      if (seq === refreshSeq) set({ count: 0, projectId, changes: NO_CHANGES });
    }
  },
  apply: (projectId, changes) => {
    refreshSeq++;
    const previous = get();
    set({
      count: changes.length,
      projectId,
      changes:
        previous.projectId === projectId && sameGitChanges(previous.changes, changes)
          ? previous.changes
          : changes,
    });
  },
}));
