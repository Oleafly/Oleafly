import { create } from "zustand";

export type ReferenceQueryMode = "references" | "definitions";

/**
 * A references query is an identity, never a result cache. The panel resolves
 * `targetId` from the matching immutable project-intelligence snapshot. That
 * makes an edit or project switch invalidate results immediately instead of
 * leaving stale source locations on screen.
 */
export interface ReferenceQuery {
  projectId: string;
  projectRevision: number;
  requestGeneration: number;
  mode: ReferenceQueryMode;
  targetId: string;
  title: string;
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
