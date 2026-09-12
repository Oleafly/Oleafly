import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bold,
  Columns2,
  Copy,
  Download,
  FileArchive,
  FileInput,
  FolderPlus,
  Heading,
  Image as ImageIcon,
  Loader2,
  Radical,
  ScanText,
  ScissorsLineDashed,
  Settings2,
  Sigma,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { WindowControls } from "@/components/layout/WindowControls";
import { ToolSplitView } from "@/components/tools/ToolWorkspace";
import {
  createProjectFromConversion,
  downloadFigure,
  downloadTex,
  handleDownloadZipClick,
  handlePickedFile,
} from "@/features/import";
import { refineAvailable, refineWithAi } from "@/features/import-refine";
import { LatexSourceViewer } from "@/components/import/LatexSourceViewer";
import { cn, isMac } from "@/lib/utils";
import { formatNumber } from "@/lib/intl";
import { pdfPageToPng } from "@/lib/pdf-image";
import { toast } from "@/lib/toast";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useHomeViewStore } from "@/store/home-view";
import { useImportStore } from "@/store/import";
import { i18n } from "@/i18n";

const HANDLES = [
  { id: "structure", icon: Heading },
  { id: "emphasis", icon: Bold },
  { id: "symbols", icon: Sigma },
  { id: "chrome", icon: ScissorsLineDashed },
  { id: "columns", icon: Columns2 },
  { id: "math", icon: Radical },
  { id: "figures", icon: ImageIcon },
] as const;

function openPdf(file: File): void {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    toast.error(i18n.t(($) => $.library.pdfImport.choosePdf));
    return;
  }
  void handlePickedFile(file);
}

function PdfDropzoneLanding() {
  const { t } = useTranslation(["library"]);
  const handleLabels: Record<(typeof HANDLES)[number]["id"], string> = {
    structure: t(($) => $.library.pdfImport.handles.structure),
    emphasis: t(($) => $.library.pdfImport.handles.emphasis),
    symbols: t(($) => $.library.pdfImport.handles.symbols),
    chrome: t(($) => $.library.pdfImport.handles.chrome),
    columns: t(($) => $.library.pdfImport.handles.columns),
    math: t(($) => $.library.pdfImport.handles.math),
    figures: t(($) => $.library.pdfImport.handles.figures),
  };
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-xl">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: click/drag are supplementary; the browse button below remains keyboard accessible */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the browse button inside provides the keyboard path */}
        <div // NOSONAR - the browse button inside is the keyboard path; a tab stop here would duplicate it
          data-testid="pdf-dropzone"
          className={cn(
            "flex cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed px-8 py-14 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/20 hover:border-primary",
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) openPdf(f);
          }}
        >
          <FileInput className="size-10 text-muted-foreground" />
          <div>
            <p className="text-lg font-semibold">{t(($) => $.library.pdfImport.dropTitle)}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <Trans
                ns="library"
                i18nKey={($) => $.library.pdfImport.dropHint}
                components={{
                  browse: (
                    <button
                      type="button"
                      data-testid="pdf-dropzone-browse"
                      className="font-medium text-primary underline underline-offset-2"
                      onClick={(e) => {
                        // The whole dropzone opens the picker; don't fire it twice.
                        e.stopPropagation();
                        inputRef.current?.click();
                      }}
                    />
                  ),
                }}
              />
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) openPdf(f);
            }}
          />
        </div>
        <div className="mt-8">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(($) => $.library.pdfImport.handlesTitle)}
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {HANDLES.map(({ icon: Icon, id }) => (
              <div key={id} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
                {handleLabels[id]}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsBar() {
  const { t } = useTranslation(["library"]);
  const report = useImportStore((s) => s.result?.report ?? null);
  if (!report) return null;
  const parts = [
    t(($) => $.library.pdfImport.stats.pages, {
      count: report.pages,
      total: formatNumber(report.pages),
    }),
    t(($) => $.library.pdfImport.stats.headings, {
      count: report.headings,
      total: formatNumber(report.headings),
    }),
    t(($) => $.library.pdfImport.stats.paragraphs, {
      count: report.paragraphs,
      total: formatNumber(report.paragraphs),
    }),
    t(($) => $.library.pdfImport.stats.equations, {
      count: report.equations,
      total: formatNumber(report.equations),
    }),
    t(($) => $.library.pdfImport.stats.figures, {
      count: report.figures,
      total: formatNumber(report.figures),
    }),
  ];
  return (
    <div data-testid="import-stats" className="font-mono text-xs text-muted-foreground">
      {parts.join(" · ")}
    </div>
  );
}

function PagePreviews() {
  const { t } = useTranslation(["library"]);
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
          alt={t(($) => $.library.pdfImport.pageAlt, { page })}
          className="w-full rounded-md border shadow-sm"
        />
      ))}
    </div>
  );
}

function SourcePane() {
  const { t } = useTranslation(["library"]);
  const tex = useImportStore((s) => s.result?.tex ?? "");
  const likelyScanned = useImportStore((s) => s.result?.report.likelyScanned ?? false);
  const scanTranscribed = useImportStore((s) => s.scanTranscribed);
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {likelyScanned && !scanTranscribed && (
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          {t(($) => $.library.pdfImport.scannedLocal)}
        </div>
      )}
      <LatexSourceViewer source={tex} />
    </div>
  );
}

function OptionsPopover() {
  const { t } = useTranslation(["library"]);
  const options = useImportStore((s) => s.options);
  const rerun = useImportStore((s) => s.rerun);
  const [range, setRange] = useState("");
  return (
    <Popover
      trigger={<Settings2 className="size-4" />}
      ariaLabel={t(($) => $.library.pdfImport.options.label)}
      closeOnClick={false}
      className="w-64 space-y-3 p-3"
    >
      <div className="space-y-1">
        <div className="text-xs font-medium">{t(($) => $.library.pdfImport.options.pageRange)}</div>
        <Input
          value={range}
          onChange={(e) => setRange(e.target.value)}
          placeholder={t(($) => $.library.pdfImport.options.pageRangePlaceholder)}
        />
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium">{t(($) => $.library.pdfImport.options.columns)}</div>
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
        {t(($) => $.library.pdfImport.options.rerun)}
      </Button>
    </Popover>
  );
}

function FiguresStrip() {
  const { t } = useTranslation(["library"]);
  const figures = useImportStore((s) => s.figures);
  if (figures.length === 0) return null;
  return (
    <div className="border-t bg-muted/40 px-4 py-3">
      <div className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {t(($) => $.library.pdfImport.figuresStrip, {
          count: figures.length,
          total: formatNumber(figures.length),
        })}
      </div>
      <div className="flex gap-3 overflow-x-auto">
        {figures.map((f) => (
          <Tooltip key={f.name} label={t(($) => $.library.pdfImport.saveFigure, { name: f.name })}>
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
  const { t } = useTranslation(["library"]);
  const page = useHomeViewStore((s) => s.page);
  const pdfBytes = useImportStore((s) => s.pdfBytes);
  const busy = useImportStore((s) => s.busy);
  const error = useImportStore((s) => s.error);
  const view = useImportStore((s) => s.view);
  const setView = useImportStore((s) => s.setView);
  const close = useImportStore((s) => s.close);
  const fileName = useImportStore((s) => s.fileName);
  const result = useImportStore((s) => s.result);
  const scanTranscribed = useImportStore((s) => s.scanTranscribed);
  const transcribeScan = useImportStore((s) => s.transcribeScan);
  const [refineable, setRefineable] = useState(false);
  const fullscreen = useFullscreen();
  const active = page === "pdf-import";
  const viewLabels = {
    preview: t(($) => $.library.pdfImport.views.preview),
    source: t(($) => $.library.pdfImport.views.source),
    split: t(($) => $.library.pdfImport.views.split),
  };
  useEffect(() => {
    if (active) void refineAvailable().then(setRefineable);
  }, [active]);
  if (!active) return null;
  return (
    <div data-testid="pdf-import-view" className="flex h-full flex-col bg-background">
      <div
        data-tauri-drag-region
        className={cn(
          "flex items-center gap-3 border-b px-4 py-2",
          isMac && !fullscreen && "pl-20",
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            close();
            useHomeViewStore.getState().goTo("tools");
          }}
          data-testid="import-back"
        >
          <ArrowLeft className="size-4" /> {t(($) => $.library.pdfImport.back)}
        </Button>
        <div className="h-5 w-px shrink-0 bg-border" />
        <div className="font-medium">{t(($) => $.library.pdfImport.heading)}</div>
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
                toast.success(t(($) => $.library.pdfImport.copied));
              }}
            >
              <Copy className="size-4" /> {t(($) => $.library.pdfImport.copy)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!result}
              onClick={() => void downloadTex()}
            >
              <Download className="size-4" /> {".tex"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!result}
              onClick={() => void handleDownloadZipClick()}
            >
              <FileArchive className="size-4" /> {".zip"}
            </Button>
            {refineable && (
              <Button
                variant="outline"
                size="sm"
                disabled={!result}
                data-testid="import-refine"
                onClick={() => void refineWithAi()}
              >
                <Sparkles className="size-4" /> {t(($) => $.library.pdfImport.refine)}
              </Button>
            )}
            {result?.report.likelyScanned && !scanTranscribed && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                data-testid="import-transcribe-scan"
                onClick={() => void transcribeScan()}
              >
                {busy ? <Loader2 className="animate-spin" /> : <ScanText />}
                {t(($) => $.library.pdfImport.transcribeLocal)}
              </Button>
            )}
            <Button
              size="sm"
              disabled={!result}
              data-testid="import-create-project"
              onClick={() => void createProjectFromConversion()}
            >
              <FolderPlus className="size-4" /> {t(($) => $.library.pdfImport.createProject)}
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              {t(($) => $.library.pdfImport.newFile)}
            </Button>
          </div>
        )}
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            !pdfBytes && "ml-auto",
          )}
        >
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t(($) => $.library.pdfImport.local)}
        </div>
        <WindowControls />
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
                {viewLabels[v]}
              </Button>
            ))}
            {busy && (
              <span className="ml-3 text-xs text-muted-foreground">
                {t(($) => $.library.pdfImport.converting)}
              </span>
            )}
            {error && <span className="ml-3 text-xs text-destructive">{error}</span>}
            <span className="ml-auto text-xs text-muted-foreground">
              {scanTranscribed
                ? "Transcribed on this device. Review equations and tables."
                : t(($) => $.library.pdfImport.disclaimer)}
            </span>
          </div>
          {view === "split" ? (
            <ToolSplitView storageId="pdf-import-review">
              <div className="h-full min-w-0"><PagePreviews /></div>
              <div className="h-full min-w-0"><SourcePane /></div>
            </ToolSplitView>
          ) : (
            <div className="flex min-h-0 flex-1">
              {view === "preview" ? (
                <div className="w-full"><PagePreviews /></div>
              ) : (
                <div className="w-full"><SourcePane /></div>
              )}
            </div>
          )}
          <FiguresStrip />
        </>
      )}
    </div>
  );
}
