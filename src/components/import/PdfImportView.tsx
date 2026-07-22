import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileArchive,
  FileInput,
  FolderPlus,
  PanelLeft,
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
  handlePickedFile,
} from "@/features/import";
import { refineAvailable, refineWithAi } from "@/features/import-refine";
import { LatexSourceViewer } from "@/components/import/LatexSourceViewer";
import { LibrarySidebar } from "@/components/library/LibrarySidebar";
import { cn } from "@/lib/utils";
import { pdfPageToPng } from "@/lib/pdf-image";
import { toast } from "@/lib/toast";
import { useHomeViewStore } from "@/store/home-view";
import { useImportStore } from "@/store/import";
import { useLibrarySidebarStore } from "@/store/library-sidebar";

const HANDLES = [
  "Headings, paragraphs, lists",
  "Two-column layouts",
  "Bold / italic / monospace",
  "Inline & display math",
  "Greek & math symbols",
  "Figures (auto-extracted)",
  "Header/footer stripping",
  "Word documents (.docx), via pandoc",
];

function PdfDropzoneLanding() {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-xl">
        <div
          data-testid="pdf-dropzone"
          className={cn(
            "flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-8 py-14 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handlePickedFile(f);
          }}
        >
          <FileInput className="size-10 text-muted-foreground" />
          <div>
            <p className="text-lg font-semibold">Drop a PDF or Word document here</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Or{" "}
              <button
                type="button"
                data-testid="pdf-dropzone-browse"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => inputRef.current?.click()}
              >
                browse
              </button>{" "}
              to upload. PDFs convert locally on your device; nothing is uploaded anywhere.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handlePickedFile(f);
            }}
          />
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            <span>Client-side</span>
            <span>·</span>
            <span>pdf.js + KaTeX</span>
            <span>·</span>
            <span>Scanned PDFs: use Refine with AI</span>
          </div>
        </div>
        <div className="mt-8">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What it handles
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {HANDLES.map((h) => (
              <div key={h} className="flex items-center gap-2">
                <Check className="size-3.5 shrink-0 text-emerald-500" /> {h}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const page = useHomeViewStore((s) => s.page);
  const pdfBytes = useImportStore((s) => s.pdfBytes);
  const busy = useImportStore((s) => s.busy);
  const error = useImportStore((s) => s.error);
  const view = useImportStore((s) => s.view);
  const setView = useImportStore((s) => s.setView);
  const close = useImportStore((s) => s.close);
  const fileName = useImportStore((s) => s.fileName);
  const result = useImportStore((s) => s.result);
  const [refineable, setRefineable] = useState(false);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useLibrarySidebarStore();
  const active = page === "pdf-import";
  useEffect(() => {
    if (active) void refineAvailable().then(setRefineable);
  }, [active]);
  if (!active) return null;
  return (
    <div data-testid="pdf-import-view" className="flex h-full bg-background">
      <LibrarySidebar collapsed={sidebarCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Tooltip label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle sidebar"
            data-testid="toggle-import-sidebar"
            className="text-muted-foreground hover:text-foreground"
            onClick={toggleSidebar}
          >
            <PanelLeft className="size-4" />
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            close();
            useHomeViewStore.getState().goTo("library");
          }}
          data-testid="import-back"
        >
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="font-medium">PDF to LaTeX</div>
        {pdfBytes && (
          <>
            <div className="max-w-48 truncate text-sm text-muted-foreground">{fileName}</div>
            <div className="h-5 w-px shrink-0 bg-border" />
            <StatsBar />
          </>
        )}
        {pdfBytes && (
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
            <Button
              variant="outline"
              size="sm"
              disabled={!result}
              onClick={() => void downloadTex()}
            >
              <Download className="size-4" /> .tex
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!result}
              onClick={() => void downloadZip()}
            >
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
            <Button variant="ghost" size="sm" onClick={close}>
              New PDF
            </Button>
          </div>
        )}
      </div>
      {!pdfBytes ? (
        <PdfDropzoneLanding />
      ) : (
        <>
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
        </>
      )}
      </div>
    </div>
  );
}
