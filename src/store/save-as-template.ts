import { create } from "zustand";

export interface SaveAsTemplateTarget {
  readonly projectId: string;
  readonly name: string;
}

interface SaveAsTemplateState {
  target: SaveAsTemplateTarget | null;
  openFor(projectId: string, name: string): void;
  close(): void;
}

/** Which project the Save as template dialog is open for, from any menu. */
export const useSaveAsTemplateStore = create<SaveAsTemplateState>((set) => ({
  target: null,
  openFor: (projectId, name) => set({ target: { projectId, name } }),
  close: () => set({ target: null }),
}));
