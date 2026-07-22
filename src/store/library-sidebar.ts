import { create } from "zustand";

const COLLAPSE_KEY = "oleafly.librarySidebarCollapsed";

// Shared across every home-shell surface (library, deadlines, converter,
// LaTeX tools) so each view's toggle drives the one sidebar.
export const useLibrarySidebarStore = create<{
  collapsed: boolean;
  toggle: () => void;
}>((set) => ({
  collapsed: localStorage.getItem(COLLAPSE_KEY) === "1",
  toggle: () =>
    set((s) => {
      const collapsed = !s.collapsed;
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
      return { collapsed };
    }),
}));
