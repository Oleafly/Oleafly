import { create } from "zustand";
import type { Sym } from "@/lib/index/types";

interface ReferencesStore {
  title: string;
  results: Sym[];
  show: (title: string, results: Sym[]) => void;
  clear: () => void;
}

export const useReferencesStore = create<ReferencesStore>((set) => ({
  title: "",
  results: [],
  show: (title, results) => set({ title, results }),
  clear: () => set({ title: "", results: [] }),
}));
