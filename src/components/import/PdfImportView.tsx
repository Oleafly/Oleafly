import {
  type DragEvent as ReactDragEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Radical,
  ScanText,
  ScissorsLineDashed,
  Settings2,
  Sigma,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import {
  knownProviderConfig,
  loadProviderConfig,
  subscribeProviderConfig,
} from "@/components/ai/provider-config";
import { describeToolsChoice, destinationName } from "@/features/tools-ai/tools-choice";
import type { AppConfig } from "@/lib/tauri";
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
import { notifyError, toast } from "@/lib/toast";
import { isNativeFileDrop, takeNativeDrop } from "@/lib/native-drop";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useHomeViewStore } from "@/store/home-view";
import { useImportStore } from "@/store/import";
import { i18n } from "@/i18n";
import { Spinner } from "@/components/ui/spinner";
import { SectionHeading } from "@/components/ui/section-heading";
import type { PageSize } from "@/features/tools-ai/scan-estimate";
import { scanProgressLabel } from "@/features/tools-ai/scan-progress";

// The App shell loads this view eagerly, so the Tools model banner (model
// list, estimate, Mathpix status) stays out of the entry chunk.
const ScanTranscribeBanner = lazy(() =>
  import("@/components/tools/ScanTranscribeBanner").then((module) => ({
    default: module.ScanTranscribeBanner,
  })),
);

const HANDLES = [
  { id: "structure", icon: Heading },
  { id: "emphasis", icon: Bold },
  { id: "symbols", icon: Sigma },
  { id: "chrome", icon: ScissorsLineDashed },
  { id: "columns", icon: Columns2 },
  { id: "math", icon: Radical },
  { id: "figures", icon: ImageIcon },
] as const;

async function copyConvertedSource(tex: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(tex);
    toast.success(i18n.t(($) => $.library.pdfImport.copied));
  } catch (error) {
    notifyError(
      "copy converted LaTeX",
      error,
      i18n.t(($) => $.researchTools.converter.copyFailed),
    );
  }
}

function openPdf(file: File): void {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    toast.error(i18n.t(($) => $.library.pdfImport.choosePdf));
    return;
  }
  void handlePickedFile(file);
}

async function openNativePdf(): Promise<void> {
  const [dropped] = await takeNativeDrop();
  if (!dropped) return;
  if (!dropped.name.toLowerCase().endsWith(".pdf")) {
    toast.error(i18n.t(($) => $.library.pdfImport.choosePdf));
    return;
  }
  try {
    openPdf(await dropped.read());
  } catch (error) {
    notifyError("read dropped PDF", error, i18n.t(($) => $.core.project.importFailed));
  }
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
  const acceptDrag = (e: ReactDragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
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
          onDragEnter={acceptDrag}
          onDragOver={acceptDrag}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) openPdf(f);
            else if (isNativeFileDrop(e.dataTransfer)) void openNativePdf();
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
          <SectionHeading as="div" className="mb-3">
            {t(($) => $.library.pdfImport.handlesTitle)}
          </SectionHeading>
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

/**
 * Where a scanned PDF's pages go, the Tools model and the estimate. It sits
 * above the panes, so every view shows it next to Transcribe scan.
 */
function ScanNotice() {
  const { t } = useTranslation(["library"]);
  const storePages = useImportStore((s) => s.pages);
  const range = useImportStore((s) => s.options.pageRange);
  const sizes = useMemo<PageSize[]>(
    () => storePages.map(({ width, height }) => ({ width, height })),
    [storePages],
  );
  return (
    <Suspense
      fallback={
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          {t(($) => $.library.pdfImport.scannedLocal)}
        </div>
      }
    >
      <ScanTranscribeBanner pages={sizes} range={range} />
    </Suspense>
  );
}

/** The service Transcribe scan would send pages to, or null for this computer. */
function usePendingScanDestination(pending: boolean): string | null {
  const [config, setConfig] = useState<AppConfig | null>(() => knownProviderConfig());
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const unsubscribe = subscribeProviderConfig((next) => {
      if (active) setConfig(next);
    });
    void loadProviderConfig()
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [pending]);
  if (!pending || !config) return null;
  return destinationName(describeToolsChoice(config).destination);
}

function SourcePane() {
  const tex = useImportStore((s) => s.result?.tex ?? "");
  return (
    <div className="flex h-full flex-col overflow-hidden">
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
              className="shrink-0 rounded-md border bg-background p-1 transition-colors hover:border-ring focus-visible:border-ring"
              onClick={() => void downloadFigure(f)}
            >
              <img src={f.pngDataUrl} alt={f.name} className="h-20 w-auto" />
              <div className="mt-1 font-mono text-[0.625rem] text-muted-foreground">{f.name}</div>
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

/** True for a scanned document whose pages have not been transcribed yet. */
function useScanPending(): boolean {
  return useImportStore((s) => Boolean(s.result?.report.likelyScanned) && !s.scanTranscribed);
}

/** Runs one create-style action at a time; `creating` is true while it runs. */
function useSingleCreate(): {
  creating: boolean;
  runCreate: (work: () => Promise<unknown>) => void;
} {
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const runCreate = (work: () => Promise<unknown>) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    void work().finally(() => {
      creatingRef.current = false;
      setCreating(false);
    });
  };
  return { creating, runCreate };
}

function TranscribeScanButton() {
  const { t } = useTranslation(["library"]);
  const likelyScanned = useImportStore((s) => Boolean(s.result?.report.likelyScanned));
  const scanTranscribed = useImportStore((s) => s.scanTranscribed);
  const busy = useImportStore((s) => s.busy);
  const transcribeScan = useImportStore((s) => s.transcribeScan);
  if (!likelyScanned || scanTranscribed) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      data-testid="import-transcribe-scan"
      onClick={() => void transcribeScan()}
    >
      {busy ? <Spinner /> : <ScanText />}
      {t(($) => $.library.pdfImport.transcribeLocal)}
    </Button>
  );
}

function ImportActions({
  refineable,
  creating,
  runCreate,
}: Readonly<{
  refineable: boolean;
  creating: boolean;
  runCreate: (work: () => Promise<unknown>) => void;
}>) {
  const { t } = useTranslation(["library"]);
  const result = useImportStore((s) => s.result);
  const close = useImportStore((s) => s.close);
  return (
    <div className="ml-auto flex items-center gap-2">
      <OptionsPopover />
      <Button
        variant="outline"
        size="sm"
        disabled={!result}
        onClick={() => void copyConvertedSource(result?.tex ?? "")}
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
          disabled={!result || creating}
          data-testid="import-refine"
          onClick={() => runCreate(refineWithAi)}
        >
          <Sparkles className="size-4" /> {t(($) => $.library.pdfImport.refine)}
        </Button>
      )}
      <TranscribeScanButton />
      <Button
        size="sm"
        disabled={!result || creating}
        data-testid="import-create-project"
        onClick={() => runCreate(createProjectFromConversion)}
      >
        <FolderPlus className="size-4" /> {t(($) => $.library.pdfImport.createProject)}
      </Button>
      <Button variant="ghost" size="sm" onClick={close}>
        {t(($) => $.library.pdfImport.newFile)}
      </Button>
    </div>
  );
}

/** Where the document stays: this computer, the model that transcribed it, or
 * before a transcription the service Transcribe scan would send the pages to. */
function ImportDestinationBadge({
  pdfLoaded,
  pendingScanTo,
}: Readonly<{ pdfLoaded: boolean; pendingScanTo: string | null }>) {
  const { t } = useTranslation(["library", "researchTools", "shell"]);
  const scanModel = useImportStore((s) => s.scanModel);
  let label = t(($) => $.library.pdfImport.local);
  if (scanModel?.sentTo) {
    label = t(($) => $.researchTools.converterModel.sentBadge, { provider: scanModel.sentTo });
  } else if (pendingScanTo) {
    label = t(($) => $.shell.importDestination.scansGoTo, { provider: pendingScanTo });
  }
  const remote = Boolean(scanModel?.sentTo || pendingScanTo);
  return (
    <Badge
      data-testid="import-destination"
      data-destination={remote ? "remote" : "device"}
      variant={remote ? "warning" : "success"}
      className={cn("px-3 py-1", !pdfLoaded && "ml-auto")}
    >
      {label}
    </Badge>
  );
}

function ImportHeader({
  pdfLoaded,
  fullscreen,
  pendingScanTo,
  refineable,
  creating,
  runCreate,
}: Readonly<{
  pdfLoaded: boolean;
  fullscreen: boolean;
  pendingScanTo: string | null;
  refineable: boolean;
  creating: boolean;
  runCreate: (work: () => Promise<unknown>) => void;
}>) {
  const { t } = useTranslation(["library"]);
  const close = useImportStore((s) => s.close);
  const fileName = useImportStore((s) => s.fileName);
  return (
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
      {pdfLoaded && (
        <>
          <div className="max-w-48 truncate text-sm text-muted-foreground">{fileName}</div>
          <div className="h-5 w-px shrink-0 bg-border" />
          <StatsBar />
        </>
      )}
      {pdfLoaded && <ImportActions refineable={refineable} creating={creating} runCreate={runCreate} />}
      <ImportDestinationBadge pdfLoaded={pdfLoaded} pendingScanTo={pendingScanTo} />
      <WindowControls />
    </div>
  );
}

function ImportViewSwitcher() {
  const { t } = useTranslation(["library"]);
  const view = useImportStore((s) => s.view);
  const setView = useImportStore((s) => s.setView);
  const viewLabels = {
    preview: t(($) => $.library.pdfImport.views.preview),
    source: t(($) => $.library.pdfImport.views.source),
    split: t(($) => $.library.pdfImport.views.split),
  };
  return (
    <>
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
    </>
  );
}

/** The conversion or scan progress, the cancel button for a scan and any error. */
function ImportRunStatus() {
  const { t } = useTranslation(["library", "researchTools"]);
  const busy = useImportStore((s) => s.busy);
  const error = useImportStore((s) => s.error);
  const scanProgress = useImportStore((s) => s.scanProgress);
  const cancelScan = useImportStore((s) => s.cancelScan);
  return (
    <>
      {busy && (
        <span data-testid="import-progress" className="ml-3 text-xs text-muted-foreground">
          {(scanProgress && scanProgressLabel(scanProgress)) ?? t(($) => $.library.pdfImport.converting)}
        </span>
      )}
      {scanProgress && (
        <Button variant="ghost" size="xs" className="ml-1" onClick={cancelScan} data-testid="import-cancel-scan">
          <X /> {t(($) => $.researchTools.converter.cancel)}
        </Button>
      )}
      {error && <span className="ml-3 select-text text-xs text-destructive">{error}</span>}
    </>
  );
}

function ImportReviewBar() {
  const { t } = useTranslation(["library", "researchTools"]);
  const scanTranscribed = useImportStore((s) => s.scanTranscribed);
  const scanModel = useImportStore((s) => s.scanModel);
  return (
    <div className="flex items-center gap-1 border-b px-4 py-1.5">
      <ImportViewSwitcher />
      <ImportRunStatus />
      <span className="ml-auto text-xs text-muted-foreground">
        {scanTranscribed
          ? t(($) => $.researchTools.converterModel.transcribedWith, {
              model: scanModel?.label ?? t(($) => $.researchTools.converterModel.automatic),
            })
          : t(($) => $.library.pdfImport.disclaimer)}
      </span>
    </div>
  );
}

function ImportPanes() {
  const view = useImportStore((s) => s.view);
  if (view === "split") {
    return (
      <ToolSplitView storageId="pdf-import-review">
        <div className="h-full min-w-0"><PagePreviews /></div>
        <div className="h-full min-w-0"><SourcePane /></div>
      </ToolSplitView>
    );
  }
  return (
    <div className="flex min-h-0 flex-1">
      {view === "preview" ? (
        <div className="w-full"><PagePreviews /></div>
      ) : (
        <div className="w-full"><SourcePane /></div>
      )}
    </div>
  );
}

export function PdfImportView() {
  const page = useHomeViewStore((s) => s.page);
  const pdfLoaded = useImportStore((s) => Boolean(s.pdfBytes));
  const scanPending = useScanPending();
  const [refineable, setRefineable] = useState(false);
  const { creating, runCreate } = useSingleCreate();
  const fullscreen = useFullscreen();
  const active = page === "pdf-import";
  // Before a transcription, the pill names where Transcribe scan would send the pages.
  const pendingScanTo = usePendingScanDestination(active && scanPending);
  useEffect(() => {
    if (active) void refineAvailable().then(setRefineable);
  }, [active]);
  if (!active) return null;
  return (
    <div data-testid="pdf-import-view" className="flex h-full flex-col bg-background">
      <ImportHeader
        pdfLoaded={pdfLoaded}
        fullscreen={fullscreen}
        pendingScanTo={pendingScanTo}
        refineable={refineable}
        creating={creating}
        runCreate={runCreate}
      />
      {pdfLoaded ? (
        <>
          <ImportReviewBar />
          {scanPending && <ScanNotice />}
          <ImportPanes />
          <FiguresStrip />
        </>
      ) : (
        <PdfDropzoneLanding />
      )}
    </div>
  );
}
