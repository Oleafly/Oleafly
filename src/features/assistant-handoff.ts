import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useSettingsStore } from "@/store/settings";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { getConfig } from "@/lib/tauri";

export function revealAssistant() {
  useSettingsStore.getState().setAssistantOpen(true);
}

export async function ensureAiProviderOrOpenSettings(): Promise<boolean> {
  let configured = false;
  try {
    configured = hasConfiguredProvider(await getConfig());
  } catch {
    configured = false;
  }
  if (!configured) {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("ai");
    settings.setSettingsOpen(true);
  }
  return configured;
}

export function handoffToAssistant(prompt: string, opts?: { autoSend?: boolean }) {
  useAgentHandoffStore.getState().handoff(prompt, { autoSend: opts?.autoSend ?? false });
  revealAssistant();
}
