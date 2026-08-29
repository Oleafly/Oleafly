import { create } from "zustand";

export type HomePage =
  | "library"
  | "pdf-import"
  | "equation"
  | "bibtex"
  | "table"
  | "lab-search"
  | "literature-search"
  | "deadlines"
  | "diagram-composer"
  | "agentic-harness";

export const useHomeViewStore = create<{
  page: HomePage;
  goTo: (page: HomePage) => void;
  queuedPageAfterProjectClose: HomePage | null;
  queuePageAfterProjectClose: (page: HomePage) => void;
  clearQueuedPageAfterProjectClose: () => void;
  consumeQueuedPageAfterProjectClose: () => HomePage | null;
  toolsOpen: boolean;
  openTools: () => void;
  closeTools: () => void;
}>((set, get) => ({
  page: "library",
  goTo: (page) => set({ page }),
  queuedPageAfterProjectClose: null,
  queuePageAfterProjectClose: (page) =>
    set({ queuedPageAfterProjectClose: page }),
  clearQueuedPageAfterProjectClose: () =>
    set({ queuedPageAfterProjectClose: null }),
  consumeQueuedPageAfterProjectClose: () => {
    const page = get().queuedPageAfterProjectClose;
    set({ queuedPageAfterProjectClose: null });
    return page;
  },
  toolsOpen: false,
  openTools: () => set({ toolsOpen: true }),
  closeTools: () => set({ toolsOpen: false }),
}));
