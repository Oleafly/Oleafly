import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AssistantRuntime = "built-in" | "acp";

interface AssistantRuntimeState {
  runtime: AssistantRuntime;
  setRuntime: (runtime: AssistantRuntime) => void;
}

export const useAssistantRuntimeStore = create<AssistantRuntimeState>()(
  persist(
    (set) => ({
      runtime: "built-in",
      setRuntime: (runtime) => set({ runtime }),
    }),
    {
      name: "oleafly.assistant-runtime.v1",
      merge: (persisted, current) => {
        const saved = persisted as Partial<AssistantRuntimeState> | null;
        return { ...current, runtime: saved?.runtime === "acp" ? "acp" : "built-in" };
      },
    },
  ),
);
