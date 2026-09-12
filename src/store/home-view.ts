import { create } from "zustand";
import type { ConverterToolId } from "@/lib/converter-types";
import type { ReferenceToolId } from "@/lib/reference-tools";

export type HomePage =
  | "library"
  | "tools"
  | "converter"
  | "reference"
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
  activeReferenceTool: ReferenceToolId | null;
  openReferenceTool: (tool: ReferenceToolId) => void;
  queuedPageAfterProjectClose: HomePage | null;
  queuePageAfterProjectClose: (page: HomePage) => void;
  clearQueuedPageAfterProjectClose: () => void;
  consumeQueuedPageAfterProjectClose: () => HomePage | null;
}>((set, get) => ({
  page: "library",
  goTo: (page) => set({ page }),
  activeConverter: null,
  openConverter: (activeConverter) => set({ activeConverter, page: "converter" }),
  activeReferenceTool: null,
  openReferenceTool: (activeReferenceTool) => set({ activeReferenceTool, page: "reference" }),
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
