import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Plus,
  ScanSearch,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  clearDocumentScanCache,
  documentScanCacheKey,
  loadDocumentCitationSettings,
  loadDocumentScanCache,
  saveDocumentCitationSettings,
  saveDocumentScanCache,
  scanDocumentForCitations,
  type DocumentCitationSettings,
  type DocumentScanProgress,
  type ParagraphCitationResult,
  type RankedLiteraturePaper,
} from "@/lib/document-citation";
import {
  LITERATURE_SOURCES,
  bibtexForLiteratureRecord,
  type LiteratureSource,
} from "@/lib/literature-search";
import { addCitation } from "@/features/citation";
import { useFilesStore } from "@/store/files";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useLiteratureLibraryStore } from "@/store/literature";
import { useSettingsStore } from "@/store/settings";
import { getConfig } from "@/lib/tauri";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { toast } from "@/lib/toast";

const SOURCE_DOT: Record<LiteratureSource, string> = {
  arxiv: "bg-red-500",
  "semantic-scholar": "bg-blue-600",
  crossref: "bg-cyan-600",
  pubmed: "bg-indigo-600",
  openalex: "bg-violet-500",
  "google-scholar": "bg-emerald-600",
  uspto: "bg-orange-600",
};

const SOURCE_LABEL = new Map(
  LITERATURE_SOURCES.map((source) => [source.id, source]),
);

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(value);
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} +${authors.length - 3}`;
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}.`);
  }
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  }
  if (score >= 60) {
    return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
  }
  return "bg-muted text-muted-foreground";
}

function isLatexPath(path: string | null | undefined): boolean {
  return !!path && /\.tex$/i.test(path);
}

function SourceBadge({ source }: { source: LiteratureSource }) {
  const definition = SOURCE_LABEL.get(source);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/35 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", SOURCE_DOT[source])} />
      {definition?.shortLabel ?? source}
    </span>
  );
}

function SuggestionCard({
  suggestion,
}: {
  suggestion: RankedLiteraturePaper;
}) {
  const { record, score, reasoning } = suggestion;
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const projectId = useFilesStore((state) => state.projectId);
  const saved = useLiteratureLibraryStore((state) => state.has(record));
  const saveCitation = useLiteratureLibraryStore((state) => state.save);

  const primaryUrl =
    record.url ||
    (record.doi ? `https://doi.org/${record.doi}` : null) ||
    (record.sourceIds.arxiv
      ? `https://arxiv.org/abs/${record.sourceIds.arxiv}`
      : null);

  const handleSave = () => {
    const already = useLiteratureLibraryStore.getState().has(record);
    saveCitation(record);
    toast.success(already ? "Saved citation updated" : "Citation saved");
  };

  const handleAddToBib = async () => {
    // Citation Search is a home tool; after closeProject there is no open
    // project/.bib. Never toast success unless a project can actually receive
    // the write (addCitation otherwise returns { key } without persisting).
    if (!useFilesStore.getState().projectId) {
      toast.error("Open a project to append to a bibliography file");
      return;
    }
    setAdding(true);
    try {
      const result = await addCitation(bibtexForLiteratureRecord(record));
      if ("key" in result) {
        toast.success(`Added \\cite{${result.key}}`);
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not add citation.",
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <article className="group rounded-lg border border-border/70 bg-background/80 px-3 py-3.5 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {record.sources.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
          {record.year != null && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {record.year}
            </span>
          )}
          {record.citationCount != null && (
            <span className="text-[11px] text-muted-foreground">
              {formatCount(record.citationCount)} citations
            </span>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            scoreBadgeClass(score),
          )}
          title="Relevance score"
        >
          {Math.round(score)}
        </span>
      </div>

      {primaryUrl ? (
        <a
          href={primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline text-sm font-semibold leading-snug text-foreground decoration-primary/40 underline-offset-4 hover:text-primary hover:underline sm:text-base"
        >
          {record.title}
          <ExternalLink className="ml-1 inline size-3.5 -translate-y-px opacity-0 transition-opacity group-hover:opacity-60" />
        </a>
      ) : (
        <h3 className="text-sm font-semibold leading-snug sm:text-base">
          {record.title}
        </h3>
      )}

      <p className="mt-1 truncate text-xs text-muted-foreground sm:text-sm">
        {formatAuthors(record.authors)}
      </p>

      {reasoning && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setReasoningOpen((open) => !open)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {reasoningOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            FOR / AGAINST
          </button>
          {reasoningOpen && (
            <div className="mt-2 space-y-2 rounded-md border bg-muted/25 px-3 py-2.5 text-xs leading-relaxed">
              <div>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  FOR
                </span>
                <p className="mt-0.5 text-muted-foreground">{reasoning.for}</p>
              </div>
              <div>
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  AGAINST
                </span>
                <p className="mt-0.5 text-muted-foreground">
                  {reasoning.against}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant={saved ? "secondary" : "outline"}
          size="sm"
          data-testid="document-citation-save"
          onClick={handleSave}
        >
          {saved ? <BookmarkCheck /> : <Bookmark />}
          {saved ? "Saved" : "Save citation"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            void copyText(bibtexForLiteratureRecord(record), "BibTeX")
          }
        >
          <Copy /> Copy BibTeX
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="document-citation-add-bib"
          disabled={adding}
          onClick={() => void handleAddToBib()}
          title={
            projectId
              ? "Append to project bibliography and insert \\cite"
              : "Open a project to append to a bibliography file"
          }
        >
          {adding ? <Loader2 className="animate-spin" /> : <Plus />}
          Add to .bib
        </Button>
      </div>
    </article>
  );
}

function ParagraphGroup({ result }: { result: ParagraphCitationResult }) {
  const [open, setOpen] = useState(true);
  const suggestionCount = result.suggestions.length;

  return (
    <section className="border-b border-border/70 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2 px-2 py-3.5 text-left hover:bg-muted/30 sm:px-3"
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Paragraph {result.paragraphIndex + 1}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {suggestionCount}{" "}
              {suggestionCount === 1 ? "suggestion" : "suggestions"}
            </span>
            {result.query && (
              <span className="truncate text-[11px] text-muted-foreground/80">
                query: {result.query}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">
            {result.paragraphPreview}
          </p>
        </div>
      </button>

      {open && (
        <div className="space-y-2.5 px-2 pb-4 sm:px-3">
          {result.sourceErrors.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{result.sourceErrors.join(" ")}</span>
            </div>
          )}
          {suggestionCount === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">
              No new candidates above the score threshold for this paragraph.
            </p>
          ) : (
            result.suggestions.map((suggestion) => (
              <SuggestionCard
                key={`${result.paragraphIndex}-${suggestion.record.id}`}
                suggestion={suggestion}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

export function DocumentCitationScanPanel() {
  const offline = useSettingsStore((state) => state.offline);
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const mainDoc = useFilesStore((state) => state.mainDoc);
  const files = useFilesStore((state) => state.files);
  const tree = useFilesStore((state) => state.tree);

  const [settings, setSettings] = useState<DocumentCitationSettings>(() =>
    loadDocumentCitationSettings(),
  );
  /** null until getConfig resolves; unknown is treated as heuristic. */
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DocumentScanProgress | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphCitationResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Editor selection (or captured doc text) passed via command entry points. */
  const [selectionSource, setSelectionSource] = useState<string | null>(null);
  /** .bib snapshot from command palette path (before closeProject clears files). */
  const [bibSource, setBibSource] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const override =
      useDocumentCitationUiStore.getState().consumeSelectionOverride();
    if (override) setSelectionSource(override);
    const bib =
      useDocumentCitationUiStore.getState().consumeBibOverride();
    if (bib) setBibSource(bib);
  }, []);

  useEffect(() => {
    const apply = (configured: boolean) => setProviderReady(configured);
    const check = (event?: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail;
      if (detail && typeof detail === "object") {
        try {
          apply(hasConfiguredProvider(detail as never));
          return;
        } catch {
          // fall through to getConfig
        }
      }
      void getConfig()
        .then((config) => apply(hasConfiguredProvider(config)))
        .catch(() => apply(false));
    };
    check();
    window.addEventListener("oleafly:ai-config-changed", check);
    return () => {
      window.removeEventListener("oleafly:ai-config-changed", check);
      abortRef.current?.abort();
    };
  }, []);

  const { sourcePath, sourceText } = useMemo(() => {
    if (selectionSource) {
      return {
        sourcePath: "selection",
        sourceText: selectionSource,
      };
    }
    if (activePath && isLatexPath(activePath)) {
      const content = files[activePath]?.content;
      if (content != null) {
        return {
          sourcePath: activePath,
          sourceText: content,
        };
      }
    }
    return {
      sourcePath: mainDoc,
      sourceText: files[mainDoc]?.content ?? "",
    };
  }, [activePath, files, mainDoc, selectionSource]);

  const bibText = useMemo(() => {
    if (bibSource) return bibSource;
    return tree
      .filter((entry) => !entry.is_dir && entry.path.endsWith(".bib"))
      .map((entry) => files[entry.path]?.content ?? "")
      .filter(Boolean)
      .join("\n\n");
  }, [bibSource, tree, files]);

  // Selection/doc overrides remain scannable after the home-tool navigation
  // closes the open project (files store is cleared).
  const canScan =
    !offline &&
    sourceText.trim().length > 0 &&
    !scanning &&
    providerReady !== null &&
    (!!projectId || !!selectionSource);

  const updateSetting = useCallback(
    <K extends keyof DocumentCitationSettings>(
      key: K,
      value: DocumentCitationSettings[K],
    ) => {
      const next = saveDocumentCitationSettings({ [key]: value });
      setSettings(next);
    },
    [],
  );

  const clearResults = () => {
    setParagraphs([]);
    setProgress(null);
    setError(null);
    clearDocumentScanCache();
  };

  const cancelScan = () => {
    abortRef.current?.abort();
  };

  const runScan = async (opts?: { ignoreCache?: boolean }) => {
    if (!canScan) return;
    if (offline) {
      setError(
        "Offline mode is enabled. Document citation scan requires network access.",
      );
      return;
    }
    if (!sourceText.trim()) {
      setError("No LaTeX source text is available to scan.");
      return;
    }

    const rankMode = providerReady === true ? "llm" : "heuristic";
    const cacheKey = documentScanCacheKey({
      sourceText,
      bibText,
      settings,
      rankMode,
    });

    if (!opts?.ignoreCache) {
      const cached = loadDocumentScanCache(cacheKey);
      if (cached) {
        setParagraphs(cached.paragraphs);
        setProgress({
          phase: "complete",
          completedParagraphs: cached.totalParagraphs,
          totalParagraphs: cached.totalParagraphs,
          message: "Restored cached scan results",
        });
        setError(null);
        return;
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setError(null);
    setParagraphs([]);
    setProgress({
      phase: "splitting",
      completedParagraphs: 0,
      totalParagraphs: 0,
      message: "Splitting document into paragraphs…",
    });

    try {
      const result = await scanDocumentForCitations({
        sourceText,
        bibText,
        settings,
        rankMode,
        signal: controller.signal,
        onProgress: (next) => setProgress(next),
        onParagraph: (paragraph) => {
          setParagraphs((current) => [...current, paragraph]);
        },
      });
      saveDocumentScanCache(cacheKey, result);
    } catch (scanError) {
      const isAbort =
        scanError instanceof Error && scanError.name === "AbortError";
      if (isAbort) {
        setProgress((current) =>
          current
            ? {
                ...current,
                phase: "error",
                message: "Scan cancelled",
              }
            : current,
        );
      } else {
        setError(
          scanError instanceof Error
            ? scanError.message
            : String(scanError),
        );
      }
    } finally {
      setScanning(false);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  };

  // E2E / DEV: inject canned scan results without network or LLM.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __e2eDocumentCitation?: {
        seedResults: (results: ParagraphCitationResult[]) => void;
        setSourceOverride: (text: string) => void;
        getParagraphCount: () => number;
      };
    };
    w.__e2eDocumentCitation = {
      seedResults: (results) => {
        setParagraphs(results);
        setProgress({
          phase: "complete",
          completedParagraphs: results.length,
          totalParagraphs: results.length,
          message: "Seeded e2e results",
        });
        setError(null);
        setScanning(false);
      },
      setSourceOverride: (text) => {
        setSelectionSource(text);
      },
      getParagraphCount: () => paragraphs.length,
    };
    return () => {
      delete w.__e2eDocumentCitation;
    };
  }, [paragraphs.length]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="document-citation-scan-panel"
    >
      <section className="shrink-0 border-b bg-card/20">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                From document
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Scan prose paragraphs
                {selectionSource ? (
                  <>
                    {" "}
                    from{" "}
                    <span className="font-medium text-foreground/90">
                      editor selection
                    </span>
                  </>
                ) : (
                  <>
                    {" "}
                    in{" "}
                    <span className="font-mono text-foreground/90">
                      {sourcePath || "main.tex"}
                    </span>
                  </>
                )}{" "}
                and rank literature suggestions for each.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {scanning ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelScan}
                >
                  <Square className="size-3.5" />
                  Cancel
                </Button>
              ) : null}
              {paragraphs.length > 0 && !scanning && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearResults}
                >
                  <Trash2 />
                  Clear
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                data-testid="document-citation-scan"
                disabled={!canScan}
                onClick={() => void runScan()}
              >
                {scanning ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ScanSearch />
                )}
                {scanning ? "Scanning" : "Find citations"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-md border bg-background/80 p-3">
            <label
              htmlFor="document-citation-score-threshold"
              className="grid gap-1.5 text-xs font-medium text-muted-foreground"
            >
              Score threshold
              <Input
                id="document-citation-score-threshold"
                type="number"
                min={0}
                max={100}
                value={settings.scoreThreshold}
                onChange={(event) =>
                  updateSetting(
                    "scoreThreshold",
                    Number(event.target.value) || 0,
                  )
                }
                className="h-9 w-28 text-sm"
                disabled={scanning}
              />
            </label>
            <label
              htmlFor="document-citation-max-per-paragraph"
              className="grid gap-1.5 text-xs font-medium text-muted-foreground"
            >
              Max per paragraph
              <Input
                id="document-citation-max-per-paragraph"
                type="number"
                min={1}
                max={20}
                value={settings.maxResultsPerParagraph}
                onChange={(event) =>
                  updateSetting(
                    "maxResultsPerParagraph",
                    Number(event.target.value) || 1,
                  )
                }
                className="h-9 w-28 text-sm"
                disabled={scanning}
              />
            </label>
            <label
              htmlFor="document-citation-max-paragraphs"
              className="grid gap-1.5 text-xs font-medium text-muted-foreground"
            >
              Max paragraphs
              <Input
                id="document-citation-max-paragraphs"
                type="number"
                min={1}
                max={40}
                value={settings.maxParagraphs}
                onChange={(event) =>
                  updateSetting(
                    "maxParagraphs",
                    Number(event.target.value) || 1,
                  )
                }
                className="h-9 w-28 text-sm"
                disabled={scanning}
              />
            </label>
          </div>

          {offline && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Offline mode is enabled. Document citation scan requires network
              access.
            </div>
          )}
          {!offline && !projectId && !selectionSource && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Open a LaTeX project to scan document paragraphs for citations, or
              run Find citations in document from the editor.
            </div>
          )}
          {!offline && !sourceText.trim() && (projectId || selectionSource) && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Source document is empty or not loaded. Open a{" "}
              <span className="font-mono">.tex</span> file to scan.
            </div>
          )}
          {providerReady === false && !offline && (
            <div className="flex items-start gap-2.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5 text-sm text-sky-900 dark:text-sky-300">
              <Info className="mt-0.5 size-4 shrink-0" />
              Ranking will use citation counts only until an AI provider is
              configured.
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <X className="size-4" />
              </button>
            </div>
          )}
          {(scanning || progress) && progress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {scanning && <Loader2 className="size-4 animate-spin shrink-0" />}
              <span>
                {progress.message ??
                  (progress.totalParagraphs > 0
                    ? `Processing ${progress.completedParagraphs}/${progress.totalParagraphs} paragraphs…`
                    : "Preparing scan…")}
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {paragraphs.length === 0 && !scanning ? (
          <div className="mx-auto flex min-h-[18rem] max-w-2xl flex-col justify-center px-6 py-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Document scan
            </p>
            <h2 className="mt-2.5 text-2xl font-semibold tracking-tight">
              Find citation candidates from your prose.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Each paragraph is searched across scholarly indexes, filtered
              against your bibliography, and ranked for relevance. Save a result
              to your literature library, or copy BibTeX.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6">
            <div className="flex items-center justify-between border-b border-border/70 px-2 py-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {paragraphs.length}
                </span>{" "}
                paragraph
                {paragraphs.length === 1 ? "" : "s"} with results
                {progress?.totalParagraphs
                  ? ` · ${progress.totalParagraphs} total`
                  : ""}
              </p>
              {scanning && (
                <span className="text-xs text-muted-foreground">
                  Scanning…
                </span>
              )}
            </div>
            {paragraphs.map((result) => (
              <ParagraphGroup
                key={result.paragraphIndex}
                result={result}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
