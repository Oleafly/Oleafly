import { create } from "zustand";

/** Controls the Add-citation dialog. */
interface CitationStore {
  open: boolean;
  setOpen: (v: boolean) => void;
}

export const useCitationStore = create<CitationStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
