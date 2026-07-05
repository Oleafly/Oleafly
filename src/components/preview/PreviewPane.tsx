import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Contrast, FileText, Maximize, Minus, Play, Plus, Save, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { LogPane } from "@/components/editor/LogPane";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { inverseFromClick } from "@/features/synctex";
import { saveFileBase64, uint8ToBase64 } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;

export function PreviewPane() {
  const status = useCompileStore((s) => s.status);
  const pdfBytes = useCompileStore((s) => s.pdfBytes);
  const recompile = useCompileStore((s) => s.recompile);
  const errors = useCompileStore((s) => s.errors);
  const compileTimeMs = useCompileStore((s) => s.compileTimeMs);
  const lastCompiledAt = useCompileStore((s) => s.lastCompiledAt);
  const projectId = useFilesStore((s) => s.projectId);
  const refreshTree = useFilesStore((s) => s.refreshTree);
  const mainDoc = useFilesStore((s) => s.mainDoc);
  const [scale, setScale] = useState(1.0);
  const [tab, setTab] = useState<"pdf" | "logs">("pdf");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [presenting, setPresenting] = useState(false);

  const submitSavePdf = async () => {
    if (!projectId || !pdfBytes) return;
    const raw = saveName.trim() || mainDoc.replace(/\.tex$/i, "") || "document";
    const name = raw.replace(/\.pdf$/i, "") + ".pdf";
    setSaving(true);
    try {
      await saveFileBase64(projectId, name, uint8ToBase64(pdfBytes));
      await refreshTree();
      setSaveOpen(false);
      setSaveName("");
      toast.success("PDF saved to the project.");
    } catch (e) {
      notifyError("save pdf to project", e, "Couldn't save the PDF into the project.");
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
    <div className="flex h-full flex-col bg-background">
      {/* Minimal toolbar: logs toggle + zoom */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
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
            <Tooltip label="Zoom out">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.2))} aria-label="Zoom out">
                <Minus className="size-3.5" />
              </Button>
            </Tooltip>
            <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <Tooltip label="Zoom in">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.2))} aria-label="Zoom in">
                <Plus className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip label="Save PDF to project">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!pdfBytes}
                onClick={() => {
                  setSaveName((mainDoc.replace(/\.tex$/i, "") || "document") + ".pdf");
                  setSaveOpen(true);
                }}
                aria-label="Save PDF to project"
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
            <Tooltip label="Presentation mode">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!pdfBytes}
                onClick={() => setPresenting(true)}
                aria-label="Presentation mode"
              >
                <Maximize className="size-3.5" />
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
            className="h-full overflow-auto bg-sidebar"
            style={inverted ? { filter: "invert(1) hue-rotate(180deg)" } : undefined}
          >
            <PdfViewer data={pdfBytes} scale={scale} onInverse={inverseFromClick} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center text-muted-foreground">
            <FileText className="size-10 opacity-30" />
            {status === "error" ? (
              <p className="max-w-xs text-sm">
                Compile failed — open the <strong>Logs</strong> tab to see what went wrong.
              </p>
            ) : compiling ? (
              <p className="text-sm">Compiling your document…</p>
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
                    ⌘ + Enter
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
              <h2 className="text-sm font-semibold">Save PDF to project</h2>
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

      {/* Presentation mode - fullscreen PDF */}
      {presenting && pdfBytes && (
        <PresentationView
          data={pdfBytes}
          inverted={inverted}
          onExit={() => setPresenting(false)}
        />
      )}
    </div>
  );
}

function PresentationView({
  data,
  inverted,
  onExit,
}: {
  data: Uint8Array;
  inverted: boolean;
  onExit: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onExit]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      style={inverted ? { filter: "invert(1) hue-rotate(180deg)" } : undefined}
    >
      <button
        onClick={onExit}
        className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur hover:bg-white/20 hover:text-white"
        aria-label="Exit presentation"
      >
        <X className="size-5" />
      </button>
      <div className="min-h-0 flex-1 overflow-auto">
        <PdfViewer data={data} scale={1.25} />
      </div>
    </div>
  );
}
