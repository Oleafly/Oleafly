// Re-exports @openleaf/preview's controller to keep existing imports working, and
// wires its diagnostics logger to the app error log.
import { setPdfLogger } from "@openleaf/preview";
import { logError } from "@/lib/log";

setPdfLogger((scope, message) => void logError(scope, message));

export { registerPdfView, clearPdfView, gotoRect, pageClickToBp } from "@openleaf/preview";
