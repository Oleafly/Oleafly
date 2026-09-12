import { create } from "zustand";

interface CiteOleaflyState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useCiteOleaflyStore = create<CiteOleaflyState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
