import { create } from "zustand";

export type TypstDocumentPanel = "insights" | "settings";

interface TypstDocumentPanelState {
  panel: TypstDocumentPanel | null;
  openPanel: (panel: TypstDocumentPanel) => void;
  closePanel: () => void;
}

export const useTypstDocumentPanelStore = create<TypstDocumentPanelState>((set) => ({
  panel: null,
  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
}));
