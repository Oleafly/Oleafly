import type { NoteWidth } from "@/lib/notes-appearance";
import { useSettingsStore } from "@/store/settings";

export { NOTE_WIDTH_KEY, NOTE_WIDTHS, type NoteWidth } from "@/lib/notes-appearance";

export function saveNoteWidth(width: NoteWidth): void {
  useSettingsStore.getState().setNotesAppearance("notesWidth", width);
}

export function useNoteWidth(): NoteWidth {
  return useSettingsStore((state) => state.notesWidth);
}
