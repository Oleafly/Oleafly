import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getConfig, setConfig as saveConfig } from "@/lib/tauri";
import {
  effectiveProviderKeys,
  pickActiveProvider,
} from "@/lib/ai-providers";
import { aiFeaturesReady, cliAgentRoute } from "@/lib/ai-route";
import { i18n } from "@/i18n";
import { configuredModelGroups } from "@/lib/ai-model-groups";
import { instructionBlock, runInlineCompletion } from "@/lib/ai-inline";
import { logError } from "@/lib/log";
import { addSavedInstruction, recordSavedInstructionUse } from "@/features/saved-instructions";
import {
  canSaveMore,
  hasSavedText,
  pickedInstructions,
  rankSavedInstructions,
} from "@/lib/saved-instructions";
import { notifyError } from "@/lib/toast";
import { useProviderConfig } from "@/hooks/use-provider-config";
import { useInlineEditStore } from "@/store/inlineEdit";
import { useSettingsStore } from "@/store/settings";
import { listOllamaModels } from "@/lib/ollama";
import { getEditorView } from "@/components/editor/cm/controller";
import { SAVED_INSTRUCTIONS_TARGET } from "@/components/settings/ai-settings-navigation";
import { AiChrome, AiMark } from "@/components/ai/AiChrome";
import { handoffToAssistant } from "@/features/assistant-handoff";
import { useFilesStore } from "@/store/files";
import { useTourStore } from "@/store/tours";
import { acceptInlineEdit, rejectInlineEdit } from "./plugin";
import { NAMING_SELECTOR, PromptPopover } from "./PromptPopover";
import { DiffActionBar, DiffErrorBar, DiffWithdrawnBar } from "./DiffActionBar";

const ELSEWHERE = `${NAMING_SELECTOR}, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]`;

function keyBelongsElsewhere(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const host = target.closest(ELSEWHERE);
  return host !== null && !host.contains(getEditorView()?.dom ?? null);
}

function SetUpProviderCard({ onOpenSettings }: Readonly<{ onOpenSettings: () => void }>) {
  const { t } = useTranslation(["editor"]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <AiChrome
      borderVariant="primary"
      className="w-full"
      contentClassName="ai-surface-elevated p-3 text-popover-foreground"
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <AiMark /> {t(($) => $.editor.inlineAi.setUpProvider)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(($) => $.editor.inlineAi.setUpProviderHint)}
      </p>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpenSettings}
        className="mt-2 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:bg-primary/85"
      >
        {t(($) => $.editor.inlineAi.openAiSettings)}
      </button>
    </AiChrome>
  );
}

export function InlineEditPanel() {
  const { t } = useTranslation(["common", "editor"]);
  const session = useInlineEditStore((s) => s.session);
  const picked = useInlineEditStore((s) => s.picked);
  const { config } = useProviderConfig();
  const providerReady = config ? aiFeaturesReady(config) : true;
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const host = config?.ai_keys?.ollama;
    if (!host) {
      setOllamaModels([]);
      return;
    }
    void listOllamaModels(host).then(setOllamaModels).catch(() => setOllamaModels([]));
  }, [config?.ai_keys?.ollama]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (session?.phase !== "withdrawn") return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [session?.phase]);

  const saved = rankSavedInstructions(config);
  const chosen = pickedInstructions(config, picked);
  const chosenIds = chosen.map((instruction) => instruction.id);

  const reset = () => useInlineEditStore.getState().reset();
  const close = () => {
    reset();
    getEditorView()?.focus();
  };
  const stop = () => {
    abortRef.current?.abort();
    close();
  };
  const accept = () => {
    const v = getEditorView();
    if (v) acceptInlineEdit(v);
  };
  const reject = () => {
    const v = getEditorView();
    if (v) rejectInlineEdit(v);
  };
  const retry = () =>
    useInlineEditStore.setState((st) =>
      st.session ? { session: { ...st.session, phase: "prompting", proposed: "" } } : st,
    );
  const dismiss = () => {
    const phase = useInlineEditStore.getState().session?.phase;
    if (phase === "streaming") stop();
    else if (phase === "reviewing") reject();
    else close();
  };

  const run = async (preset?: string) => {
    const s = useInlineEditStore.getState().session;
    if (!s) return;
    const instruction = [preset?.trim(), s.instruction.trim()].filter(Boolean).join("\n");
    const standing = pickedInstructions(config, useInlineEditStore.getState().picked);
    if (!instruction && standing.length === 0) return;
    const store = useInlineEditStore.getState();
    store.setInstruction(instruction);
    const view = getEditorView();
    const original = view ? view.state.sliceDoc(s.from, s.to) : s.original;
    store.startStreaming(original);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (standing.length > 0) {
      recordSavedInstructionUse(standing.map((entry) => entry.id)).catch((e: unknown) => {
        void logError("ai", e);
      });
    }
    try {
      await runInlineCompletion({
        engine: useFilesStore.getState().engineLoaded
          ? useFilesStore.getState().engine
          : undefined,
        instruction,
        saved: standing.map((entry) => entry.text),
        preferences: config?.ai_system_prompt,
        selection: original,
        signal: ctrl.signal,
        onToken: (full) => useInlineEditStore.getState().appendProposed(full),
      });
      if (!ctrl.signal.aborted) useInlineEditStore.getState().finishReviewing();
    } catch (e) {
      if (!ctrl.signal.aborted) {
        void logError("ai", e);
        useInlineEditStore.getState().fail(String((e as Error)?.message ?? e));
      }
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` reads the live store; re-creating the effect on its identity would re-fire the request.
  useEffect(() => {
    if (!session?.autoRun || session.phase !== "prompting") return;
    if (!providerReady || !config) return;
    useInlineEditStore.setState((st) =>
      st.session ? { session: { ...st.session, autoRun: false } } : st,
    );
    void run();
  }, [session?.autoRun, session?.phase, session?.instruction, providerReady, config]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribes on each session change; handlers read the live store/view.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      if (keyBelongsElsewhere(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      } else if (e.key === "Enter" && useInlineEditStore.getState().session?.phase === "reviewing") {
        e.preventDefault();
        e.stopPropagation();
        accept();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [session]);

  if (!session) return null;

  const openSettings = (scrollTarget: string | null) => {
    reset();
    const settings = useSettingsStore.getState();
    if (scrollTarget) settings.setSettingsScrollTarget(scrollTarget);
    settings.setSettingsInitialSection("ai");
    settings.setSettingsOpen(true);
  };

  const saveInstruction = async (name: string) => {
    const text = useInlineEditStore.getState().session?.instruction.trim() ?? "";
    if (!text) return;
    try {
      const added = await addSavedInstruction(name, text);
      if (!added) return;
      const store = useInlineEditStore.getState();
      if (store.session?.instruction.trim() === text) store.setInstruction("");
      if (!store.picked.includes(added.id)) store.togglePicked(added.id);
    } catch (e) {
      notifyError("ai", e, t(($) => $.editor.savedInstructions.saveFailed));
    }
  };

  const typed = session.instruction.trim();
  const canSave = config !== null && typed !== "" && !hasSavedText(config, typed) && canSaveMore(config);

  const openInAgent = () => {
    const s = useInlineEditStore.getState().session;
    if (!s) return;
    const texts = pickedInstructions(config, useInlineEditStore.getState().picked).map((entry) => entry.text);
    const instruction = s.instruction.trim() || (texts.length > 0 ? "" : "(no instruction)");
    const original = s.original.slice(0, 4000);
    const proposed = s.proposed.slice(0, 4000);
    const prompt = [
      "Continue this inline edit with full project tools (read/write/compile/verify).",
      "",
      instructionBlock(instruction, texts),
      "",
      "Original selection:",
      "```",
      original,
      "```",
      proposed
        ? ["", "Proposed rewrite so far:", "```", proposed, "```"].join("\n")
        : "",
      "",
      "Please improve or finish this change across the project as needed, then compile if relevant.",
    ]
      .filter(Boolean)
      .join("\n");
    handoffToAssistant(prompt, { autoSend: true });
    reset();
  };

  const selectModel = async (providerId: string, modelId: string) => {
    const current = await getConfig();
    const next = { ...current, ai_provider: providerId, ai_model: modelId };
    await saveConfig(next);
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: next }));
  };

  // With no API provider, inline edits go to the CLI agent picked for Tools,
  // which is chosen there rather than here.
  const agentRoute = config ? cliAgentRoute(config) : null;
  const agentGroup = agentRoute
    ? {
        id: agentRoute.provider_id,
        name: agentRoute.agent,
        models: [{
          id: agentRoute.model_id,
          name: agentRoute.model_id === "default"
            ? i18n.t(($) => $.researchTools.converterModel.agentDefaultModel)
            : agentRoute.model_id,
        }],
      }
    : null;
  const configuredActive = config && !agentRoute ? pickActiveProvider(config) : null;
  const active = agentRoute
    ? { providerId: agentRoute.provider_id, modelId: agentRoute.model_id }
    : configuredActive;
  const configuredGroups = config && !agentRoute
    ? configuredModelGroups(
        {
          keys: effectiveProviderKeys(config),
          customProviders: config.ai_custom_providers ?? [],
          providerModels: config.ai_provider_models ?? {},
        },
        {
          liveOllama: ollamaModels,
          keep: active ? { providerId: active.providerId, modelId: active.modelId } : undefined,
        },
      )
    : [];
  const modelGroups = agentGroup ? [agentGroup] : configuredGroups;

  const renderPanel = () => {
    if (session.phase === "withdrawn") {
      return <DiffWithdrawnBar onDismiss={close} />;
    }
    if (!providerReady) {
      return <SetUpProviderCard onOpenSettings={() => openSettings(null)} />;
    }
    if (session.phase === "error") {
      return <DiffErrorBar message={session.error ?? ""} onRetry={retry} onDismiss={close} />;
    }
    if (session.phase === "reviewing") {
      return (
        <DiffActionBar
          onAccept={accept}
          onReject={reject}
          onRetry={retry}
          onOpenInAgent={openInAgent}
        />
      );
    }
    return (
      <PromptPopover
        instruction={session.instruction}
        onInstruction={(v) => useInlineEditStore.getState().setInstruction(v)}
        onSubmit={() => void run()}
        onPreset={(instr) => void run(instr)}
        onClose={dismiss}
        streaming={session.phase === "streaming"}
        onStop={stop}
        providerId={active?.providerId ?? ""}
        modelId={active?.modelId ?? ""}
        modelGroups={modelGroups}
        onModelChange={(providerId, modelId) => {
          if (!agentRoute) void selectModel(providerId, modelId);
        }}
        saved={saved}
        picked={chosenIds}
        onToggleSaved={(id) => useInlineEditStore.getState().togglePicked(id)}
        canSave={canSave}
        onSave={(name) => void saveInstruction(name)}
        onManage={() => openSettings(SAVED_INSTRUCTIONS_TARGET)}
      />
    );
  };

  return <div className="my-1 w-full">{renderPanel()}</div>;
}
