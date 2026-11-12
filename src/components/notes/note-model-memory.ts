import type { AssistantScopeModelMemory } from "@/components/ai/scope-model-memory";
import { useNotesPrefsStore } from "@/store/notes-prefs";

export function noteModelMemory(noteId: string): AssistantScopeModelMemory {
  return {
    read: () => {
      const { models } = useNotesPrefsStore.getState();
      return models.notes[noteId] ?? models.last;
    },
    save: (choice) => useNotesPrefsStore.getState().rememberModel(noteId, choice),
  };
}
