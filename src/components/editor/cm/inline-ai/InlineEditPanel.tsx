import { useEffect, useRef, useState } from "react";
import { getConfig } from "@/lib/tauri";
import {
  getProvider,
  hasConfiguredProvider,
  pickActiveProvider,
  type AIConfigLike,
} from "@/lib/ai-providers";
import { runInlineCompletion } from "@/lib/ai-inline";
import { logError } from "@/lib/log";
import { useInlineEditStore } from "@/store/inlineEdit";
import { useSettingsStore } from "@/store/settings";
import { getEditorView } from "@/components/editor/cm/controller";
import { AiChrome, AiMark } from "@/components/ai/AiChrome";
import { useAgentHandoffStore } from "@/store/agent-handoff";
import { acceptInlineEdit, rejectInlineEdit } from "./plugin";
import { PromptPopover } from "./PromptPopover";
import { DiffActionBar, DiffErrorBar } from "./DiffActionBar";

function modelLabelFor(cfg: AIConfigLike): string {
  const { providerId, modelId } = pickActiveProvider(cfg);
  return getProvider(providerId)?.models.find((m) => m.id === modelId)?.name ?? modelId;
}

// Rendered inside a CodeMirror block widget below the target line; the widget
// mounts it when a session opens and unmounts it when it closes.
export function InlineEditPanel() {
  const session = useInlineEditStore((s) => s.session);
  const [providerReady, setProviderReady] = useState(true);
  const [modelLabel, setModelLabel] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const check = () =>
      void getConfig()
        .then((c) => {
          setProviderReady(hasConfiguredProvider(c));
          setModelLabel(modelLabelFor(c));
        })
        .catch(() => {});
    check();
    window.addEventListener("openleaf:ai-config-changed", check);
    return () => window.removeEventListener("openleaf:ai-config-changed", check);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const reset = () => useInlineEditStore.getState().reset();
  const stop = () => {
    abortRef.current?.abort();
    reset();
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
    else reset();
  };

  const run = async (instructionOverride?: string) => {
    const s = useInlineEditStore.getState().session;
    if (!s) return;
    const instruction = (instructionOverride ?? s.instruction).trim();
    if (!instruction) return;
    const store = useInlineEditStore.getState();
    store.setInstruction(instruction);
    store.startStreaming();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runInlineCompletion({
        instruction,
        selection: s.original,
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

  // Capture phase so this wins over the editor keymap; stopPropagation so no stray newline lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribes on each session change; handlers read the live store/view.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
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

  const openAiSettings = () => {
    reset();
    useSettingsStore.getState().setSettingsInitialSection("ai");
    useSettingsStore.getState().setSettingsOpen(true);
  };

  const openInAgent = () => {
    const s = useInlineEditStore.getState().session;
    if (!s) return;
    const instruction = s.instruction.trim() || "(no instruction)";
    const original = s.original.slice(0, 4000);
    const proposed = s.proposed.slice(0, 4000);
    const prompt = [
      "Continue this inline edit with full project tools (read/write/compile/verify).",
      "",
      `Instruction: ${instruction}`,
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
    useAgentHandoffStore.getState().handoff(prompt, { autoSend: true });
    const settings = useSettingsStore.getState();
    settings.setRailTab("ai");
    if (!settings.showTree) settings.toggleTree();
    reset();
  };

  return (
    <div className="my-1 w-full">
      {!providerReady ? (
        <AiChrome className="w-full" contentClassName="p-3 text-popover-foreground">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <AiMark /> Set up an AI provider
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add an API key (or local Ollama) to use inline AI edits.
          </p>
          <button
            type="button"
            onClick={openAiSettings}
            className="mt-2 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open Settings → AI
          </button>
        </AiChrome>
      ) : session.phase === "error" ? (
        <DiffErrorBar message={session.error ?? ""} onRetry={retry} onDismiss={reset} />
      ) : session.phase === "reviewing" ? (
        <DiffActionBar
          onAccept={accept}
          onReject={reject}
          onRetry={retry}
          onOpenInAgent={openInAgent}
        />
      ) : (
        <PromptPopover
          instruction={session.instruction}
          onInstruction={(v) => useInlineEditStore.getState().setInstruction(v)}
          onSubmit={() => void run()}
          onPreset={(instr) => void run(instr)}
          onClose={dismiss}
          streaming={session.phase === "streaming"}
          onStop={stop}
          modelLabel={modelLabel}
        />
      )}
    </div>
  );
}
