import { create } from "zustand";

export type HomePage = "library" | "pdf-import" | "deadlines" | "latex-tools";

// Single source of truth for which home-shell page is showing, so the sidebar
// can switch between Library/PDF-to-LaTeX/Deadlines/LaTeX-Tools directly
// instead of each view independently opening/closing as its own overlay.
export const useHomeViewStore = create<{
  page: HomePage;
  goTo: (page: HomePage) => void;
}>((set) => ({
  page: "library",
  goTo: (page) => set({ page }),
}));
