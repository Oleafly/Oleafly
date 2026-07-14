import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Columns2, Contrast, FileText, Maximize, Minimize, PanelTopClose, PanelTopOpen, Play, RectangleVertical, Save, SquareArrowOutUpRight, X, XCircle, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { PdfViewer, type PdfViewerHandle, type PdfLayout } from "@/components/pdf/PdfViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LogPane } from "@/components/editor/LogPane";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePdfViewStore } from "@/store/pdf-view";
import { inverseFromClick } from "@/features/synctex";
import { saveFileBase64, uint8ToBase64 } from "@/lib/tauri";
import { openPreviewWindow } from "@/lib/preview-window";
import { notifyError, toast } from "@/lib/toast";
import { cn, shortcut } from "@/lib/utils";

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;

export function PreviewPane() {
  const status = useCompileStore((s) => s.status);
  const phase = useCompileStore((s) => s.phase);
  const pdfBytes = useCompileStore((s) => s.pdfBytes);
  const recompile = useCompileStore((s) => s.recompile);
  const errors = useCompileStore((s) => s.errors);
  const compileTimeMs = useCompileStore((s) => s.compileTimeMs);
  const lastCompiledAt = useCompileStore((s) => s.lastCompiledAt);
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshTree = useFilesStore((s) => s.refreshTree);
  const mainDoc = useFilesStore((s) => s.mainDoc);
  // Image projects render a single figure: no pages/spreads, and "PDF" reads
  // as "image" throughout the preview UI.
  const isImage = useFilesStore((s) => s.projectKind) === "image";
  const [scale, setScale] = useState(1.0);
  const [tab, setTab] = useState<"pdf" | "logs">("pdf");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [layout, setLayout] = useState<PdfLayout>("single");
  // Fullscreen the preview pane itself (toolbar + PDF), independent of the app.
  const [isFs, setIsFs] = useState(false);
  const [fsToolbarHidden, setFsToolbarHidden] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PdfViewerHandle>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Track fullscreen of the preview pane (only when the pane itself is the
  // fullscreen element), and reset the hidden-toolbar state when it exits.
  useEffect(() => {
    const onChange = () => {
      const fs = document.fullscreenElement === rootRef.current;
      setIsFs(fs);
      if (!fs) setFsToolbarHidden(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  // Trackpad pinch-to-zoom, scoped to the PDF scroll area only. Two webview
  // families report the gesture differently, so handle both and leave ordinary
  // two-finger scroll (no ctrlKey, no gesture events) alone.
  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

    // Chromium webviews (WebView2, WebKitGTK): pinch arrives as Ctrl+wheel.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale((s) => clamp(s * Math.exp(-e.deltaY * 0.01)));
    };

    // WebKit (macOS WKWebView, Tauri's default there): pinch fires non-standard
    // gesture events; `scale` is cumulative relative to gesturestart.
    let startScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      startScale = scaleRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const s = (e as unknown as { scale?: number }).scale;
      if (typeof s === "number" && s > 0) setScale(clamp(startScale * s));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    el.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart as EventListener);
      el.removeEventListener("gesturechange", onGestureChange as EventListener);
    };
  }, [pdfBytes, tab]);

  // Keep the jump box in sync with the page the viewer reports, unless it's being
  // edited (focused).
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  // No PDF, no page nav.
  useEffect(() => {
    if (!pdfBytes) {
      setNumPages(0);
      setPage(1);
    }
  }, [pdfBytes]);

  const jumpToPage = () => {
    const n = Number.parseInt(pageInput, 10);
    if (Number.isNaN(n) || n < 1 || n > numPages) {
      setPageInput(String(page)); // invalid: revert to the current page
      return;
    }
    if (n !== page) pdfRef.current?.gotoPage(n); // avoid snapping on an unchanged blur
  };

  const submitSavePdf = async () => {
    if (!projectId || !pdfBytes) return;
    setSaving(true);
    try {
      if (isImage) {
        const base = saveName.trim().replace(/\.(png|pdf)$/i, "") || "figure";
        const name = `${base}.png`;
        const { pdfPageToPng } = await import("@/lib/pdf-image");
        const dataUrl = await pdfPageToPng(pdfBytes, 1, 3);
        await saveFileBase64(projectId, name, dataUrl.slice(dataUrl.indexOf(",") + 1));
        await refreshTree();
        setSaveOpen(false);
        setSaveName("");
        toast.success("Image saved to the project.");
      } else {
        const raw = saveName.trim() || mainDoc.replace(/\.tex$/i, "") || "document";
        const name = raw.replace(/\.pdf$/i, "") + ".pdf";
        await saveFileBase64(projectId, name, uint8ToBase64(pdfBytes));
        await refreshTree();
        setSaveOpen(false);
        setSaveName("");
        toast.success("PDF saved to the project.");
      }
    } catch (e) {
      notifyError("save to project", e, "Couldn't save into the project.");
    } finally {
      setSaving(false);
    }
  };

  // When a build finishes, jump to the PDF if one was produced; only fall back
  // to logs on a genuine failure (no PDF). Non-fatal LaTeX warnings should NOT
  // hide a valid PDF.
  useEffect(() => {
    if (lastCompiledAt == null) return;
    setTab(useCompileStore.getState().pdfBytes ? "pdf" : "logs");
  }, [lastCompiledAt]);

  const compiling = status === "compiling";
  const hasError = status === "error" || errors.some((e) => e.kind === "error");
  const hasWarning = !hasError && errors.some((e) => e.kind === "warning");
  const severity: "error" | "warning" | "ok" = hasError ? "error" : hasWarning ? "warning" : "ok";

  return (
    <div ref={rootRef} className="relative flex h-full flex-col bg-background">
      {/* In fullscreen with the toolbar hidden, a small control to bring it back. */}
      {isFs && fsToolbarHidden && (
        <Tooltip label="Show toolbar">
          <button
            onClick={() => setFsToolbarHidden(false)}
            aria-label="Show toolbar"
            className="absolute right-3 top-3 z-20 flex size-8 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur transition-colors hover:bg-black/60 hover:text-white"
          >
            <PanelTopOpen className="size-4" />
          </button>
        </Tooltip>
      )}
      {/* Minimal toolbar: logs toggle + zoom. Never wraps; when the pane is
          narrow it scrolls horizontally with a thin scrollbar that shows on hover. */}
      <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b px-2 [&_button]:shrink-0 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-border",
          isFs && fsToolbarHidden && "hidden",
        )}
      >
        <button
          onClick={() => setTab(tab === "logs" ? "pdf" : "logs")}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium",
            tab === "logs"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <AlertTriangle className="size-3.5" />
          Logs
          {errors.length > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-semibold text-white",
                severity === "error" ? "bg-red-500" : "bg-amber-500"
              )}
            >
              {errors.length}
            </span>
          )}
        </button>

        {!compiling && compileTimeMs != null && (
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] font-medium tabular-nums",
              severity === "error"
                ? "text-red-500"
                : severity === "warning"
                ? "text-amber-500"
                : "text-emerald-500"
            )}
            title={
              severity === "error"
                ? "Compiled with errors"
                : severity === "warning"
                ? "Compiled with warnings"
                : "Compiled successfully"
            }
            data-testid="compile-status"
            data-severity={severity}
          >
            {severity === "error" ? (
              <XCircle className="size-3.5" />
            ) : severity === "warning" ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            {(compileTimeMs / 1000).toFixed(1)}s
          </span>
        )}

        {tab === "pdf" && (
          <div className="ml-auto flex items-center gap-0.5">
            {numPages > 0 && !isImage && (
              <>
                <Tooltip label="Single page view">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("size-7", layout === "single" && "bg-accent text-foreground")}
                    onClick={() => setLayout("single")}
                    aria-label="Single page view"
                    aria-pressed={layout === "single"}
                  >
                    <RectangleVertical className="size-3.5" />
                  </Button>
                </Tooltip>
                <Tooltip label="Two-page view">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("size-7", layout === "double" && "bg-accent text-foreground")}
                    onClick={() => setLayout("double")}
                    aria-label="Two-page view"
                    aria-pressed={layout === "double"}
                  >
                    <Columns2 className="size-3.5" />
                  </Button>
                </Tooltip>
                <div className="mx-1 h-4 w-px bg-border" />
                <Tooltip label="Previous page">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={page <= 1}
                    onClick={() => pdfRef.current?.gotoPage(page - (layout === "double" ? 2 : 1))}
                    aria-label="Previous page"
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                </Tooltip>
                <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                  <input
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        jumpToPage();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    onBlur={jumpToPage}
                    onFocus={(e) => e.target.select()}
                    aria-label="Page number"
                    className="w-8 rounded border border-input bg-background px-1 py-0.5 text-center text-foreground outline-none focus:border-primary"
                  />
                  <span>of {numPages}</span>
                </div>
                <Tooltip label="Next page">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={page >= numPages}
                    onClick={() => pdfRef.current?.gotoPage(page + (layout === "double" ? 2 : 1))}
                    aria-label="Next page"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </Tooltip>
                <div className="mx-1 h-4 w-px bg-border" />
              </>
            )}
            <Tooltip label="Zoom out">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.2))} aria-label="Zoom out">
                <ZoomOut className="size-3.5" />
              </Button>
            </Tooltip>
            <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <Tooltip label="Zoom in">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.2))} aria-label="Zoom in">
                <ZoomIn className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip label={isImage ? "Save image to project" : "Save PDF to project"}>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!pdfBytes}
                onClick={() => {
                  if (isImage) {
                    const base =
                      (projectName || "figure").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") ||
                      "figure";
                    setSaveName(`${base}.png`);
                  } else {
                    setSaveName((mainDoc.replace(/\.tex$/i, "") || "document") + ".pdf");
                  }
                  setSaveOpen(true);
                }}
                aria-label={isImage ? "Save image to project" : "Save PDF to project"}
              >
                <Save className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip label={inverted ? "Restore colors" : "Invert PDF preview colors"}>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-7", inverted && "bg-accent text-foreground")}
                disabled={!pdfBytes}
                onClick={() => setInverted((v) => !v)}
                aria-label="Invert PDF preview colors"
              >
                {inverted ? <Contrast className="size-3.5 text-primary" /> : <Contrast className="size-3.5" />}
              </Button>
            </Tooltip>
            {!isFs && (
              <Tooltip label="Open preview in a new window">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={!projectId}
                  onClick={() => projectId && void openPreviewWindow(projectId, projectName)}
                  aria-label="Open preview in a new window"
                >
                  <SquareArrowOutUpRight className="size-3.5" />
                </Button>
              </Tooltip>
            )}
            {isFs && (
              <Tooltip label="Hide toolbar">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setFsToolbarHidden(true)}
                  aria-label="Hide toolbar"
                >
                  <PanelTopClose className="size-3.5" />
                </Button>
              </Tooltip>
            )}
            <Tooltip label={isFs ? "Exit fullscreen" : "Fullscreen preview"}>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!pdfBytes}
                // Fullscreen the preview pane itself (toolbar + PDF), independent
                // of the app's layout or window. Scrollable; Esc exits.
                onClick={toggleFullscreen}
                aria-label={isFs ? "Exit fullscreen" : "Fullscreen preview"}
              >
                {isFs ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {compiling && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
        )}
        {tab === "logs" ? (
          <LogPane />
        ) : pdfBytes ? (
          <div
            ref={scrollBoxRef}
            className="h-full overflow-auto bg-sidebar"
            style={inverted ? { filter: "invert(1) hue-rotate(180deg)" } : undefined}
          >
            <ErrorBoundary
              fallback={
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  The PDF preview crashed. Recompile to try again.
                </div>
              }
            >
              <PdfViewer
                ref={pdfRef}
                data={pdfBytes}
                scale={scale}
                layout={layout}
                expectText={!isImage}
                onInverse={inverseFromClick}
                onPageChange={(current, total) => {
                  setPage(current);
                  setNumPages(total);
                  usePdfViewStore.getState().setPage(current);
                }}
              />
            </ErrorBoundary>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center text-muted-foreground">
            <FileText className="size-10 opacity-30" />
            {status === "error" ? (
              <p className="max-w-xs text-sm">
                Compile failed. Open the <strong>Logs</strong> tab to see what went wrong.
              </p>
            ) : compiling ? (
              <CompileProgress
                estimateMs={compileTimeMs ?? 2500}
                phase={phase}
              />
            ) : (
              <div className="space-y-2">
                <p className="mx-auto max-w-xs text-xs">
                  Compile your document to render a PDF preview here.
                </p>
                <p className="flex flex-wrap items-center justify-center gap-1 text-xs">
                  Press
                  <Button
                    size="icon"
                    className="size-6"
                    onClick={() => void recompile()}
                    aria-label="Recompile"
                  >
                    <Play className="size-3" />
                  </Button>
                  or hit
                  <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    {shortcut("⌘↵")}
                  </kbd>
                  to recompile
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {saveOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSaveOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{isImage ? "Save image to project" : "Save PDF to project"}</h2>
              <button onClick={() => setSaveOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Saves the current PDF into the project tree (committed via Git).
            </p>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !saving) void submitSavePdf(); }}
                placeholder="document.pdf"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
              />
              <Button onClick={() => void submitSavePdf()} disabled={saving || !pdfBytes}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tectonic does not stream real progress, so we show a reassuring estimate that
// eases toward ~95% over the expected duration (last compile time). The PDF
// appearing is the real "done" signal, which replaces this view.
function CompileProgress({
  estimateMs,
  phase,
}: {
  estimateMs: number;
  phase?: "idle" | "saving" | "downloading" | "building";
}) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const tau = Math.max(400, estimateMs) / 2.3; // ~90% reached at estimateMs
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - start;
      setPct(Math.min(95, 90 * (1 - Math.exp(-elapsed / tau))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [estimateMs]);
  const label =
    phase === "downloading"
      ? "Downloading LaTeX packages (first-time only)…"
      : "Compiling your document…";
  return (
    <div className="w-64 space-y-2" role="status" aria-live="polite">
      <p className="text-sm">
        {label}{" "}
        <span className="tabular-nums font-medium">{Math.round(pct)}%</span>
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {/* Driven by rAF, so no CSS transition (a transition on the same
            property would fight the per-frame updates and appear stuck). */}
        <div
          className="h-full w-full origin-left rounded-full bg-primary"
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})` }}
        />
      </div>
    </div>
  );
}

