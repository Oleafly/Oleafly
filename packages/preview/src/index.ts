/**
 * @openleaf/preview — virtualized pdf.js viewer + SyncTeX page controller.
 * The host app injects link opening (onOpenLink) and logging (setPdfLogger);
 * no store, Tauri, or app-UI imports.
 */
export {
  PdfViewer,
  type PdfViewerHandle,
  type PdfViewerProps,
  type PdfLayout,
} from "./PdfViewer";
export {
  registerPdfView,
  clearPdfView,
  gotoRect,
  pageClickToBp,
  setPdfLogger,
  type SynctexRect,
} from "./pdfController";
