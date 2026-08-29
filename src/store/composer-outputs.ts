import { create } from "zustand";

// Why a store instead of props: ChatCore mounts through lazy boundaries and is
// shared with the project-view assistant pane, which never opens output
// panels. The composer variant publishes artifact opens here; the harness
// panel subscribes. The assistant pane simply never writes to it.
export interface ComposerFileOpen {
  path: string;
  reason: "read" | "write";
  /** Monotonic open epoch so viewers can refetch even for the same path. */
  at: number;
}

interface ComposerOutputsState {
  fileOpen: ComposerFileOpen | null;
  /** Bumped whenever a run produces a fresh compiled PDF worth showing. */
  pdfEpoch: number;
  openFile: (path: string, reason: ComposerFileOpen["reason"]) => void;
  openPdf: () => void;
}

let nextAt = 0;

export const useComposerOutputsStore = create<ComposerOutputsState>((set) => ({
  fileOpen: null,
  pdfEpoch: 0,
  openFile: (path, reason) =>
    set({ fileOpen: { path, reason, at: ++nextAt } }),
  openPdf: () => set((s) => ({ pdfEpoch: s.pdfEpoch + 1 })),
}));
