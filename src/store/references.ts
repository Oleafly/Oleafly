import { create } from "zustand";

export type ReferenceQueryMode = "references" | "definitions";

export interface ReferenceLocation {
  path: string;
  from: number;
  to: number;
  line: number;
  column: number;
  preview: string;
}

export interface ReferenceQuery {
  projectId: string;
  projectRevision: number;
  requestGeneration: number;
  mode: ReferenceQueryMode;
  targetId: string;
  title: string;
  locations?: readonly ReferenceLocation[];
}

interface ReferencesStore {
  query: ReferenceQuery | null;
  focusRequest: number;
  show: (query: ReferenceQuery) => void;
  clear: () => void;
}

export const useReferencesStore = create<ReferencesStore>((set) => ({
  query: null,
  focusRequest: 0,
  show: (query) =>
    set((state) => ({
      query,
      focusRequest: state.focusRequest + 1,
    })),
  clear: () =>
    set((state) => ({
      query: null,
      focusRequest: state.focusRequest + 1,
    })),
}));
