import { create } from "zustand";
import { describeError } from "@/lib/app-error";
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
import { toast } from "@/lib/toast";

interface PdfAnnotationsState {
  projectId: string | null;
  items: PdfAnnotation[];
  loaded: boolean;
  readOnly: boolean;
  setAside: boolean;
  activeId: string | null;
  error: string | null;
  load: (projectId: string | null) => Promise<void>;
  add: (input: NewPdfAnnotation) => Promise<PdfAnnotation | null>;
  update: (updates: readonly PdfAnnotationUpdate[], options?: { quiet?: boolean }) => Promise<boolean>;
  remove: (ids: readonly string[]) => Promise<boolean>;
  setActive: (id: string | null) => void;
}

export const usePdfAnnotationsStore = create<PdfAnnotationsState>((set, get) => {
  const fail = (action: string, error: unknown, quiet = false) => {
    void logError(action, error);
    const text = describeError(error);
    set({ error: text });
    if (!quiet) toast.errorUnique("pdf-annotations", text);
  };
  const current = (projectId: string) => get().projectId === projectId;
  const writable = () => {
    const { projectId, loaded, readOnly } = get();
    return projectId && loaded && !readOnly ? projectId : null;
  };

  return {
    projectId: null,
    items: [],
    loaded: false,
    readOnly: false,
    setAside: false,
    activeId: null,
    error: null,
    load: async (projectId) => {
      if (get().projectId === projectId && (get().loaded || !projectId)) return;
      set({ projectId, items: [], loaded: false, readOnly: false, setAside: false, activeId: null, error: null });
      if (!projectId) return;
      try {
        const listed = await pdfAnnotationsList(projectId);
        if (current(projectId)) {
          set({ items: listed.items, readOnly: listed.readOnly, setAside: listed.setAside, loaded: true });
        }
      } catch (error) {
        if (current(projectId)) fail("load PDF annotations", error, true);
      }
    },
    add: async (input) => {
      const projectId = writable();
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
    update: async (updates, options) => {
      const projectId = writable();
      if (!projectId || updates.length === 0) return false;
      try {
        const items = await pdfAnnotationsUpdate(projectId, [...updates]);
        if (current(projectId)) set({ items, error: null });
        return true;
      } catch (error) {
        if (current(projectId)) fail("update PDF annotations", error, options?.quiet);
        return false;
      }
    },
    remove: async (ids) => {
      const projectId = writable();
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
  };
});
