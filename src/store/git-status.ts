import { create } from "zustand";
import type { GitFileChange } from "@oleafly/backend-port";
import { gitStatus } from "@/lib/tauri";
import { projectFolderAvailable, reportLocationError } from "@/store/project-availability";

interface GitStatusState {
  count: number;
  /** The project `changes` belong to, so a switch never shows another project's. */
  projectId: string | null;
  changes: readonly GitFileChange[];
  refresh: (projectId: string | null) => Promise<void>;
}

const NO_CHANGES: readonly GitFileChange[] = [];

// Bumped on every refresh so a slow response from a previous project can't
// overwrite the count of the project the user has since switched to.
let refreshSeq = 0;

const sameChanges = (a: readonly GitFileChange[], b: readonly GitFileChange[]) =>
  a.length === b.length &&
  a.every(
    (change, index) =>
      change.path === b[index]?.path &&
      change.status === b[index]?.status &&
      change.staged === b[index]?.staged &&
      change.conflict === b[index]?.conflict,
  );

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
      const previous = get();
      // Polls usually find nothing new; keep the old list so the Explorer
      // does not rebuild its badges for an identical status.
      set({
        count: changes.length,
        projectId,
        changes:
          previous.projectId === projectId && sameChanges(previous.changes, changes)
            ? previous.changes
            : changes,
      });
    } catch (error) {
      if (reportLocationError(projectId, error)) return;
      if (seq === refreshSeq) set({ count: 0, projectId, changes: NO_CHANGES });
    }
  },
}));
