import { create } from "zustand";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { toast } from "@/lib/toast";
import { useAssistantRuntimeStore } from "@/store/assistant-runtime";

export const HANDOFF_RUNTIME_SWITCH_MESSAGE = "Switched to the Oleafly assistant for this action.";

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
  handoff: (prompt, opts) => {
    if (useAssistantRuntimeStore.getState().switchToBuiltInForHandoff()) {
      toast.infoUnique("assistant-handoff-runtime", HANDOFF_RUNTIME_SWITCH_MESSAGE);
    }
    set({
      pendingPrompt: prompt,
      autoSend: opts?.autoSend ?? true,
      pendingImages: opts?.images ?? [],
    });
  },
  consume: () => {
    const { pendingPrompt, autoSend, pendingImages } = get();
    if (!pendingPrompt) return null;
    set({ pendingPrompt: null, autoSend: false, pendingImages: [] });
    return { prompt: pendingPrompt, autoSend, images: pendingImages };
  },
}));

// E2E / devtools hook: seed a handoff without going through inline AI.
if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __agentHandoff?: (prompt: string, autoSend?: boolean) => void;
  };
  w.__agentHandoff = (prompt, autoSend = false) =>
    useAgentHandoffStore.getState().handoff(prompt, { autoSend });
}
