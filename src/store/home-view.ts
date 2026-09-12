import { create } from "zustand";
import type { ConverterToolId } from "@/lib/converter-types";

export type HomePage =
  | "library"
  | "tools"
  | "converter"
  | "pdf-import"
  | "equation"
  | "bibtex"
  | "table"
  | "lab-search"
  | "literature-search"
  | "deadlines"
  | "diagram-composer"
  | "stats"
  | "generators"
  | "symbols";

export const useHomeViewStore = create<{
  page: HomePage;
  goTo: (page: HomePage) => void;
  activeConverter: ConverterToolId | null;
  openConverter: (converter: ConverterToolId) => void;
  queuedPageAfterProjectClose: HomePage | null;
  queuePageAfterProjectClose: (page: HomePage) => void;
  clearQueuedPageAfterProjectClose: () => void;
  consumeQueuedPageAfterProjectClose: () => HomePage | null;
}>((set, get) => ({
  page: "library",
  goTo: (page) => set({ page }),
  activeConverter: null,
  openConverter: (activeConverter) => set({ activeConverter, page: "converter" }),
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
}));
