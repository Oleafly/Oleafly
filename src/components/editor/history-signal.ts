import { redoDepth, undoDepth } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { useSyncExternalStore } from "react";
import { createEmitter } from "@/lib/emitter";

export interface EditorHistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
}

const EMPTY: EditorHistoryAvailability = { canUndo: false, canRedo: false };

function historyStore() {
  let current = EMPTY;
  const changed = createEmitter();
  return {
    get: () => current,
    subscribe: changed.subscribe,
    publish(next: EditorHistoryAvailability) {
      if (next.canUndo === current.canUndo && next.canRedo === current.canRedo) return;
      current = next;
      changed.emit();
    },
  };
}

const sourceHistory = historyStore();
const visualHistory = historyStore();

function availabilityOf(state: EditorState): EditorHistoryAvailability {
  return { canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 };
}

export function historySignalExtension() {
  return ViewPlugin.define((view) => {
    sourceHistory.publish(availabilityOf(view.state));
    return {
      update(update) {
        if (update.transactions.length > 0) sourceHistory.publish(availabilityOf(update.state));
      },
    };
  });
}

export function publishVisualEditorHistory(next: EditorHistoryAvailability | null): void {
  visualHistory.publish(next ?? EMPTY);
}

export function useEditorHistory(visual = false): EditorHistoryAvailability {
  const store = visual ? visualHistory : sourceHistory;
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
