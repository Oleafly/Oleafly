import { create } from "zustand";

export const useNotesViewStore = create<{
  requestedNoteId: string | null;
  requestedFragment: string | null;
  request: (noteId: string | null, fragment?: string | null) => void;
  take: () => string | null;
}>((set, get) => ({
  requestedNoteId: null,
  requestedFragment: null,
  request: (requestedNoteId, fragment = null) => set({ requestedNoteId, requestedFragment: requestedNoteId ? fragment : null }),
  take: () => {
    const id = get().requestedNoteId;
    if (id !== null) set({ requestedNoteId: null, requestedFragment: null });
    return id;
  },
}));
