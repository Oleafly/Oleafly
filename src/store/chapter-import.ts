import { create } from "zustand";

interface ChapterImportState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useChapterImportStore = create<ChapterImportState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
