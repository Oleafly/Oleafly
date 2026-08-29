import { create } from "zustand";

export interface AssistantFileOpen {
  path: string;
  reason: "read" | "write";
  /** Monotonic open epoch so viewers can refetch even for the same path. */
  at: number;
}

interface AssistantOutputsState {
  fileOpen: AssistantFileOpen | null;
  /** Bumped whenever a run produces a fresh compiled PDF worth showing. */
  pdfEpoch: number;
  openFile: (path: string, reason: AssistantFileOpen["reason"]) => void;
  openPdf: () => void;
}

let nextAt = 0;

export const useAssistantOutputsStore = create<AssistantOutputsState>((set) => ({
  fileOpen: null,
  pdfEpoch: 0,
  openFile: (path, reason) =>
    set({ fileOpen: { path, reason, at: ++nextAt } }),
  openPdf: () => set((s) => ({ pdfEpoch: s.pdfEpoch + 1 })),
}));
