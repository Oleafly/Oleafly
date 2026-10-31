import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getConfig, type AppConfig } from "@/lib/tauri";

interface ResearchTasksFlagState {
  enabled: boolean;
}

export const useResearchTasksFlagStore = create<ResearchTasksFlagState>(() => ({ enabled: false }));

let loading: Promise<void> | null = null;

export function loadResearchTasksFlag(): Promise<void> {
  loading ??= Promise.resolve()
    .then(() => getConfig())
    .then((config) => {
      useResearchTasksFlagStore.setState({ enabled: config.research_tasks_enabled === true });
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

export function primeResearchTasksFlag(config: Pick<AppConfig, "research_tasks_enabled">): void {
  useResearchTasksFlagStore.setState({ enabled: config.research_tasks_enabled === true });
  loading ??= Promise.resolve();
}

export function researchTasksEnabled(): boolean {
  return useResearchTasksFlagStore.getState().enabled;
}

export function useResearchTasksEnabled(): boolean {
  useEffect(() => {
    void loadResearchTasksFlag();
  }, []);
  return useResearchTasksFlagStore((state) => state.enabled);
}

export async function setResearchTasksEnabled(enabled: boolean): Promise<void> {
  await invoke<void>("research_tasks_set_enabled", { enabled });
  useResearchTasksFlagStore.setState({ enabled });
}

export function resetResearchTasksFlagForTests(): void {
  loading = null;
  useResearchTasksFlagStore.setState({ enabled: false });
}
