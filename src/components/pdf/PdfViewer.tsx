import { forwardRef } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  PdfViewer as PdfViewerCore,
  type PdfViewerHandle,
  type PdfViewerProps,
  type PdfLayout,
} from "@oleafly/preview";
// Ensure the package's SyncTeX diagnostics logger is installed.
import "@/components/pdf/pdfController";

export type { PdfViewerHandle, PdfLayout };

export const PdfViewer = forwardRef<PdfViewerHandle, Omit<PdfViewerProps, "onOpenLink">>(
  function PdfViewer(props, ref) {
    return <PdfViewerCore ref={ref} {...props} onOpenLink={(url) => void openUrl(url)} />;
  },
);
