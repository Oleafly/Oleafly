import { create } from "zustand";

/**
 * The page the user is currently looking at in the PDF preview. Kept in a tiny
 * store (not just PreviewPane local state) so non-React consumers can read it,
 * notably the AI `verify_pdf_pages` tool, which prefers the page under the
 * user's eye when choosing which pages to rasterize for a vision check.
 */
interface PdfViewState {
  page: number;
  setPage: (page: number) => void;
}

export const usePdfViewStore = create<PdfViewState>((set) => ({
  page: 1,
  setPage: (page) => set({ page }),
}));
