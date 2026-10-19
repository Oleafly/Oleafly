// The CLI agent composer quotes what is selected in the editor: one quote for
// the current selection, replaced when the selection changes and dropped when
// it is cleared. A selection that was sent, or whose quote was removed, is not
// quoted again until the selection changes.

import { useEffect } from "react";
import { logError } from "@/lib/log";
import { useAcpSessionsStore, type AcpSelection } from "@/store/acp-sessions";
import { quoteSelection } from "./acp-attachments";

/** Per project, the selection already sent or set aside. */
const settled = new Map<string, string>();

function keyOf(selection: Pick<AcpSelection, "path" | "label" | "text">): string {
  return `${selection.path ?? ""}\u0000${selection.label}\u0000${selection.text}`;
}

/** Makes `selection` (null when nothing is selected) the composer's quote. */
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

/** The quotes were sent or removed: they stay out until the selection changes. */
export function settleSelectionQuotes(projectId: string, selections: readonly AcpSelection[]): void {
  const last = selections.at(-1);
  if (last) settled.set(projectId, keyOf(last));
}

/** A failed send put its quote back: the selection may be quoted again. */
export function unsettleSelectionQuote(projectId: string): void {
  settled.delete(projectId);
}

/** Keeps the composer's quote in step with the editor's selection while it is shown. */
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
