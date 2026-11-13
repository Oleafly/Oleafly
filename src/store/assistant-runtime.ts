import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AssistantRuntime = "built-in" | "acp";

export const WORKSPACE_RUNTIME_SCOPE = "workspace";
const SCOPED_DEFAULT = "scoped-default";
const MAX_SCOPED_RUNTIMES = 100;

interface AssistantRuntimeState {
  runtime: AssistantRuntime;
  handoffRuntime: AssistantRuntime | null;
  runtimeByScope: Readonly<Record<string, AssistantRuntime>>;
  setRuntime: (runtime: AssistantRuntime) => void;
  setScopeRuntime: (scope: string, runtime: AssistantRuntime) => void;
  switchToBuiltInForHandoff: () => boolean;
  /** Shows the CLI assistant for a hand-off without changing the saved choice. */
  showCliForHandoff: () => void;
}

export const selectActiveRuntime = (
  state: Pick<AssistantRuntimeState, "runtime" | "handoffRuntime">,
): AssistantRuntime => state.handoffRuntime ?? state.runtime;

export function selectScopeRuntime(scope: string) {
  return (
    state: Pick<AssistantRuntimeState, "runtime" | "handoffRuntime" | "runtimeByScope">,
  ): AssistantRuntime => {
    if (scope === WORKSPACE_RUNTIME_SCOPE) return selectActiveRuntime(state);
    return state.runtimeByScope[scope] ?? state.runtimeByScope[SCOPED_DEFAULT] ?? "built-in";
  };
}

function isRuntime(value: unknown): value is AssistantRuntime {
  return value === "built-in" || value === "acp";
}

function savedScopes(value: unknown): Record<string, AssistantRuntime> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, AssistantRuntime] => isRuntime(entry[1]),
    ),
  );
}

function withScope(
  current: Readonly<Record<string, AssistantRuntime>>,
  scope: string,
  runtime: AssistantRuntime,
): Record<string, AssistantRuntime> {
  const { [scope]: _previous, [SCOPED_DEFAULT]: _default, ...rest } = current;
  const kept = Object.entries(rest).slice(-(MAX_SCOPED_RUNTIMES - 2));
  return { ...Object.fromEntries(kept), [scope]: runtime, [SCOPED_DEFAULT]: runtime };
}

export const useAssistantRuntimeStore = create<AssistantRuntimeState>()(
  persist(
    (set, get) => ({
      runtime: "built-in",
      handoffRuntime: null,
      runtimeByScope: {},
      setRuntime: (runtime) => set({ runtime, handoffRuntime: null }),
      setScopeRuntime: (scope, runtime) => {
        if (scope === WORKSPACE_RUNTIME_SCOPE) {
          set({ runtime, handoffRuntime: null });
          return;
        }
        set((state) => ({ runtimeByScope: withScope(state.runtimeByScope, scope, runtime) }));
      },
      switchToBuiltInForHandoff: () => {
        if (selectActiveRuntime(get()) === "built-in") return false;
        set({ handoffRuntime: "built-in" });
        return true;
      },
      showCliForHandoff: () => set({ handoffRuntime: get().runtime === "acp" ? null : "acp" }),
    }),
    {
      name: "oleafly.assistant-runtime.v1",
      partialize: (state) =>
        Object.keys(state.runtimeByScope).length > 0
          ? { runtime: state.runtime, runtimeByScope: state.runtimeByScope }
          : { runtime: state.runtime },
      merge: (persisted, current) => {
        const saved = persisted as Partial<AssistantRuntimeState> | null;
        return {
          ...current,
          runtime: saved?.runtime === "acp" ? "acp" : "built-in",
          runtimeByScope: savedScopes(saved?.runtimeByScope),
        };
      },
    },
  ),
);
