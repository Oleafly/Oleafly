import { useEffect } from "react";
import { logError } from "@/lib/log";
import { useAcpSessionsStore, type AcpSelection } from "@/store/acp-sessions";
import { quoteSelection } from "./acp-attachments";

const settled = new Map<string, string>();

function keyOf(selection: Pick<AcpSelection, "path" | "label" | "text">): string {
  return `${selection.path ?? ""}\u0000${selection.label}\u0000${selection.text}`;
}

export function syncSelectionQuote(projectId: string, selection: AcpSelection | null): void {
  const store = useAcpSessionsStore.getState();
  const current = store.composers[projectId]?.selections ?? [];
  if (!selection) {
    settled.delete(projectId);
    if (current.length > 0) store.setComposer(projectId, { selections: [] });
    return;
  }
  const key = keyOf(selection);
  if (key === settled.get(projectId)) {
    if (current.length > 0) store.setComposer(projectId, { selections: [] });
    return;
  }
  if (current.length === 1 && keyOf(current[0]) === key) return;
  store.setComposer(projectId, { selections: [selection] });
}

export function settleSelectionQuotes(projectId: string, selections: readonly AcpSelection[]): void {
  const last = selections.at(-1);
  if (last) settled.set(projectId, keyOf(last));
}

export function unsettleSelectionQuote(projectId: string): void {
  settled.delete(projectId);
}

export function useSelectionQuote(projectId: string): void {
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const sync = () => {
      frame = 0;
      void quoteSelection()
        .then((selection) => {
          if (!disposed) syncSelectionQuote(projectId, selection);
        })
        .catch((error: unknown) => logError("quote the editor selection", error));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(sync);
    };
    schedule();
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("mouseup", schedule);
    window.addEventListener("keyup", schedule);
    return () => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("mouseup", schedule);
      window.removeEventListener("keyup", schedule);
    };
  }, [projectId]);
}
