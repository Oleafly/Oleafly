import { create } from "zustand";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { i18n } from "@/i18n";
import { toast } from "@/lib/toast";
import { selectActiveRuntime, useAssistantRuntimeStore } from "@/store/assistant-runtime";

export function handoffRuntimeSwitchMessage(): string {
  return i18n.t(($) => $.core.assistant.handoffRuntimeSwitch);
}

export type HandoffTarget = "built-in" | "acp";

interface AgentHandoffState {
  pendingPrompt: string | null;
  autoSend: boolean;
  pendingImages: string[];
  /** The assistant that takes the pending prompt. */
  target: HandoffTarget;
  handoff: (prompt: string, opts?: { autoSend?: boolean; images?: string[] }) => void;
  consume: () => { prompt: string; autoSend: boolean; images: string[] } | null;
  /** Sends the pending prompt to the CLI assistant, for when Oleafly's has no provider. */
  redirectToCli: () => void;
}

export const useAgentHandoffStore = create<AgentHandoffState>((set, get) => ({
  pendingPrompt: null,
  autoSend: false,
  pendingImages: [],
  target: "built-in",
  handoff: (prompt, opts) => {
    const images = opts?.images ?? [];
    // A hand-off goes to the assistant in use. The CLI composer can't take
    // images, so a hand-off that carries some still goes to Oleafly's.
    const onCli = selectActiveRuntime(useAssistantRuntimeStore.getState()) === "acp";
    const target: HandoffTarget = onCli && images.length === 0 ? "acp" : "built-in";
    if (target === "built-in" && useAssistantRuntimeStore.getState().switchToBuiltInForHandoff()) {
      toast.infoUnique("assistant-handoff-runtime", handoffRuntimeSwitchMessage());
    }
    set({
      pendingPrompt: prompt,
      autoSend: opts?.autoSend ?? true,
      pendingImages: images,
      target,
    });
  },
  redirectToCli: () => {
    if (!get().pendingPrompt) return;
    useAssistantRuntimeStore.getState().showCliForHandoff();
    set({ target: "acp" });
    toast.infoUnique("assistant-handoff-runtime", i18n.t(($) => $.core.assistant.handoffToCli));
  },
  consume: () => {
    const { pendingPrompt, autoSend, pendingImages } = get();
    if (!pendingPrompt) return null;
    set({ pendingPrompt: null, autoSend: false, pendingImages: [], target: "built-in" });
    return { prompt: pendingPrompt, autoSend, images: pendingImages };
  },
}));

if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __agentHandoff?: (prompt: string, autoSend?: boolean) => void;
  };
  w.__agentHandoff = (prompt, autoSend = false) =>
    useAgentHandoffStore.getState().handoff(prompt, { autoSend });
}
