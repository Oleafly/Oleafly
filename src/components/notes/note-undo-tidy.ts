import { useSettingsStore } from "@/store/settings";
import { indexedUndoStore } from "./note-undo-store";

export function startKeptUndoTidy(): Promise<() => void> {
  void (useSettingsStore.getState().notesKeepUndo ? indexedUndoStore.sweep() : indexedUndoStore.clear());
  return Promise.resolve(
    useSettingsStore.subscribe((state, previous) => {
      if (previous.notesKeepUndo && !state.notesKeepUndo) void indexedUndoStore.clear();
    }),
  );
}
