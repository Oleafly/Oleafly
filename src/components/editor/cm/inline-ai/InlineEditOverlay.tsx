import { useEffect, useReducer, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
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
import { acceptInlineEdit, rejectInlineEdit } from "./plugin";
import { PromptPopover } from "./PromptPopover";
import { DiffActionBar, DiffErrorBar } from "./DiffActionBar";

function modelLabelFor(cfg: AIConfigLike): string {
  const { providerId, modelId } = pickActiveProvider(cfg);
  return getProvider(providerId)?.models.find((m) => m.id === modelId)?.name ?? modelId;
}

/**
 * Floating UI for the inline AI edit session: prompt popover, streaming state,
 * and the Accept/Reject/Retry bar. Positioned over the editor at the selection.
 * Rendered once as a sibling of the CodeMirror host.
 */
export function InlineEditOverlay() {
  const session = useInlineEditStore((s) => s.session);
  const [, forceTick] = useReducer((n: number) => n + 1, 0);
  const [providerReady, setProviderReady] = useState(true);
  const [modelLabel, setModelLabel] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Provider readiness + active model label, refreshed when AI settings change.
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

  // Abort any in-flight request whenever the session closes (Esc, ⌘L toggle,
  // click-outside, or accept/reject all clear it).
  useEffect(() => {
    if (!session) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [session]);

  // Reposition on scroll / resize while a session is open.
  useEffect(() => {
    if (!session) return;
    const view = getEditorView();
    const onMove = () => forceTick();
    window.addEventListener("resize", onMove);
    view?.scrollDOM.addEventListener("scroll", onMove);
    return () => {
      window.removeEventListener("resize", onMove);
      view?.scrollDOM.removeEventListener("scroll", onMove);
    };
  }, [session]);

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

  // Close the session, doing the right thing for the current phase.
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

  // Keyboard: Esc cancels/rejects; Enter accepts while reviewing.
  // Click outside the popover dismisses it the same way as Esc.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribes on each session change; handlers read the live store/view.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      } else if (e.key === "Enter" && useInlineEditStore.getState().session?.phase === "reviewing") {
        e.preventDefault();
        accept();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) dismiss();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [session]);

  if (!session) return null;
  const view = getEditorView();
  const coords = view?.coordsAtPos(session.from);
  if (!coords) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    top: coords.bottom + 4,
    left: coords.left,
    zIndex: 50,
    maxWidth: "calc(100vw - 16px)",
  };

  const openAiSettings = () => {
    reset();
    useSettingsStore.getState().setSettingsInitialSection("ai");
    useSettingsStore.getState().setSettingsOpen(true);
  };

  return (
    <div ref={containerRef} style={style}>
      {!providerReady ? (
        <div className="w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-4 text-primary" /> Set up an AI provider
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
        </div>
      ) : session.phase === "error" ? (
        <DiffErrorBar message={session.error ?? ""} onRetry={retry} onDismiss={reset} />
      ) : session.phase === "reviewing" ? (
        <DiffActionBar onAccept={accept} onReject={reject} onRetry={retry} />
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
