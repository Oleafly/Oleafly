import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { PdfOutlinePanel } from "@/components/preview/PdfOutlinePanel";
import { PdfSearchBar } from "@/components/preview/PdfSearchBar";
import { PdfStateMessage } from "@/components/preview/PdfStateMessage";
import { PdfShowToolbarButton, PdfToolbarControls } from "@/components/preview/PdfToolbarControls";
import { PdfViewerOverlay } from "@/components/preview/PdfViewerOverlay";
import { usePdfReader } from "@/components/preview/use-pdf-reader";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { base64ToUint8Array, readFileBase64 } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";

interface LoadedPdf {
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export function PdfFileView({ projectId, path }: Readonly<{ projectId: string; path: string }>) {
  const { t } = useTranslation(["common", "editor", "preview"]);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const latestRead = useRef(0);
  const fittedIdentity = useRef("");

  const read = useCallback(() => {
    latestRead.current += 1;
    const request = latestRead.current;
    readFileBase64(projectId, path)
      .then((b64) => {
        if (request === latestRead.current) {
          setPdf({ bytes: base64ToUint8Array(b64), identity: `${projectId}\n${path}\n${request}` });
        }
      })
      .catch((error) => {
        if (request === latestRead.current) setErr(String(error));
      });
  }, [projectId, path]);

  useTauriEvent<{ projectId?: string; path?: string }>(
    "pdf-sync:written",
    (payload) => {
      if (payload?.projectId === projectId && payload.path === path) read();
    },
    isTauri(),
  );

  useEffect(() => {
    setPdf(null);
    setErr(null);
    read();
    return () => {
      latestRead.current += 1;
    };
  }, [read]);

  const reader = usePdfReader({ positionKey: `${projectId}:${path}`, hasDocument: pdf !== null, surfaceKey: pdf !== null });
  const { fitPreview, numPages, userAdjustedZoomRef } = reader;

  useEffect(() => {
    if (!pdf || numPages < 1 || fittedIdentity.current === pdf.identity || userAdjustedZoomRef.current) return;
    fittedIdentity.current = pdf.identity;
    const frame = requestAnimationFrame(() => {
      if (!userAdjustedZoomRef.current) fitPreview("width");
    });
    return () => cancelAnimationFrame(frame);
  }, [fitPreview, numPages, pdf, userAdjustedZoomRef]);

  if (err) {
    return (
      <div className="flex h-full items-center justify-center bg-sidebar p-6">
        <PdfStateMessage
          kind="error"
          title={t(($) => $.preview.viewer.loadFailedTitle)}
          detail={t(($) => $.editor.shell.pdfLoadFailed, { detail: err })}
          onRetry={() => {
            setErr(null);
            read();
          }}
        />
      </div>
    );
  }
  if (!pdf) return <div className="p-6 text-sm text-muted-foreground">{t(($) => $.common.state.loading)}</div>;

  const load = reader.pdfLoadState;
  const overlay = load.documentIdentity === pdf.identity && load.status !== "ready" && load.status !== "idle";

  return (
    <div
      ref={reader.rootRef}
      tabIndex={-1}
      data-testid="pdf-file-view"
      data-preview-page={reader.page}
      className="relative flex h-full min-h-0 flex-col bg-background"
    >
      {reader.isFs && reader.fsToolbarHidden && <PdfShowToolbarButton onShow={() => reader.setFsToolbarHidden(false)} />}
      <div
        className={cn(
          "flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 [&_button]:shrink-0",
          reader.isFs && reader.fsToolbarHidden && "hidden",
        )}
      >
        <PdfToolbarControls
          isImage={false}
          hasDocument
          numPages={reader.numPages}
          page={reader.page}
          pageInput={reader.pageInput}
          setPageInput={reader.setPageInput}
          jumpToPage={reader.jumpToPage}
          pdfRef={reader.pdfRef}
          layout={reader.layout}
          setLayout={reader.setLayout}
          outlineOpen={reader.outlineOpen}
          setOutlineOpen={reader.setOutlineOpen}
          searchOpen={reader.searchOpen}
          setSearchOpen={reader.setSearchOpen}
          searchInputRef={reader.searchInputRef}
          setSearchInput={reader.setSearchInput}
          scale={reader.scale}
          setScale={reader.setScale}
          setClampedScale={reader.setClampedScale}
          userZoom={reader.userZoom}
          fitPreview={reader.fitPreview}
          inverted={reader.inverted}
          setInverted={reader.setInverted}
          screenReaderMode={reader.screenReaderMode}
          setScreenReaderMode={reader.setScreenReaderMode}
          rotation={reader.rotation}
          rotationPending={reader.rotationPending}
          onRotate={reader.rotateClockwise}
          isFs={reader.isFs}
          setFsToolbarHidden={reader.setFsToolbarHidden}
          toggleFullscreen={reader.toggleFullscreen}
          onSettings={() => useSettingsStore.getState().openSettingsAt("appearance", "pdf")}
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-sidebar">
        <PdfOutlinePanel
          id="file-pdf-outline"
          open={reader.outlineOpen}
          state={reader.outlineState}
          pdfRef={reader.pdfRef}
          onClose={() => reader.setOutlineOpen(false)}
          itemStyle="tree"
        />
        {reader.searchOpen && (
          <PdfSearchBar
            id="file-pdf-search"
            inputRef={reader.searchInputRef}
            query={reader.searchInput}
            onQueryChange={reader.setSearchInput}
            state={reader.searchState}
            pdfRef={reader.pdfRef}
            onClose={() => {
              reader.setSearchOpen(false);
              reader.setSearchInput("");
            }}
          />
        )}
        <section
          ref={reader.scrollBoxRef}
          data-pdf-scroll-root
          data-select-all-scope
          aria-label={t(($) => $.preview.viewer.scrollArea)}
          className="isolate h-full overflow-auto focus-visible:bg-accent/20"
        >
          <PdfViewer
            key={pdf.identity}
            ref={reader.pdfRef}
            data={pdf.bytes}
            documentIdentity={pdf.identity}
            password={reader.pdfPassword || undefined}
            rotation={reader.rotation}
            scale={reader.scale}
            layout={reader.layout}
            screenReaderMode={reader.screenReaderMode}
            pageColors={reader.pdfPageColors}
            searchQuery={reader.searchOpen ? reader.deferredSearch : ""}
            onLoadStateChange={(next) => {
              if (next.documentIdentity === pdf.identity) reader.markLoadState(next);
            }}
            onSearchStateChange={reader.setSearchState}
            onOutlineStateChange={reader.setOutlineState}
            onPageChange={reader.markPage}
          />
        </section>
        {overlay && (
          <PdfViewerOverlay
            loadState={load}
            passwordDraft={reader.passwordDraft}
            onPasswordDraftChange={reader.setPasswordDraft}
            onSubmitPassword={() => reader.submitPassword(pdf.identity, t(($) => $.preview.window.unlocking))}
          >
            <PdfStateMessage
              kind={load.status === "loading" ? "loading" : "error"}
              title={
                load.status === "loading" ? t(($) => $.preview.window.loadingTitle) : t(($) => $.preview.viewer.loadFailedTitle)
              }
              detail={load.message ?? t(($) => $.preview.viewer.loadFailedDetail)}
              onRetry={load.status === "loading" ? undefined : read}
            />
          </PdfViewerOverlay>
        )}
      </div>
    </div>
  );
}
