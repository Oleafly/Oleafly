import { create } from "zustand";

interface CitationStore {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useCitationStore = create<CitationStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
