import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AssistantRuntime = "built-in" | "acp";

interface AssistantRuntimeState {
  runtime: AssistantRuntime;
  handoffRuntime: AssistantRuntime | null;
  setRuntime: (runtime: AssistantRuntime) => void;
  switchToBuiltInForHandoff: () => boolean;
  /** Shows the CLI assistant for a hand-off without changing the saved choice. */
  showCliForHandoff: () => void;
}

export const selectActiveRuntime = (
  state: Pick<AssistantRuntimeState, "runtime" | "handoffRuntime">,
): AssistantRuntime => state.handoffRuntime ?? state.runtime;

export const useAssistantRuntimeStore = create<AssistantRuntimeState>()(
  persist(
    (set, get) => ({
      runtime: "built-in",
      handoffRuntime: null,
      setRuntime: (runtime) => set({ runtime, handoffRuntime: null }),
      switchToBuiltInForHandoff: () => {
        if (selectActiveRuntime(get()) === "built-in") return false;
        set({ handoffRuntime: "built-in" });
        return true;
      },
      showCliForHandoff: () => set({ handoffRuntime: get().runtime === "acp" ? null : "acp" }),
    }),
    {
      name: "oleafly.assistant-runtime.v1",
      partialize: (state) => ({ runtime: state.runtime }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AssistantRuntimeState> | null;
        return { ...current, runtime: saved?.runtime === "acp" ? "acp" : "built-in" };
      },
    },
  ),
);
