import { useRef, type RefObject } from "react";
import type { PdfLoadState, PdfViewerHandle } from "@/components/pdf/PdfViewer";

function readPage(projectId: string | null): number {
  try {
    const page = Number(localStorage.getItem(`oleafly.pdf.page.${projectId}`));
    return Number.isSafeInteger(page) && page > 0 ? page : 1;
  } catch { return 1; }
}

interface ScrollOffset {
  readonly top: number;
  readonly left: number;
}

/** Ignore the viewer's initial page-one report while restoring the saved page. */
export function usePdfPosition(
  projectId: string | null,
  viewer: RefObject<PdfViewerHandle | null>,
  scrollBox?: RefObject<HTMLElement | null>,
  keepOffset = false,
) {
  const position = useRef<{ projectId: string | null; page: number; ready: boolean; offset: ScrollOffset | null }>({
    projectId,
    page: readPage(projectId),
    ready: false,
    offset: null,
  });
  if (position.current.projectId !== projectId) {
    position.current = { projectId, page: readPage(projectId), ready: false, offset: null };
  }
  return {
    onLoad(state: PdfLoadState) {
      if (state.status === "loading") {
        const box = scrollBox?.current;
        if (keepOffset && box && position.current.ready) {
          position.current.offset = { top: box.scrollTop, left: box.scrollLeft };
        }
        position.current.ready = false;
      }
      if (state.status === "ready") {
        const offset = position.current.offset;
        const box = scrollBox?.current;
        position.current.ready = true;
        position.current.offset = null;
        if (keepOffset && offset && box) {
          box.scrollTop = offset.top;
          box.scrollLeft = offset.left;
          return;
        }
        viewer.current?.gotoPage(position.current.page);
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
