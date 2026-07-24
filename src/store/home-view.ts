import { create } from "zustand";

export type HomePage =
  | "library"
  | "pdf-import"
  | "equation"
  | "bibtex"
  | "table"
  | "lab-search"
  | "deadlines"
  | "diagram-composer";

export const useHomeViewStore = create<{
  page: HomePage;
  goTo: (page: HomePage) => void;
  toolsOpen: boolean;
  openTools: () => void;
  closeTools: () => void;
}>((set) => ({
  page: "library",
  goTo: (page) => set({ page }),
  toolsOpen: false,
  openTools: () => set({ toolsOpen: true }),
  closeTools: () => set({ toolsOpen: false }),
}));
