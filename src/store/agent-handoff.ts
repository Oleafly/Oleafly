import { create } from "zustand";

interface AgentHandoffState {
  pendingPrompt: string | null;
  autoSend: boolean;
  handoff: (prompt: string, opts?: { autoSend?: boolean }) => void;
  consume: () => { prompt: string; autoSend: boolean } | null;
}

export const useAgentHandoffStore = create<AgentHandoffState>((set, get) => ({
  pendingPrompt: null,
  autoSend: false,
  handoff: (prompt, opts) =>
    set({ pendingPrompt: prompt, autoSend: opts?.autoSend ?? true }),
  consume: () => {
    const { pendingPrompt, autoSend } = get();
    if (!pendingPrompt) return null;
    set({ pendingPrompt: null, autoSend: false });
    return { prompt: pendingPrompt, autoSend };
  },
}));

// E2E / devtools hook: seed a handoff without going through inline AI.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __agentHandoff?: (prompt: string, autoSend?: boolean) => void;
  };
  w.__agentHandoff = (prompt, autoSend = false) =>
    useAgentHandoffStore.getState().handoff(prompt, { autoSend });
}
