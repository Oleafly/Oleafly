import { create } from "zustand";

interface AgentHandoffState {
  pendingPrompt: string | null;
  autoSend: boolean;
  pendingImages: string[];
  handoff: (prompt: string, opts?: { autoSend?: boolean; images?: string[] }) => void;
  consume: () => { prompt: string; autoSend: boolean; images: string[] } | null;
}

export const useAgentHandoffStore = create<AgentHandoffState>((set, get) => ({
  pendingPrompt: null,
  autoSend: false,
  pendingImages: [],
  handoff: (prompt, opts) =>
    set({
      pendingPrompt: prompt,
      autoSend: opts?.autoSend ?? true,
      pendingImages: opts?.images ?? [],
    }),
  consume: () => {
    const { pendingPrompt, autoSend, pendingImages } = get();
    if (!pendingPrompt) return null;
    set({ pendingPrompt: null, autoSend: false, pendingImages: [] });
    return { prompt: pendingPrompt, autoSend, images: pendingImages };
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
