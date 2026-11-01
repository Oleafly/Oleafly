import { create } from "zustand";

interface PdfViewState {
  page: number;
  setPage: (page: number) => void;
}

export const usePdfViewStore = create<PdfViewState>((set) => ({
  page: 1,
  setPage: (page) => set({ page }),
}));
