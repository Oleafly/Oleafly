import { create } from "zustand";

export const useLatexToolsStore = create<{
  open: boolean;
  openView: () => void;
  close: () => void;
}>((set) => ({
  open: false,
  openView: () => set({ open: true }),
  close: () => set({ open: false }),
}));
