import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Contrast,
  FileText,
  Minus,
  Plus,
  RectangleVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PdfViewer, type PdfViewerHandle, type PdfLayout } from "@/components/pdf/PdfViewer";
import { readCompiledPdf } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;

// Detached PDF preview window (`?view=preview`); reloads on `preview:refresh` /
// `preview:project` events emitted by the main window.
export function PreviewWindow() {
  const [projectId, setProjectId] = useState<string>(() =>
    new URLSearchParams(window.location.search).get("project") ?? "",
  );
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [layout, setLayout] = useState<PdfLayout>("single");
  const [inverted, setInverted] = useState(false);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const pdfRef = useRef<PdfViewerHandle>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const buf = await readCompiledPdf(id);
      setBytes(new Uint8Array(buf));
      setError(false);
    } catch {
      setBytes(null);
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  useEffect(() => {
    const un1 = listen("preview:refresh", () => void load(projectId));
    const un2 = listen<{ projectId: string }>("preview:project", (e) => {
      if (e.payload?.projectId) setProjectId(e.payload.projectId);
    });
    return () => {
      void un1.then((f) => f());
      void un2.then((f) => f());
    };
  }, [projectId, load]);

  useEffect(() => setPageInput(String(page)), [page]);

  useEffect(() => {
    if (numPages <= 1 && layout === "double") setLayout("single");
  }, [layout, numPages]);

  const scaleRefCurrent = useRef(scale);
  scaleRefCurrent.current = scale;

  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setScale((s) => clamp(s - e.deltaY * 0.01));
    };
    let gestureStart = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = scaleRefCurrent.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scaleFactor = (e as unknown as { scale: number }).scale;
      setScale(clamp(gestureStart * scaleFactor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    el.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart as EventListener);
      el.removeEventListener("gesturechange", onGestureChange as EventListener);
    };
  }, []);

  const jumpToPage = () => {
    const n = Number.parseInt(pageInput, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= numPages && n !== page) pdfRef.current?.gotoPage(n);
    else setPageInput(String(page));
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-end gap-1 border-b px-2 py-1 [&_button]:shrink-0">
        {numPages > 0 && (
          <>
            <Tooltip label="Single page view">
              <Button variant="ghost" size="icon" className={cn("size-7", layout === "single" && "bg-accent text-foreground")} onClick={() => setLayout("single")} aria-label="Single page view">
                <RectangleVertical className="size-3.5" />
              </Button>
            </Tooltip>
            {numPages > 1 && (
              <Tooltip label="Two-page view">
                <Button variant="ghost" size="icon" className={cn("size-7", layout === "double" && "bg-accent text-foreground")} onClick={() => setLayout("double")} aria-label="Two-page view">
                  <Columns2 className="size-3.5" />
                </Button>
              </Tooltip>
            )}
            <div className="mx-1 h-4 w-px bg-border" />
            <Tooltip label="Previous page">
              <Button variant="ghost" size="icon" className="size-7" disabled={page <= 1} onClick={() => pdfRef.current?.gotoPage(page - 1)} aria-label="Previous page">
                <ChevronUp className="size-3.5" />
              </Button>
            </Tooltip>
            <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <Input
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
              <Button variant="ghost" size="icon" className="size-7" disabled={page >= numPages} onClick={() => pdfRef.current?.gotoPage(page + 1)} aria-label="Next page">
                <ChevronDown className="size-3.5" />
              </Button>
            </Tooltip>
            <div className="mx-1 h-4 w-px bg-border" />
          </>
        )}
        <Tooltip label="Zoom out">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.2))} aria-label="Zoom out">
            <Minus className="size-3.5" />
          </Button>
        </Tooltip>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
        <Tooltip label="Zoom in">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.2))} aria-label="Zoom in">
            <Plus className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip label={inverted ? "Restore colors" : "Invert colors"}>
          <Button variant="ghost" size="icon" className={cn("size-7", inverted && "bg-accent text-foreground")} onClick={() => setInverted((v) => !v)} aria-label="Invert colors">
            <Contrast className={cn("size-3.5", inverted && "text-primary")} />
          </Button>
        </Tooltip>
      </div>

      <div
        ref={scrollBoxRef}
        className="min-h-0 flex-1 overflow-auto bg-sidebar"
        style={inverted ? { filter: "invert(1) hue-rotate(180deg)" } : undefined}
      >
        {bytes ? (
          <ErrorBoundary
            fallback={<div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">The PDF preview crashed. Recompile in the main window.</div>}
          >
            <PdfViewer
              ref={pdfRef}
              data={bytes}
              scale={scale}
              layout={layout}
              onPageChange={(current, total) => {
                setPage(current);
                setNumPages(total);
              }}
            />
          </ErrorBoundary>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
            <FileText className="size-10 opacity-30" />
            <p className="max-w-xs text-sm">
              {error
                ? "No compiled PDF yet. Compile in the main window and it will appear here."
                : "Loading preview…"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
