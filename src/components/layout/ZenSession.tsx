import { useEffect } from "react";
import { modalCoordinator } from "@oleafly/templates/modal-coordinator";
import { getEditorView } from "@/components/editor/cm/controller";
import { exitZenMode } from "@/lib/zen-mode";
import { useCompileStore } from "@/store/compile";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";

const DOUBLE_ESCAPE_MS = 500;
const OVERLAY_OPEN =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .cm-tooltip-autocomplete';

function escapeIsClaimed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || modalCoordinator.size() > 0) return true;
  if (document.querySelector(OVERLAY_OPEN)) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".xterm")) return true;
  return useSettingsStore.getState().vim && Boolean(target?.closest(".cm-editor"));
}

function useDoubleEscape(): void {
  useEffect(() => {
    let lastEscape = Number.NEGATIVE_INFINITY;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.repeat || event.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      if (escapeIsClaimed(event)) {
        lastEscape = Number.NEGATIVE_INFINITY;
        return;
      }
      const now = Date.now();
      if (now - lastEscape <= DOUBLE_ESCAPE_MS) {
        lastEscape = Number.NEGATIVE_INFINITY;
        exitZenMode();
        return;
      }
      lastEscape = now;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useCompileFeedback(): void {
  useEffect(() => {
    let previous = useCompileStore.getState().status;
    return useCompileStore.subscribe((state) => {
      const was = previous;
      previous = state.status;
      if (state.status === was) return;
      if (state.status === "success") useZenStore.getState().setLogsOpen(false);
    });
  }, []);
}

function useFocusEditor(): void {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      getEditorView()?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

export function ZenSession() {
  useFocusEditor();
  useDoubleEscape();
  useCompileFeedback();
  return null;
}
