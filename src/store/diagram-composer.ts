import { create } from "zustand";

export type DiagramComposerLanguage = "tikz" | "typst" | "mermaid";

export const DIAGRAM_COMPOSER_LANGUAGES: readonly DiagramComposerLanguage[] = ["tikz", "typst", "mermaid"];

interface DiagramComposerState {
  language: DiagramComposerLanguage;
  requestId: number;
  chooserOpen: boolean;
  requestLanguage: (language: DiagramComposerLanguage) => void;
  setChooserOpen: (open: boolean) => void;
}

export const useDiagramComposerStore = create<DiagramComposerState>((set) => ({
  language: "tikz",
  requestId: 0,
  chooserOpen: false,
  requestLanguage: (language) => set((state) => ({ language, requestId: state.requestId + 1 })),
  setChooserOpen: (chooserOpen) => set({ chooserOpen }),
}));
