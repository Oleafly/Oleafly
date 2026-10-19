import { useEffect } from "react";
import { create } from "zustand";
import { useFilesStore } from "@/store/files";

interface ResearchAttentionState {
  /** Tasks needing the user per project: a result, a plan or a request. */
  byProject: Record<string, number>;
}

export const useResearchAttentionStore = create<ResearchAttentionState>(() => ({ byProject: {} }));

let started: Promise<void> | null = null;
// Kept once it works, so a retry after a failed load doesn't listen twice.
let listening: Promise<unknown> | null = null;

/** One listener for the whole app, however many badges mount. */
export function startResearchAttention(): Promise<void> {
  started ??= import("@/lib/research-tasks")
    .then(async ({ listenForResearchAttention, loadResearchAttention }) => {
      listening ??= listenForResearchAttention((summary) =>
        useResearchAttentionStore.setState({ byProject: summary.byProject }),
      ).catch((error: unknown) => {
        listening = null;
        throw error;
      });
      await listening;
      const summary = await loadResearchAttention();
      useResearchAttentionStore.setState({ byProject: summary.byProject });
    })
    .catch(() => {
      started = null;
    });
  return started;
}

/** How many research tasks of the open project need the user. */
export function useResearchAttentionBadge(): number {
  useEffect(() => {
    void startResearchAttention();
  }, []);
  const projectId = useFilesStore((state) => state.projectId);
  return useResearchAttentionStore((state) => (projectId ? (state.byProject[projectId] ?? 0) : 0));
}
