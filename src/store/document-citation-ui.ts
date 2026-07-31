import { create } from "zustand";

interface DocumentCitationUiState {
  modeRequest: "search" | "document";
  selectionOverride: string | null;
  /** Snapshot of project .bib contents captured before closeProject (command palette path). */
  bibOverride: string | null;
  requestDocumentScan: (
    selection?: string,
    bibOverride?: string | null,
  ) => void;
  consumeSelectionOverride: () => string | null;
  consumeBibOverride: () => string | null;
}

export const useDocumentCitationUiStore = create<DocumentCitationUiState>(
  (set, get) => ({
    modeRequest: "search",
    selectionOverride: null,
    bibOverride: null,
    requestDocumentScan: (selection, bibOverride) =>
      set({
        modeRequest: "document",
        selectionOverride: selection?.trim() ? selection : null,
        bibOverride:
          typeof bibOverride === "string" && bibOverride.trim()
            ? bibOverride
            : null,
      }),
    consumeSelectionOverride: () => {
      const value = get().selectionOverride;
      set({ selectionOverride: null });
      return value;
    },
    consumeBibOverride: () => {
      const value = get().bibOverride;
      set({ bibOverride: null });
      return value;
    },
  }),
);
