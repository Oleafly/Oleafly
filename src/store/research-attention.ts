import { useEffect } from "react";
import { create } from "zustand";
import { useFilesStore } from "@/store/files";
import { useResearchTasksEnabled } from "@/store/research-tasks-flag";

interface ResearchAttentionState {
  /** Tasks needing the user per project: a result, a plan or a request. */
  byProject: Record<string, number>;
}

export const useResearchAttentionStore = create<ResearchAttentionState>(() => ({ byProject: {} }));

let started: Promise<void> | null = null;
// Kept once it works, so a retry after a failed load doesn't listen twice.
let listening: Promise<unknown> | null = null;

async function listenAndLoad(): Promise<void> {
  const { listenForResearchAttention, loadResearchAttention } = await import("@/lib/research-tasks");
  listening ??= listenForResearchAttention((summary) =>
    useResearchAttentionStore.setState({ byProject: summary.byProject }),
  ).catch((error: unknown) => {
    listening = null;
    throw error;
  });
  await listening;
  const summary = await loadResearchAttention();
  useResearchAttentionStore.setState({ byProject: summary.byProject });
}

/** One listener for the whole app, however many badges mount. */
export function startResearchAttention(): Promise<void> {
  started ??= listenAndLoad().catch(() => {
    started = null;
  });
  return started;
}

/** How many research tasks of the open project need the user; none while tasks are off. */
export function useResearchAttentionBadge(): number {
  const enabled = useResearchTasksEnabled();
  useEffect(() => {
    if (enabled) void startResearchAttention();
  }, [enabled]);
  const projectId = useFilesStore((state) => state.projectId);
  const count = useResearchAttentionStore((state) => (projectId ? (state.byProject[projectId] ?? 0) : 0));
  return enabled ? count : 0;
}
