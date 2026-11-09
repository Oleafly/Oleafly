import { useEffect } from "react";
import { NOTE_WIDTH_KEY, NOTE_WIDTHS, normalizeNotesSetting, type NoteWidth } from "@/lib/notes-appearance";
import { useSettingsStore } from "@/store/settings";
import { storedValue } from "./note-storage";

export { NOTE_WIDTH_KEY, NOTE_WIDTHS, type NoteWidth };
export const PROMPT_COLLAPSED_KEY = "oleafly.notes.promptCollapsed";

const promptCollapsed = storedValue(PROMPT_COLLAPSED_KEY, (raw) => raw === "true", String);

export function readNoteWidth(): NoteWidth {
  return useSettingsStore.getState().notesWidth;
}

export function saveNoteWidth(width: NoteWidth): void {
  useSettingsStore.getState().setNotesAppearance("notesWidth", width);
}

function followStoredWidth(event: StorageEvent): void {
  if (event.key !== null && event.key !== NOTE_WIDTH_KEY) return;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(NOTE_WIDTH_KEY);
  } catch {
    return;
  }
  const width = normalizeNotesSetting("notesWidth", stored);
  if (useSettingsStore.getState().notesWidth !== width) useSettingsStore.setState({ notesWidth: width });
}

export function useNoteWidth(): NoteWidth {
  useEffect(() => {
    window.addEventListener("storage", followStoredWidth);
    return () => window.removeEventListener("storage", followStoredWidth);
  }, []);
  return useSettingsStore((state) => state.notesWidth);
}

export function readPromptCollapsed(): boolean {
  return promptCollapsed.read();
}

export function savePromptCollapsed(collapsed: boolean): void {
  promptCollapsed.write(collapsed);
}
