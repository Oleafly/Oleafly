import { useAgentHandoffStore } from "@/store/agent-handoff";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { acpCatalog, acpUsable } from "@/lib/acp";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { getConfig } from "@/lib/tauri";

/** A connected CLI agent can take a hand-off in an open project. */
async function cliAssistantReady(): Promise<boolean> {
  if (!useFilesStore.getState().projectId) return false;
  try {
    return (await acpCatalog()).some(acpUsable);
  } catch {
    return false;
  }
}

export function revealAssistant() {
  const settings = useSettingsStore.getState();
  if (!settings.chatFloating) settings.setAssistantOpen(true);
}

export async function ensureAiProviderOrOpenSettings(): Promise<boolean> {
  let configured = false;
  try {
    configured = hasConfiguredProvider(await getConfig());
  } catch {
    configured = false;
  }
  if (!configured) configured = await cliAssistantReady();
  if (!configured) {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("ai");
    settings.setSettingsOpen(true);
  }
  return configured;
}

export function handoffToAssistant(
  prompt: string,
  opts?: { autoSend?: boolean; images?: string[] },
) {
  useAgentHandoffStore.getState().handoff(prompt, {
    autoSend: opts?.autoSend ?? false,
    images: opts?.images,
  });
  revealAssistant();
}
