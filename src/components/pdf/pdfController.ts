// Thin app shim over @openleaf/preview's controller: keeps existing imports
// working and wires the package's diagnostics to the app error log.
import { setPdfLogger } from "@openleaf/preview";
import { logError } from "@/lib/log";

setPdfLogger((scope, message) => void logError(scope, message));

export { registerPdfView, clearPdfView, gotoRect, pageClickToBp } from "@openleaf/preview";
