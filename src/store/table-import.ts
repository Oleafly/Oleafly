import { create } from "zustand";

interface TableImportState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useTableImportStore = create<TableImportState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
