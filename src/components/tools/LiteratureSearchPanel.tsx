import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Info,
  KeyRound,
  Loader2,
  Pause,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LITERATURE_SOURCES,
  LITERATURE_SOURCES,
  bibtexForLiteratureRecord,
  literatureIdentity,
  searchLiterature,
  type LiteratureRecord,
  type LiteratureSearchResponse,
  type LiteratureSource,
  type LiteratureSourceRun,
} from "@/lib/literature-search";
import {
  useLiteratureLibraryStore,
  type SavedLiteratureCitation,
} from "@/store/literature";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useSettingsStore } from "@/store/settings";
import { toast } from "@/lib/toast";
import { i18n } from "@/i18n";
import {
  ANY_PUBLICATION_YEAR,
  publicationYearOptions,
  publicationYearRange,
} from "@/lib/publication-year";
import { DocumentCitationScanPanel } from "@/components/tools/DocumentCitationScanPanel";
import { PaperReviewPanel } from "@/components/tools/PaperReviewPanel";

const SUGGESTIONS = [
  {
    domain: () => i18n.t(($) => $.researchTools.literature.suggestion.artificialIntelligence),
    query: "multimodal reasoning model hallucinations",
  },
  {
    domain: () => i18n.t(($) => $.researchTools.literature.suggestion.cancerBiology),
    query: "spatial transcriptomics tumor microenvironment",
  },
  {
    domain: () => i18n.t(($) => $.researchTools.literature.suggestion.climateScience),
    query: "ocean alkalinity enhancement carbon removal",
  },
  {
    domain: () => i18n.t(($) => $.researchTools.literature.suggestion.materialsScience),
    query: "perovskite silicon tandem solar cells",
  },
  {
    domain: () => i18n.t(($) => $.researchTools.literature.suggestion.quantumPhysics),
    query: "fault tolerant quantum error correction",
  },
] as const;

const PUBLICATION_YEARS = publicationYearOptions();

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
  if (authors.length === 0) {
    return i18n.t(($) => $.researchTools.literature.unknownAuthors);
  }
  if (authors.length <= 3) return authors.join(", ");
  return i18n.t(($) => $.researchTools.literature.moreAuthors, {
    authors: authors.slice(0, 3).join(", "),
    more: authors.length - 3,
  });
}

function sourceError(run: LiteratureSourceRun): string {
  const label = SOURCE_LABEL.get(run.source)?.label ?? run.source;
  const message =
    run.error ?? i18n.t(($) => $.researchTools.literature.sourceFailed, { label });
  return message.toLowerCase().startsWith(label.toLowerCase())
    ? message
    : i18n.t(($) => $.researchTools.literature.sourceMessage, { label, message });
}

async function copyBibtex(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(i18n.t(($) => $.researchTools.literature.toastCopied));
  } catch {
    toast.error(i18n.t(($) => $.researchTools.literature.toastCopyFailed));
  }
}

function SourceBadge({
  source,
  compact = false,
}: Readonly<{
  source: LiteratureSource;
  compact?: boolean;
}>) {
  const definition = SOURCE_LABEL.get(source);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border/80 bg-muted/35 font-medium text-muted-foreground",
        compact
          ? "gap-1.5 px-2 py-0.5 text-[10px]"
          : "gap-1.5 px-2.5 py-1 text-xs",
      )}
    >
      <span className={cn("size-1.5 rounded-full", SOURCE_DOT[source])} />
      {compact ? definition?.shortLabel : definition?.label}
    </span>
  );
}

function SourceInformation() {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <Popover
      trigger={<Info className="size-4" />}
      ariaLabel={t(($) => $.researchTools.literature.sourcesAbout)}
      align="left"
      className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(29rem,calc(100vw-2rem))] overscroll-contain overflow-y-auto p-0"
    >
      <div className="border-b px-4 py-3.5">
        <h2 className="text-base font-semibold">
          {t(($) => $.researchTools.literature.sourcesTitle)}
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.researchTools.literature.sourcesNote)}
        </p>
      </div>
      <div className="divide-y">
        {LITERATURE_SOURCES.map((source) => (
          <div key={source.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{source.label}</p>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  source.available
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
              >
                {source.available ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  <Pause className="size-3" aria-hidden="true" />
                )}
                {source.available
                  ? t(($) => $.researchTools.literature.available)
                  : t(($) => $.researchTools.literature.paused)}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {source.description}
            </p>
          </div>
        ))}
      </div>
    </Popover>
  );
}

function SourceSelector({
  selected,
  onToggle,
}: Readonly<{
  selected: LiteratureSource[];
  onToggle: (source: LiteratureSource) => void;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {t(($) => $.researchTools.literature.sources)}
      </span>
      <SourceInformation />
      {LITERATURE_SOURCES.map((source) => {
        if (!source.available) {
          return (
            <Tooltip
              key={source.id}
              label={source.description}
              side="bottom"
              wide
            >
              <span
                aria-disabled="true"
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1.5 text-xs font-medium text-muted-foreground/65"
              >
                <Pause className="size-3.5 opacity-65" aria-hidden="true" />
                {source.label}
                <span className="text-[9px] uppercase tracking-wide">
                  {t(($) => $.researchTools.literature.pausedTag)}
                </span>
              </span>
            </Tooltip>
          );
        }
        const active = selected.includes(source.id);
        return (
          <Tooltip
            key={source.id}
            label={source.description}
            side="bottom"
            wide
          >
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(source.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active
                  ? "border-primary/35 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {active && <Check className="size-3.5" aria-hidden="true" />}
              {source.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function SourceRunSummary({ runs }: Readonly<{ runs: LiteratureSourceRun[] }>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const runSummaryLabel = (run: LiteratureSourceRun) =>
    run.total != null
      ? t(($) => $.researchTools.literature.runSummaryIndexed, {
          results: run.count,
          indexed: formatCount(run.total),
          duration: run.durationMs,
        })
      : t(($) => $.researchTools.literature.runSummary, {
          results: run.count,
          duration: run.durationMs,
        });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {runs.map((run) => {
        const label = SOURCE_LABEL.get(run.source)?.shortLabel ?? run.source;
        return (
          <Tooltip
            key={run.source}
            label={run.status === "error" ? sourceError(run) : runSummaryLabel(run)}
            wide
          >
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px]",
                run.status === "error"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground",
              )}
            >
              {run.status === "error" ? (
                <AlertTriangle className="size-3.5" />
              ) : (
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              )}
              {label}
              {run.status === "ok" && <span>{run.count}</span>}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ResultRow({
  record,
  saved,
  onSave,
  onRemove,
  bibtex,
}: Readonly<{
  record: LiteratureRecord;
  saved: boolean;
  onSave?: () => void;
  onRemove?: () => void;
  bibtex?: string;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const copyRecordBibtex = () =>
    void copyBibtex(bibtex ?? bibtexForLiteratureRecord(record));
  return (
    <article className="group border-b border-border/70 px-1 py-5 last:border-b-0 sm:px-2">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {record.sources.map((source) => (
              <SourceBadge key={source} source={source} compact />
            ))}
            {record.year && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {record.year}
              </span>
            )}
            {record.openAccess === true && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                {t(($) => $.researchTools.literature.openAccess)}
              </span>
            )}
          </div>
          {record.url ? (
            <a
              href={record.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline text-base font-semibold leading-snug text-foreground decoration-primary/40 underline-offset-4 hover:text-primary hover:underline sm:text-lg"
            >
              {record.title}
              <ExternalLink className="ml-1 inline size-3.5 -translate-y-px opacity-0 transition-opacity group-hover:opacity-60" />
            </a>
          ) : (
            <h3 className="text-base font-semibold leading-snug sm:text-lg">
              {record.title}
            </h3>
          )}
          <p className="mt-1.5 truncate text-sm text-muted-foreground">
            {formatAuthors(record.authors)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {record.venue && <span>{record.venue}</span>}
            {record.type && (
              <>
                <span aria-hidden="true">·</span>
                <span>{record.type.replaceAll("-", " ")}</span>
              </>
            )}
            {record.citationCount != null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t(($) => $.researchTools.literature.citationCount, {
                    citations: formatCount(record.citationCount),
                  })}
                </span>
              </>
            )}
            {record.doi && (
              <>
                <span aria-hidden="true">·</span>
                <span className="break-all font-mono">{`doi:${record.doi}`}</span>
              </>
            )}
          </div>
          {record.abstract && (
            <p className="mt-2.5 line-clamp-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
              {record.abstract}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {onRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 /> {t(($) => $.researchTools.literature.removeCitation)}
              </Button>
            ) : (
              <Button
                type="button"
                variant={saved ? "secondary" : "outline"}
                size="sm"
                onClick={onSave}
              >
                {saved ? <BookmarkCheck /> : <Bookmark />}
                {saved
                  ? t(($) => $.researchTools.literature.savedCitation)
                  : t(($) => $.researchTools.literature.saveCitation)}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={copyRecordBibtex}
            >
              <Copy /> {t(($) => $.researchTools.literature.copyBibtex)}
            </Button>
            {record.pdfUrl && (
              <Button type="button" variant="ghost" size="sm" asChild>
                <a
                  href={record.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText /> {t(($) => $.researchTools.literature.openPdf)}
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ResultSkeleton() {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <output
      className="block space-y-0"
      aria-label={t(($) => $.researchTools.literature.loadingAria)}
    >
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="animate-pulse border-b border-border/70 px-2 py-5"
        >
          <div className="h-3 w-28 rounded bg-muted" />
          <div className="mt-3 h-4 w-[min(42rem,85%)] rounded bg-muted" />
          <div className="mt-2 h-3 w-[min(28rem,60%)] rounded bg-muted" />
          <div className="mt-4 h-6 w-40 rounded bg-muted" />
        </div>
      ))}
    </output>
  );
}

function EmptySearch({
  onTry,
  noResults,
}: Readonly<{
  onTry: (query: string) => void;
  noResults: boolean;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <div className="mx-auto grid min-h-[23rem] max-w-4xl place-items-center px-6 py-10">
      <div className="w-full border-y border-border/70 py-9">
        <div className="grid gap-8 sm:grid-cols-[1fr_1.15fr] sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {noResults
                ? t(($) => $.researchTools.literature.noResultsEyebrow)
                : t(($) => $.researchTools.literature.gettingStarted)}
            </p>
            <h2 className="mt-2.5 text-2xl font-semibold tracking-tight">
              {noResults
                ? t(($) => $.researchTools.literature.noResultsHeading)
                : t(($) => $.researchTools.literature.startHeading)}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              {noResults
                ? t(($) => $.researchTools.literature.noResultsBody)
                : t(($) => $.researchTools.literature.startBody)}
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t(($) => $.researchTools.literature.topics)}
            </p>
            <div className="flex flex-col items-start gap-1">
              {SUGGESTIONS.map((suggestion, index) => (
                <button
                  key={suggestion.query}
                  type="button"
                  onClick={() => onTry(suggestion.query)}
                  className="group flex w-full items-center gap-3 border-b border-border/60 py-2.5 text-left text-sm text-muted-foreground transition-colors last:border-b-0 hover:text-foreground"
                >
                  <span className="font-mono text-[11px] text-muted-foreground/60">
                    {`0${index + 1}`}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                      {suggestion.domain()}
                    </span>
                    <span className="mt-0.5 block text-foreground/85">
                      {suggestion.query}
                    </span>
                  </span>
                  <Search className="size-3.5 opacity-0 transition-opacity group-hover:opacity-70" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SavedLibrary({
  saved,
  onRemove,
}: Readonly<{
  saved: SavedLiteratureCitation[];
  onRemove: (id: string) => void;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  if (saved.length === 0) {
    return (
      <div className="mx-auto flex min-h-[23rem] max-w-2xl flex-col justify-center px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {t(($) => $.researchTools.literature.libraryEyebrow)}
        </p>
        <h2 className="mt-2.5 text-2xl font-semibold tracking-tight">
          {t(($) => $.researchTools.literature.libraryHeading)}
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {t(($) => $.researchTools.literature.libraryBody)}
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6">
      <div className="flex items-center justify-between border-b border-border/70 px-2 py-3">
        <p className="text-sm text-muted-foreground">
          {t(($) => $.researchTools.literature.libraryCount, {
            count: saved.length,
          })}
        </p>
        <span className="text-xs text-muted-foreground">
          {t(($) => $.researchTools.literature.libraryLabel)}
        </span>
      </div>
      {saved.map((citation) => (
        <ResultRow
          key={citation.id}
          record={citation.record}
          bibtex={citation.bibtex}
          saved
          onRemove={() => onRemove(citation.id)}
        />
      ))}
    </div>
  );
}

function PublicationYearSelect({
  id,
  value,
  onValueChange,
  minimum,
  maximum,
}: Readonly<{
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  minimum?: number;
  maximum?: number;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="h-9 w-32 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={ANY_PUBLICATION_YEAR}>
          {t(($) => $.researchTools.literature.anyYear)}
        </SelectItem>
        {PUBLICATION_YEARS.map((year) => {
          const numericYear = Number(year);
          return (
            <SelectItem
              key={year}
              value={year}
              disabled={
                (minimum != null && numericYear < minimum) ||
                (maximum != null && numericYear > maximum)
              }
            >
              {year}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function LiteratureSearchPanel() {
  const { t } = useTranslation(["common", "researchTools"]);
  const offline = useSettingsStore((state) => state.offline);
  const saved = useLiteratureLibraryStore((state) => state.saved);
  const saveCitation = useLiteratureLibraryStore((state) => state.save);
  const removeCitation = useLiteratureLibraryStore((state) => state.remove);
  const modeRequest = useDocumentCitationUiStore((state) => state.modeRequest);
  const [mode, setMode] = useState<"search" | "document" | "review">(() =>
    useDocumentCitationUiStore.getState().modeRequest === "document"
      ? "document"
      : "search",
  );
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState("");
  const [selectedSources, setSelectedSources] = useState<LiteratureSource[]>(
    DEFAULT_LITERATURE_SOURCES,
  );
  const [yearFrom, setYearFrom] = useState(ANY_PUBLICATION_YEAR);
  const [yearTo, setYearTo] = useState(ANY_PUBLICATION_YEAR);
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [limit, setLimit] = useState("12");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] =
    useState<LiteratureSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Honor command-palette / selection entry points that request document mode.
  useEffect(() => {
    if (modeRequest !== "document") return;
    setMode("document");
    setTab("search");
    // Reset so a later manual open of Citation Search defaults to search.
    useDocumentCitationUiStore.setState({ modeRequest: "search" });
  }, [modeRequest]);

  const savedIds = useMemo(
    () => new Set(saved.map((citation) => citation.id)),
    [saved],
  );
  const sourceErrors = response?.runs.filter((run) => run.status === "error") ?? [];

  const runSearch = async (nextQuery?: string, ignoreCache = false) => {
    const searchQuery = (nextQuery ?? query).trim();
    if (!searchQuery) return;
    if (offline) {
      setError(t(($) => $.researchTools.literature.offline));
      return;
    }
    if (selectedSources.length === 0) {
      setError(t(($) => $.researchTools.literature.selectSource));
      return;
    }
    const yearRange = publicationYearRange(yearFrom, yearTo);
    if (yearRange.normalizedFrom !== yearFrom) {
      setYearFrom(yearRange.normalizedFrom);
    }
    if (yearRange.normalizedTo !== yearTo) {
      setYearTo(yearRange.normalizedTo);
    }
    if (yearRange.error) {
      setError(yearRange.error);
      return;
    }
    setQuery(searchQuery);
    setLoading(true);
    setError(null);
    setTab("search");
    try {
      const result = await searchLiterature({
        query: searchQuery,
        sources: selectedSources,
        limit: Number(limit),
        yearFrom: yearRange.from,
        yearTo: yearRange.to,
        openAccessOnly,
        ignoreCache,
      });
      setResponse(result);
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : String(searchError),
      );
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const toggleSource = (source: LiteratureSource) => {
    setSelectedSources((current) =>
      current.includes(source)
        ? current.filter((candidate) => candidate !== source)
        : [...current, source],
    );
  };

  const openSourceSettings = () => {
    const settings = useSettingsStore.getState();
    settings.setSettingsInitialSection("integrations");
    settings.setSettingsScrollTarget("citation-search");
    settings.setSettingsOpen(true);
  };

  const searchControls = () => (
    <>
      <form
        onSubmit={submit}
        className="mt-5 flex items-center gap-2 rounded-lg border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
      >
        <Search className="ml-2 size-5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(($) => $.researchTools.literature.queryPlaceholder)}
          aria-label={t(($) => $.researchTools.literature.queryAria)}
          className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
        />
        <Button
          type="submit"
          className="h-11 shrink-0 px-5 text-sm [&_svg]:size-5"
          disabled={
            loading ||
            !query.trim() ||
            selectedSources.length === 0 ||
            offline
          }
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Search />
          )}
          <span className="hidden sm:inline">
            {loading
              ? t(($) => $.researchTools.literature.searching)
              : t(($) => $.researchTools.literature.search)}
          </span>
        </Button>
      </form>

      <div className="mt-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <SourceSelector
          selected={selectedSources}
          onToggle={toggleSource}
        />
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant={filtersOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal />
            {t(($) => $.researchTools.literature.filters)}
            {(yearFrom !== ANY_PUBLICATION_YEAR ||
              yearTo !== ANY_PUBLICATION_YEAR ||
              openAccessOnly) && (
              <span className="size-1.5 rounded-full bg-primary" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openSourceSettings}
          >
            <KeyRound />
            {t(($) => $.researchTools.literature.sourceSetup)}
          </Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mt-3 space-y-3 rounded-md border bg-background/80 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label
              htmlFor="literature-year-from"
              className="grid gap-1.5 text-xs font-medium text-muted-foreground"
            >
              {t(($) => $.researchTools.literature.yearFrom)}
              <PublicationYearSelect
                id="literature-year-from"
                value={yearFrom}
                onValueChange={setYearFrom}
                maximum={
                  yearTo === ANY_PUBLICATION_YEAR
                    ? undefined
                    : Number(yearTo)
                }
              />
            </label>
            <label
              htmlFor="literature-year-to"
              className="grid gap-1.5 text-xs font-medium text-muted-foreground"
            >
              {t(($) => $.researchTools.literature.yearTo)}
              <PublicationYearSelect
                id="literature-year-to"
                value={yearTo}
                onValueChange={setYearTo}
                minimum={
                  yearFrom === ANY_PUBLICATION_YEAR
                    ? undefined
                    : Number(yearFrom)
                }
              />
            </label>
            <label
              htmlFor="literature-result-limit"
              className="grid gap-1.5 text-xs font-medium text-muted-foreground"
            >
              {t(($) => $.researchTools.literature.resultsPerSource)}
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger
                  id="literature-result-limit"
                  className="h-9 w-32 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">
                    {t(($) => $.researchTools.literature.resultOption, { results: 8 })}
                  </SelectItem>
                  <SelectItem value="12">
                    {t(($) => $.researchTools.literature.resultOption, { results: 12 })}
                  </SelectItem>
                  <SelectItem value="20">
                    {t(($) => $.researchTools.literature.resultOption, { results: 20 })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label
              htmlFor="literature-open-access"
              className="mb-0.5 flex h-9 items-center gap-2.5 rounded-md border px-3 text-xs font-medium text-muted-foreground"
            >
              <Switch
                id="literature-open-access"
                checked={openAccessOnly}
                onCheckedChange={setOpenAccessOnly}
                aria-label={t(($) => $.researchTools.literature.openAccessOnly)}
              />
              {t(($) => $.researchTools.literature.openAccessOnly)}
            </label>
          </div>
        </div>
      )}

      {offline && (
        <div className="mt-3 flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {t(($) => $.researchTools.literature.offline)}
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}
    </>
  );

  const documentTabs = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b bg-background">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6">
            <TabsList className="h-12 rounded-none bg-transparent p-0">
              <TabsTrigger
                value="search"
                className="h-12 rounded-none border-b-2 border-transparent px-4 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {t(($) => $.researchTools.literature.tabSuggestions)}
              </TabsTrigger>
              <TabsTrigger
                value="saved"
                className="h-12 rounded-none border-b-2 border-transparent px-4 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {t(($) => $.researchTools.literature.tabMyCitations)}
                {saved.length > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums">
                    {saved.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>
        <TabsContent
          value="search"
          className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <DocumentCitationScanPanel />
        </TabsContent>
        <TabsContent
          value="saved"
          className="m-0 min-h-0 flex-1 overflow-y-auto"
        >
          <SavedLibrary saved={saved} onRemove={removeCitation} />
        </TabsContent>
      </Tabs>
    </div>
  );

  const searchResultTabs = () => (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6">
          <TabsList className="h-12 rounded-none bg-transparent p-0">
            <TabsTrigger
              value="search"
              className="h-12 rounded-none border-b-2 border-transparent px-4 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {t(($) => $.researchTools.literature.tabSearch)}
              {response && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums">
                  {response.results.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="saved"
              className="h-12 rounded-none border-b-2 border-transparent px-4 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {t(($) => $.researchTools.literature.tabMyCitations)}
              {saved.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums">
                  {saved.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          {response && !loading && (
            <div className="hidden min-w-0 items-center gap-3 md:flex">
              <SourceRunSummary runs={response.runs} />
              <Tooltip label={t(($) => $.researchTools.literature.refreshTooltip)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t(($) => $.researchTools.literature.refreshAria)}
                  onClick={() => void runSearch(undefined, true)}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      <TabsContent
        value="search"
        className="m-0 min-h-0 flex-1 overflow-y-auto"
      >
        {loading ? (
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <ResultSkeleton />
          </div>
        ) : null}
        {!loading && !response ? (
          <EmptySearch
            noResults={false}
            onTry={(suggestion) => {
              setQuery(suggestion);
              void runSearch(suggestion);
            }}
          />
        ) : null}
        {!loading && response && (response.results.length === 0 ? (
          <div>
            {sourceErrors.length > 0 && (
              <div className="mx-auto mt-5 flex max-w-3xl items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {sourceErrors.map(sourceError).join(" ")}
                </span>
              </div>
            )}
            <EmptySearch
              noResults
              onTry={(suggestion) => {
                setQuery(suggestion);
                void runSearch(suggestion);
              }}
            />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 py-2 sm:px-6">
            <div className="flex flex-col gap-2 border-b border-border/70 px-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                <Trans
                  ns="researchTools"
                  i18nKey={($) => $.researchTools.literature.resultsFor}
                  values={{ results: response.results.length, query }}
                  components={{ strong: <span className="font-medium text-foreground" /> }}
                />
              </p>
              <div className="flex items-center gap-3 md:hidden">
                <SourceRunSummary runs={response.runs} />
              </div>
            </div>
            {sourceErrors.length > 0 && (
              <div className="mx-2 mt-3 flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {sourceErrors.map(sourceError).join(" ")}
                </span>
              </div>
            )}
            {response.results.map((record) => {
              const id = literatureIdentity(record);
              const isSaved = savedIds.has(id);
              return (
                <ResultRow
                  key={id}
                  record={record}
                  saved={isSaved}
                  onSave={() => {
                    saveCitation(record);
                    toast.success(
                      isSaved
                        ? t(($) => $.researchTools.literature.toastUpdated)
                        : t(($) => $.researchTools.literature.toastSaved),
                    );
                  }}
                />
              );
            })}
          </div>
        ))}
      </TabsContent>

      <TabsContent
        value="saved"
        className="m-0 min-h-0 flex-1 overflow-y-auto"
      >
        <SavedLibrary saved={saved} onRemove={removeCitation} />
      </TabsContent>
    </Tabs>
  );

  return (
    <div
      data-testid="literature-search-panel"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <section className="shrink-0 border-b bg-card/35">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                {t(($) => $.researchTools.literature.eyebrow)}
              </p>
              <span className="h-4 w-px bg-border" />
              <span className="text-[11px] text-muted-foreground">
                {t(($) => $.researchTools.literature.openSource)}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {t(($) => $.researchTools.literature.heading)}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {t(($) => $.researchTools.literature.intro)}
            </p>
          </div>

          <div
            className="mt-4 flex flex-wrap gap-1 rounded-lg border p-1 w-fit"
            data-testid="citation-search-mode"
          >
            <Button
              type="button"
              size="sm"
              variant={mode === "search" ? "secondary" : "ghost"}
              onClick={() => {
                setMode("search");
                setTab("search");
              }}
            >
              {t(($) => $.researchTools.literature.modeSearch)}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "document" ? "secondary" : "ghost"}
              data-testid="citation-search-mode-document"
              onClick={() => {
                setMode("document");
                setTab("search");
              }}
            >
              {t(($) => $.researchTools.literature.modeDocument)}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "review" ? "secondary" : "ghost"}
              data-testid="citation-search-mode-review"
              onClick={() => {
                setMode("review");
                setTab("search");
              }}
            >
              {t(($) => $.researchTools.literature.modeReview)}
            </Button>
          </div>

          {mode === "search" && searchControls()}
        </div>
      </section>

      {mode === "document" ? documentTabs() : null}
      {mode !== "document" && mode === "review" ? <PaperReviewPanel /> : null}
      {mode !== "document" && mode !== "review" && searchResultTabs()}
    </div>
  );
}
