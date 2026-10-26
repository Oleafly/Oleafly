import { useEffect, useSyncExternalStore } from "react";
import { registry, type AiToolsetContribution } from "@oleafly/registry";
import { logError } from "@/lib/log";

// The built-in toolsets register from their own chunk: building them pulls in
// every tool implementation, which only a chat run or the tool list needs.
let loading: Promise<readonly AiToolsetContribution[]> | null = null;
let toolsets: readonly AiToolsetContribution[] = registry.aiToolsets.slice();
const listeners = new Set<() => void>();

export function loadAiToolsets(): Promise<readonly AiToolsetContribution[]> {
  loading ??= import("@/contributions/ai-toolsets").then(
    ({ registerAiToolsets }) => {
      registerAiToolsets();
      toolsets = registry.aiToolsets.slice();
      for (const listener of listeners) listener();
      return toolsets;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The registered toolsets; starts the load and re-renders once it lands. */
export function useAiToolsets(): readonly AiToolsetContribution[] {
  useEffect(() => {
    loadAiToolsets().catch((error: unknown) => logError("load the assistant tools", error));
  }, []);
  return useSyncExternalStore(subscribe, () => toolsets);
}
