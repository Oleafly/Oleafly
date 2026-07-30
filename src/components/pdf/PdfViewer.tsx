import { forwardRef, lazy, Suspense } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import type {
  PdfViewerHandle,
  PdfViewerProps,
  PdfLayout,
  PdfRotation,
  PdfLoadState,
  PdfSearchState,
  PdfOutlineState,
  PdfOutlineItem,
} from "@oleafly/preview";
import { safePdfExternalUrl } from "@oleafly/preview/controller";
// Ensure the package's SyncTeX diagnostics logger is installed.
import "@/components/pdf/pdfController";

export type {
  PdfViewerHandle,
  PdfLayout,
  PdfRotation,
  PdfLoadState,
  PdfSearchState,
  PdfOutlineState,
  PdfOutlineItem,
};

const PdfViewerCore = lazy(() =>
  import("@oleafly/preview").then((module) => ({
    default: module.PdfViewer,
  })),
);

export const PdfViewer = forwardRef<PdfViewerHandle, Omit<PdfViewerProps, "onOpenLink">>(
  function PdfViewer(props, ref) {
    return (
      <Suspense
        fallback={
          <div
            className="flex min-h-48 items-center justify-center p-6 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            Loading PDF viewer…
          </div>
        }
      >
        <PdfViewerCore
          ref={ref}
          {...props}
          onOpenLink={(url) => {
            const safeUrl = safePdfExternalUrl(url);
            if (safeUrl) void openUrl(safeUrl);
          }}
        />
      </Suspense>
    );
  },
);
