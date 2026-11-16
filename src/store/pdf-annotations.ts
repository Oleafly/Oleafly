import { create } from "zustand";
import {
  pdfAnnotationsAdd,
  pdfAnnotationsDelete,
  pdfAnnotationsList,
  pdfAnnotationsUpdate,
  type NewPdfAnnotation,
  type PdfAnnotation,
  type PdfAnnotationUpdate,
} from "@/lib/tauri";
import { logError } from "@/lib/log";

interface PdfAnnotationsState {
  projectId: string | null;
  items: PdfAnnotation[];
  loaded: boolean;
  activeId: string | null;
  error: string | null;
  load: (projectId: string | null) => Promise<void>;
  add: (input: NewPdfAnnotation) => Promise<PdfAnnotation | null>;
  update: (updates: readonly PdfAnnotationUpdate[]) => Promise<boolean>;
  remove: (ids: readonly string[]) => Promise<boolean>;
  setActive: (id: string | null) => void;
  clearError: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const usePdfAnnotationsStore = create<PdfAnnotationsState>((set, get) => {
  const fail = (action: string, error: unknown) => {
    void logError(action, error);
    set({ error: message(error) });
  };
  const current = (projectId: string) => get().projectId === projectId;

  return {
    projectId: null,
    items: [],
    loaded: false,
    activeId: null,
    error: null,
    load: async (projectId) => {
      if (get().projectId === projectId) return;
      set({ projectId, items: [], loaded: false, activeId: null, error: null });
      if (!projectId) return;
      try {
        const items = await pdfAnnotationsList(projectId);
        if (current(projectId)) set({ items, loaded: true });
      } catch (error) {
        if (current(projectId)) fail("load PDF annotations", error);
      }
    },
    add: async (input) => {
      const { projectId } = get();
      if (!projectId) return null;
      try {
        const added = await pdfAnnotationsAdd(projectId, input);
        if (!current(projectId)) return null;
        set((state) => ({ items: [...state.items, added], activeId: added.id, error: null }));
        return added;
      } catch (error) {
        if (current(projectId)) fail("save a PDF annotation", error);
        return null;
      }
    },
    update: async (updates) => {
      const { projectId } = get();
      if (!projectId || updates.length === 0) return false;
      try {
        const items = await pdfAnnotationsUpdate(projectId, [...updates]);
        if (current(projectId)) set({ items, error: null });
        return true;
      } catch (error) {
        if (current(projectId)) fail("update PDF annotations", error);
        return false;
      }
    },
    remove: async (ids) => {
      const { projectId } = get();
      if (!projectId || ids.length === 0) return false;
      try {
        const items = await pdfAnnotationsDelete(projectId, [...ids]);
        if (!current(projectId)) return false;
        set((state) => ({
          items,
          error: null,
          activeId: state.activeId && ids.includes(state.activeId) ? null : state.activeId,
        }));
        return true;
      } catch (error) {
        if (current(projectId)) fail("delete PDF annotations", error);
        return false;
      }
    },
    setActive: (activeId) => set({ activeId }),
    clearError: () => set({ error: null }),
  };
});
