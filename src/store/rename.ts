import { create } from "zustand";
import type { Sym } from "@/lib/index/types";

interface RenameStore {
  sym: Sym | null;
  open: (sym: Sym) => void;
  close: () => void;
}

export const useRenameStore = create<RenameStore>((set) => ({
  sym: null,
  open: (sym) => set({ sym }),
  close: () => set({ sym: null }),
}));
