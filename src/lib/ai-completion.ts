import {
  effectiveProviderKeys,
  hasConfiguredProvider,
  isProviderConfigured,
} from "@oleafly/ai-core";
import { requestedGhostCompletion, type GhostRequest } from "@oleafly/editor";
import { i18n } from "@/i18n";
import { streamViaBackend, warmAgentConnection, type ProviderOverride } from "@/lib/agent-backend";
import { markupRule } from "@/lib/ai-inline";
import { describeError } from "@/lib/app-error";
import { getConfigCached } from "@/lib/config-cache";
import { logWarning } from "@/lib/log";
import type { AppConfig, DocumentEngineDescriptor } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { fileMode, useVisualModeStore } from "@/store/visual-mode";

const MAX_TOKENS = 64;
const TIMEOUT_MS = 20_000;

let lastFailure: string | null = null;

function systemPrompt(engine: DocumentEngineDescriptor | undefined): string {
  const profile = engine?.capabilities.formatting_profile ?? "none";
  return [
    profile === "none"
      ? "You suggest how to continue a document at the cursor, like an editor's autocomplete."
      : `You suggest how to continue a ${engine?.label ?? "technical"} document at the cursor, like an editor's autocomplete.`,
    "Reply with only the text to insert at <cursor/>: a short continuation on the same line, at most one sentence.",
    "Never repeat text that comes before the cursor. Start with a space when the continuation begins a new word.",
    "No code fences, no quotes around it, no explanation. If nothing fits, reply with nothing.",
    markupRule(profile),
  ].join(" ");
}

function chosenModel(config: AppConfig): ProviderOverride | undefined {
  const { aiCompletionProvider, aiCompletionModel } = useSettingsStore.getState();
  if (!aiCompletionProvider || !aiCompletionModel) return undefined;
  const keys = effectiveProviderKeys(config);
  return isProviderConfigured(aiCompletionProvider, keys, config.ai_custom_providers ?? [])
    ? { provider_id: aiCompletionProvider, model_id: aiCompletionModel }
    : undefined;
}

function reportFailure(error: unknown): void {
  const reason = describeError(error);
  if (reason === lastFailure) return;
  lastFailure = reason;
  notifyError("ai completion", error, i18n.t(($) => $.editor.aiCompletion.failed, { reason }));
}

function unfenced(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("```")) return text;
  const open = trimmed.indexOf("\n");
  if (open < 0) return "";
  const body = trimmed.slice(open + 1);
  const close = body.indexOf("```");
  return close >= 0 ? body.slice(0, close) : body;
}

export async function requestAiCompletion({ before, after, signal, onText }: GhostRequest): Promise<void> {
  try {
    const config = await getConfigCached();
    if (signal.aborted || !hasConfiguredProvider(config)) return;
    const files = useFilesStore.getState();
    let text = "";
    await streamViaBackend(
      {
        system: systemPrompt(files.engineLoaded ? files.engine : undefined),
        messages: [
          { role: "user", content: [{ type: "text", text: `<document>\n${before}<cursor/>${after}\n</document>` }] },
        ],
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
        effort: "none",
        reasoning_summary: false,
        timeout_ms: TIMEOUT_MS,
      },
      (event) => {
        if (event.kind !== "textDelta") return;
        text += event.text;
        onText(unfenced(text));
      },
      signal,
      chosenModel(config),
    );
    lastFailure = null;
  } catch (error) {
    if (!signal.aborted) reportFailure(error);
  }
}

export function warmAiCompletion(): void {
  void getConfigCached()
    .then((config) => (hasConfiguredProvider(config) ? warmAgentConnection(chosenModel(config)) : undefined))
    .catch((error: unknown) => logWarning("warm ai completion", error));
}

export function aiCompletionActive(): boolean {
  if (!useSettingsStore.getState().aiCompletion) return false;
  const path = useFilesStore.getState().activePath;
  return fileMode(useVisualModeStore.getState(), path) !== "visual";
}

export const aiCompletionExtension = requestedGhostCompletion(requestAiCompletion, {
  enabled: aiCompletionActive,
  warm: warmAiCompletion,
});
