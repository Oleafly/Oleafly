import { useRef, type RefObject } from "react";
import type { PdfLoadState, PdfViewerHandle } from "@/components/pdf/PdfViewer";

function readPage(projectId: string | null): number {
  try {
    const page = Number(localStorage.getItem(`oleafly.pdf.page.${projectId}`));
    return Number.isSafeInteger(page) && page > 0 ? page : 1;
  } catch { return 1; }
}

/** Ignore the viewer's initial page-one report while restoring the saved page. */
export function usePdfPosition(projectId: string | null, viewer: RefObject<PdfViewerHandle | null>) {
  const position = useRef({ projectId, page: readPage(projectId), ready: false });
  if (position.current.projectId !== projectId) {
    position.current = { projectId, page: readPage(projectId), ready: false };
  }
  return {
    onLoad(state: PdfLoadState) {
      if (state.status === "loading") position.current.ready = false;
      if (state.status === "ready") {
        const page = position.current.page;
        position.current.ready = true;
        viewer.current?.gotoPage(page);
      }
    },
    onPage(page: number) {
      if (!projectId || !position.current.ready) return;
      position.current.page = page;
      try { localStorage.setItem(`oleafly.pdf.page.${projectId}`, String(page)); }
      catch { /* Storage is optional. */ }
    },
  };
}
