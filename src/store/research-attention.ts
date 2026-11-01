import { useEffect } from "react";
import { create } from "zustand";
import { useFilesStore } from "@/store/files";
import { useResearchTasksEnabled } from "@/store/research-tasks-flag";

interface ResearchAttentionState {
  byProject: Record<string, number>;
}

export const useResearchAttentionStore = create<ResearchAttentionState>(() => ({ byProject: {} }));

let started: Promise<void> | null = null;
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

export function startResearchAttention(): Promise<void> {
  started ??= listenAndLoad().catch(() => {
    started = null;
  });
  return started;
}

export function useResearchAttentionBadge(): number {
  const enabled = useResearchTasksEnabled();
  useEffect(() => {
    if (enabled) void startResearchAttention();
  }, [enabled]);
  const projectId = useFilesStore((state) => state.projectId);
  const count = useResearchAttentionStore((state) => (projectId ? (state.byProject[projectId] ?? 0) : 0));
  return enabled ? count : 0;
}
