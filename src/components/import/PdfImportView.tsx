import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Download,
  FileArchive,
  FolderPlus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import {
  createProjectFromConversion,
  downloadFigure,
  downloadTex,
  downloadZip,
} from "@/features/import";
import { refineAvailable, refineWithAi } from "@/features/import-refine";
import { LatexSourceViewer } from "@/components/import/LatexSourceViewer";
import { pdfPageToPng } from "@/lib/pdf-image";
import { toast } from "@/lib/toast";
import { useImportStore } from "@/store/import";

function StatsBar() {
  const report = useImportStore((s) => s.result?.report ?? null);
  if (!report) return null;
  const parts = [
    `${report.pages} pages`,
    `${report.headings} headings`,
    `${report.paragraphs} paragraphs`,
    `${report.equations} equations`,
    `${report.figures} figures`,
  ];
  return (
    <div data-testid="import-stats" className="font-mono text-xs text-muted-foreground">
      {parts.join(" · ")}
    </div>
  );
}

function PagePreviews() {
  const pdfBytes = useImportStore((s) => s.pdfBytes);
  const pageCount = useImportStore((s) => s.pages.length);
  const [pngs, setPngs] = useState<{ page: number; url: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    setPngs([]);
    if (!pdfBytes) return;
    void (async () => {
      for (let p = 1; p <= Math.min(pageCount || 1, 40); p++) {
        try {
          const url = await pdfPageToPng(pdfBytes, p, 1.5, "#ffffff");
          if (cancelled) return;
          setPngs((prev) => [...prev, { page: p, url }]);
        } catch {
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes, pageCount]);
  return (
    <div className="h-full space-y-4 overflow-y-auto bg-muted/30 p-4">
      {pngs.map(({ page, url }) => (
        <img
          key={page}
          src={url}
          alt={`Page ${page}`}
          className="w-full rounded-md border shadow-sm"
        />
      ))}
    </div>
  );
}

function SourcePane() {
  const tex = useImportStore((s) => s.result?.tex ?? "");
  const likelyScanned = useImportStore((s) => s.result?.report.likelyScanned ?? false);
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {likelyScanned && (
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          This PDF has no text layer (likely scanned). Use Refine with AI to transcribe it.
        </div>
      )}
      <LatexSourceViewer source={tex} />
    </div>
  );
}

function OptionsPopover() {
  const options = useImportStore((s) => s.options);
  const rerun = useImportStore((s) => s.rerun);
  const [range, setRange] = useState("");
  return (
    <Popover
      trigger={<Settings2 className="size-4" />}
      ariaLabel="Conversion options"
      closeOnClick={false}
      className="w-64 space-y-3 p-3"
    >
      <div className="space-y-1">
        <div className="text-xs font-medium">Page range (e.g. 2-5)</div>
        <Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="all pages" />
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium">Columns</div>
        <div className="flex gap-1">
          {(["auto", 1, 2] as const).map((c) => (
            <Button
              key={String(c)}
              size="xs"
              variant={(options.columns ?? "auto") === c ? "secondary" : "ghost"}
              onClick={() => rerun({ ...options, columns: c })}
            >
              {String(c)}
            </Button>
          ))}
        </div>
      </div>
      <Button
        size="sm"
        className="w-full"
        onClick={() => {
          const m = range.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
          rerun({
            ...options,
            pageRange: m ? [Number(m[1]), Number(m[2])] : undefined,
          });
        }}
      >
        Re-run conversion
      </Button>
    </Popover>
  );
}

function FiguresStrip() {
  const figures = useImportStore((s) => s.figures);
  if (figures.length === 0) return null;
  return (
    <div className="border-t bg-muted/40 px-4 py-3">
      <div className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {figures.length} extracted {figures.length === 1 ? "figure" : "figures"} · click to
        download
      </div>
      <div className="flex gap-3 overflow-x-auto">
        {figures.map((f) => (
          <Tooltip key={f.name} label={`Save ${f.name}`}>
            <button
              type="button"
              data-testid={`import-figure-${f.name}`}
              className="shrink-0 rounded-md border bg-background p-1 hover:ring-2 hover:ring-ring"
              onClick={() => void downloadFigure(f)}
            >
              <img src={f.pngDataUrl} alt={f.name} className="h-20 w-auto" />
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">{f.name}</div>
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export function PdfImportView() {
  const open = useImportStore((s) => s.open);
  const busy = useImportStore((s) => s.busy);
  const error = useImportStore((s) => s.error);
  const view = useImportStore((s) => s.view);
  const setView = useImportStore((s) => s.setView);
  const close = useImportStore((s) => s.close);
  const fileName = useImportStore((s) => s.fileName);
  const result = useImportStore((s) => s.result);
  const [refineable, setRefineable] = useState(false);
  useEffect(() => {
    if (open) void refineAvailable().then(setRefineable);
  }, [open]);
  if (!open) return null;
  return (
    <div data-testid="pdf-import-view" className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={close} data-testid="import-back">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="font-medium">PDF to LaTeX</div>
        <div className="max-w-48 truncate text-sm text-muted-foreground">{fileName}</div>
        <div className="h-5 w-px shrink-0 bg-border" />
        <StatsBar />
        <div className="ml-auto flex items-center gap-2">
          <OptionsPopover />
          <Button
            variant="outline"
            size="sm"
            disabled={!result}
            onClick={() => {
              void navigator.clipboard.writeText(result?.tex ?? "");
              toast.success("Copied LaTeX source");
            }}
          >
            <Copy className="size-4" /> Copy
          </Button>
          <Button variant="outline" size="sm" disabled={!result} onClick={() => void downloadTex()}>
            <Download className="size-4" /> .tex
          </Button>
          <Button variant="outline" size="sm" disabled={!result} onClick={() => void downloadZip()}>
            <FileArchive className="size-4" /> .zip
          </Button>
          {refineable && (
            <Button
              variant="outline"
              size="sm"
              disabled={!result}
              data-testid="import-refine"
              onClick={() => void refineWithAi()}
            >
              <Sparkles className="size-4" /> Refine with AI
            </Button>
          )}
          <Button
            size="sm"
            disabled={!result}
            data-testid="import-create-project"
            onClick={() => void createProjectFromConversion()}
          >
            <FolderPlus className="size-4" /> Create project
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b px-4 py-1.5">
        {(["preview", "source", "split"] as const).map((v) => (
          <Button
            key={v}
            size="xs"
            variant={view === v ? "secondary" : "ghost"}
            onClick={() => setView(v)}
            data-testid={`import-view-${v}`}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </Button>
        ))}
        {busy && <span className="ml-3 text-xs text-muted-foreground">Converting...</span>}
        {error && <span className="ml-3 text-xs text-destructive">{error}</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          AI-free local reconstruction. Review before trusting.
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {(view === "preview" || view === "split") && (
          <div className={view === "split" ? "w-1/2 border-r" : "w-full"}>
            <PagePreviews />
          </div>
        )}
        {(view === "source" || view === "split") && (
          <div className={view === "split" ? "w-1/2" : "w-full"}>
            <SourcePane />
          </div>
        )}
      </div>
      <FiguresStrip />
    </div>
  );
}
