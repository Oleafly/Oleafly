import { create } from "zustand";

interface DocumentCitationUiState {
  modeRequest: "search" | "document";
  selectionOverride: string | null;
  requestDocumentScan: (selection?: string) => void;
  consumeSelectionOverride: () => string | null;
}

export const useDocumentCitationUiStore = create<DocumentCitationUiState>(
  (set, get) => ({
    modeRequest: "search",
    selectionOverride: null,
    requestDocumentScan: (selection) =>
      set({
        modeRequest: "document",
        selectionOverride: selection?.trim() ? selection : null,
      }),
    consumeSelectionOverride: () => {
      const value = get().selectionOverride;
      set({ selectionOverride: null });
      return value;
    },
  }),
);
