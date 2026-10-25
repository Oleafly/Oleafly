import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getConfig, type AppConfig } from "@/lib/tauri";

// 0.4.8: research tasks are experimental and off until the user turns them
// on under Settings, Research. The switch hides the tasks panel, the task
// outputs in Files, the task tools of the assistant and the MCP server, and
// the attention badge; Rust refuses to create or start a task while it is
// off and never hands work to the background helper.
//
// This module is on the boot path (the MCP bridge imports it), so it reads
// the config itself rather than through the config cache, whose import
// installs a window listener. The cache may keep an older value of the
// switch; nothing reads the switch from there, and a whole-config save keeps
// the stored value on the Rust side.

interface ResearchTasksFlagState {
  /** Whether research tasks are on. False until the config has been read. */
  enabled: boolean;
}

export const useResearchTasksFlagStore = create<ResearchTasksFlagState>(() => ({ enabled: false }));

let loading: Promise<void> | null = null;

/** Reads the switch from the config once; a failed read is tried again by the next caller. */
export function loadResearchTasksFlag(): Promise<void> {
  // Through a promise, so a bridge that throws (a test's partial mock) is a
  // failed read like any other instead of an error inside a render effect.
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

/** Remembers the switch from a config another caller has just read, so no second read is needed. */
export function primeResearchTasksFlag(config: Pick<AppConfig, "research_tasks_enabled">): void {
  useResearchTasksFlagStore.setState({ enabled: config.research_tasks_enabled === true });
  loading ??= Promise.resolve();
}

/** The switch as last read, for code that runs outside React (tool factories, the MCP bridge). */
export function researchTasksEnabled(): boolean {
  return useResearchTasksFlagStore.getState().enabled;
}

/** Whether research tasks are on; reads the config the first time a component asks. */
export function useResearchTasksEnabled(): boolean {
  useEffect(() => {
    void loadResearchTasksFlag();
  }, []);
  return useResearchTasksFlagStore((state) => state.enabled);
}

/**
 * Turns research tasks on or off. Rust stores the setting, starts queued
 * work when they go on, and stops every running task when they go off.
 */
export async function setResearchTasksEnabled(enabled: boolean): Promise<void> {
  await invoke<void>("research_tasks_set_enabled", { enabled });
  useResearchTasksFlagStore.setState({ enabled });
}

/** Test-only: forget the one-time read so the next hook reads the config again. */
export function resetResearchTasksFlagForTests(): void {
  loading = null;
  useResearchTasksFlagStore.setState({ enabled: false });
}
