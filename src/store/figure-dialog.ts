import { create } from "zustand";

interface FigureDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useFigureDialogStore = create<FigureDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
