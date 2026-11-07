import { create } from "zustand";

export const useNotesViewStore = create<{
  requestedNoteId: string | null;
  request: (noteId: string | null) => void;
  take: () => string | null;
}>((set, get) => ({
  requestedNoteId: null,
  request: (requestedNoteId) => set({ requestedNoteId }),
  take: () => {
    const id = get().requestedNoteId;
    if (id !== null) set({ requestedNoteId: null });
    return id;
  },
}));
