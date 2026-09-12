import { forwardRef, lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import type { PdfViewerHandle, PdfViewerProps } from "@oleafly/preview";
import { safePdfExternalUrl } from "@oleafly/preview/controller";
// Ensure the package's SyncTeX diagnostics logger is installed.
import "@/components/pdf/pdfController";

export type { PdfViewerHandle };
export type {
  PdfLayout,
  PdfRotation,
  PdfLoadState,
  PdfSearchState,
  PdfOutlineState,
  PdfOutlineItem,
} from "@oleafly/preview";

const PdfViewerCore = lazy(() =>
  import("@oleafly/preview").then((module) => ({
    default: module.PdfViewer,
  })),
);

export const PdfViewer = forwardRef<PdfViewerHandle, Omit<PdfViewerProps, "onOpenLink" | "t">>(
  function PdfViewer(props, ref) {
    const { t } = useTranslation(["common", "editor", "preview"]);
    const packageT = useMemo<NonNullable<PdfViewerProps["t"]>>(
      () => (key, params) =>
        (t as unknown as (k: string, p?: Record<string, unknown>) => string)(
          `preview:package.${key}`,
          params,
        ),
      [t],
    );
    return (
      <Suspense
        fallback={
          <output
            className="flex min-h-48 items-center justify-center p-6 text-sm text-muted-foreground"
            aria-live="polite"
          >
            {t(($) => $.editor.preview.loading)}
          </output>
        }
      >
        <PdfViewerCore
          ref={ref}
          {...props}
          t={packageT}
          onOpenLink={(url) => {
            const safeUrl = safePdfExternalUrl(url);
            if (safeUrl) void openUrl(safeUrl);
          }}
        />
      </Suspense>
    );
  },
);
