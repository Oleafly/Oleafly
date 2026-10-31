import { setPdfLogger } from "@oleafly/preview/controller";
import { logError } from "@/lib/log";

setPdfLogger((scope, message) => void logError(scope, message));

export {
  registerPdfView,
  clearPdfView,
  gotoRect,
  gotoPdfPage,
  pageClickToBp,
  pdfPageText,
  type PdfTextRun,
} from "@oleafly/preview/controller";
