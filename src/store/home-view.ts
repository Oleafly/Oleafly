import { create } from "zustand";

export type HomePage = "library" | "pdf-import" | "equation" | "bibtex" | "table" | "lab-search";

export const useHomeViewStore = create<{
  page: HomePage;
  goTo: (page: HomePage) => void;
  deadlinesOpen: boolean;
  toolsOpen: boolean;
  openDeadlines: () => void;
  openTools: () => void;
  closeDeadlines: () => void;
  closeTools: () => void;
}>((set) => ({
  page: "library",
  goTo: (page) => set({ page }),
  deadlinesOpen: false,
  toolsOpen: false,
  openDeadlines: () => set({ deadlinesOpen: true, toolsOpen: false }),
  openTools: () => set({ toolsOpen: true, deadlinesOpen: false }),
  closeDeadlines: () => set({ deadlinesOpen: false }),
  closeTools: () => set({ toolsOpen: false }),
}));
