import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, Search, Trash2 } from "lucide-react";
import { CheckBadge } from "@/components/ui/check-badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { useElementColumns } from "@/hooks/use-element-columns";
import { currentLocale } from "@/i18n";
import { formatDownloadSize } from "@/lib/download-size";
import { formatNumber } from "@/lib/intl";
import type { PackInfo, PackTemplateInfo } from "@/lib/tauri";
import {
  capitalized,
  displayName,
  engineLabel,
  filterTemplates,
  templateFacets,
} from "@/lib/template-pack-browser";
import { cn } from "@/lib/utils";
import {
  busyInPack,
  ensurePackIndex,
  ensurePackListed,
  installPack,
  packBusyKey,
  removePack,
  templateBusyKey,
  useTemplatePacksStore,
} from "@/store/template-packs";
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from "./PackList";
import { LazyImage, PAGE_ASPECT, PagePlaceholder } from "./pack-images";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog";

const ANY = "__any__";
const CARD_MIN_REM = 9;
const CARD_GAP_REM = 0.75;
const FALLBACK_COLUMNS = 4;
const OVERSCAN_ROWS = 2;
const UNMEASURED_ROWS = 4;
const EMPTY: readonly PackTemplateInfo[] = [];

const TemplateCard = memo(function TemplateCard({
  packId,
  template,
  onOpen,
}: Readonly<{
  packId: string;
  template: PackTemplateInfo;
  onOpen: (templateId: string) => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const busy = useTemplatePacksStore((s) => s.busy === templateBusyKey(packId, template.id));
  const engine = engineLabel(template.engine);
  return (
    <div {...{ [ROW_WINDOW_ITEM]: "" }} className="min-w-0 pb-4" data-testid={`pack-template-${template.id}`}>
      <button
        type="button"
        onClick={() => onOpen(template.id)}
        title={template.description || template.name}
        className="group flex w-full min-w-0 flex-col text-left"
      >
        <span
          className={cn(
            "relative block w-full overflow-hidden rounded-md border bg-muted transition-colors group-hover:border-primary/50 group-focus-visible:border-primary group-focus-visible:bg-accent",
            PAGE_ASPECT,
          )}
        >
          {template.thumb_url ? (
            <LazyImage key={template.thumb_url} src={template.thumb_url} fallback={<PagePlaceholder />} />
          ) : (
            <PagePlaceholder />
          )}
          {template.installed && (
            <span className="absolute right-1.5 top-1.5">
              <CheckBadge tone="success" />
              <span className="sr-only">{t(($) => $.settings.downloads.packs.installed)}</span>
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Spinner />
            </span>
          )}
        </span>
        <span className="mt-2 block truncate text-xs font-medium text-foreground">{template.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.625rem] text-muted-foreground">
          {engine ? (
            <span className="shrink-0 rounded bg-muted px-1 py-px font-medium uppercase tracking-wide">
              {engine}
            </span>
          ) : null}
          <span className="truncate">{template.license.label}</span>
        </span>
      </button>
    </div>
  );
});

function TemplateGrid({
  packId,
  templates,
  onOpen,
}: Readonly<{
  packId: string;
  templates: readonly PackTemplateInfo[];
  onOpen: (templateId: string) => void;
}>) {
  const listRef = useRef<HTMLDivElement>(null);
  const columns = useElementColumns(listRef, CARD_MIN_REM, CARD_GAP_REM, FALLBACK_COLUMNS);
  const rowCount = Math.ceil(templates.length / columns);
  const rows = useRowWindow({
    count: rowCount,
    listRef,
    overscan: OVERSCAN_ROWS,
    unmeasuredCount: UNMEASURED_ROWS,
  });
  const first = rows.start * columns;
  return (
    <div
      ref={listRef}
      data-testid="pack-template-grid"
      className="grid gap-x-3"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        paddingTop: rows.paddingTop,
        paddingBottom: rows.paddingBottom,
      }}
    >
      {templates.slice(first, rows.end * columns).map((template) => (
        <TemplateCard key={template.id} packId={packId} template={template} onOpen={onOpen} />
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  testId,
}: Readonly<{
  label: string;
  allLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  testId: string;
}>) {
  return (
    <Select value={value || ANY} onValueChange={(next) => onChange(next === ANY ? "" : next)}>
      <SelectTrigger aria-label={label} data-testid={testId} className="h-8 w-auto min-w-32 gap-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[100] max-h-80">
        <SelectItem value={ANY}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PackLoading() {
  const { t } = useTranslation(["settings"]);
  return (
    <p className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground" data-testid="pack-loading">
      <Spinner size="sm" />
      {t(($) => $.settings.downloads.packs.loading)}
    </p>
  );
}

type LinkCheck = "first" | "reloading" | "final";

function PackHeader({ pack, onBack }: Readonly<{ pack: PackInfo; onBack: () => void }>) {
  const { t } = useTranslation(["common", "settings"]);
  const busy = useTemplatePacksStore((s) => s.busy);
  const progress = useTemplatePacksStore((s) => s.progress);
  const packBusy = busy === packBusyKey(pack.id);
  const partial = !pack.installed && pack.installed_count > 0;
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-testid="pack-back"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
      >
        <ArrowLeft className="size-3.5" />
        {t(($) => $.settings.downloads.packs.back)}
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold" data-testid="pack-title">
              {pack.label}
            </h3>
            {pack.installed && <CheckBadge tone="success" />}
          </div>
          {pack.description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{pack.description}</p>
          ) : null}
          <p className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
            {t(($) => $.settings.downloads.packs.count, { count: pack.count })}
            {pack.approx_bytes > 0 ? ` · ${formatDownloadSize(pack.approx_bytes)}` : ""}
            {pack.license_summary ? ` · ${pack.license_summary}` : ""}
            {partial
              ? ` · ${t(($) => $.settings.downloads.packs.installedCount, {
                  installed: formatNumber(pack.installed_count),
                  total: formatNumber(pack.count),
                })}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            {pack.installed_count > 0 && (
              <button
                type="button"
                data-testid={`pack-view-remove-${pack.id}`}
                onClick={() => void removePack(pack.id)}
                disabled={busy !== null}
                className={OUTLINE_BUTTON}
              >
                <Trash2 className="size-3.5" />
                {t(($) => $.common.actions.remove)}
              </button>
            )}
            {!pack.installed && (
              <button
                type="button"
                data-testid={`pack-view-install-${pack.id}`}
                onClick={() => void installPack(pack.id)}
                disabled={busy !== null}
                className={PRIMARY_BUTTON}
              >
                {packBusy ? <Spinner size="sm" /> : <Download className="size-3.5" />}
                {t(($) => $.settings.downloads.packs.downloadPack)}
              </button>
            )}
          </div>
          {progress && busyInPack(busy, pack) ? (
            <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{progress}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PackView({
  packId,
  link = null,
  onBack,
  onMissing,
}: Readonly<{
  packId: string;
  link?: Readonly<{ templateId: string; serial: number }> | null;
  onBack: () => void;
  onMissing?: (packId: string) => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const pack = useTemplatePacksStore((s) => s.packs.find((candidate) => candidate.id === packId));
  const entry = useTemplatePacksStore((s) => s.indexes[packId]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [engine, setEngine] = useState("");
  const [kind, setKind] = useState("");
  const [language, setLanguage] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [awaitedId, setAwaitedId] = useState(link?.templateId ?? null);
  const [linkCheck, setLinkCheck] = useState<LinkCheck>("first");
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const linkSerial = link?.serial ?? null;

  useEffect(() => {
    if (linkSerial !== null) return;
    void ensurePackIndex(packId);
  }, [packId, linkSerial]);

  useEffect(() => {
    if (linkSerial === null) return;
    let active = true;
    void ensurePackListed(packId).then((listed) => {
      if (!active) return;
      if (listed) void ensurePackIndex(packId);
      else onMissing?.(packId);
    });
    return () => {
      active = false;
    };
  }, [packId, linkSerial, onMissing]);

  const ready = entry?.status === "ready" ? entry : null;

  useEffect(() => {
    if (awaitedId === null || !ready || linkCheck === "reloading") return;
    if (ready.templates.some((template) => template.id === awaitedId)) {
      setPreviewId(awaitedId);
      setLinkedId(awaitedId);
      setAwaitedId(null);
    } else if (linkCheck === "first") {
      setLinkCheck("reloading");
      void ensurePackIndex(packId, { force: true }).then(() => setLinkCheck("final"));
    } else {
      setQuery(awaitedId);
      setAwaitedId(null);
    }
  }, [awaitedId, ready, linkCheck, packId]);
  const templates = ready?.templates ?? EMPTY;
  const facets = useMemo(() => templateFacets(templates), [templates]);
  const filtered = useMemo(
    () =>
      ready
        ? filterTemplates(ready.templates, ready.search, { query: deferredQuery, engine, kind, language })
        : EMPTY,
    [ready, deferredQuery, engine, kind, language],
  );
  const locale = currentLocale();
  const languageOptions = useMemo(
    () =>
      facets.languages.map((code) => ({ value: code, label: displayName(code, "language", locale) })),
    [facets.languages, locale],
  );
  const engineOptions = useMemo(
    () => facets.engines.map((value) => ({ value, label: value })),
    [facets.engines],
  );
  const kindOptions = useMemo(
    () => facets.kinds.map((value) => ({ value, label: capitalized(value) })),
    [facets.kinds],
  );
  const closePreview = useCallback(() => {
    setPreviewId(null);
    setLinkedId(null);
  }, []);

  if (!pack) return link ? <PackLoading /> : null;

  return (
    <div className="flex flex-col gap-4" data-testid={`pack-view-${pack.id}`}>
      <PackHeader pack={pack} onBack={onBack} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            data-testid="pack-templates-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(($) => $.settings.downloads.packs.searchTemplates)}
            aria-label={t(($) => $.settings.downloads.packs.searchTemplates)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        {engineOptions.length > 1 && (
          <FilterSelect
            testId="pack-filter-engine"
            label={t(($) => $.settings.downloads.packs.engineFilter)}
            allLabel={t(($) => $.settings.downloads.packs.allEngines)}
            value={engine}
            options={engineOptions}
            onChange={setEngine}
          />
        )}
        {kindOptions.length > 0 && (
          <FilterSelect
            testId="pack-filter-kind"
            label={t(($) => $.settings.downloads.packs.kindFilter)}
            allLabel={t(($) => $.settings.downloads.packs.allKinds)}
            value={kind}
            options={kindOptions}
            onChange={setKind}
          />
        )}
        {languageOptions.length > 0 && (
          <FilterSelect
            testId="pack-filter-language"
            label={t(($) => $.settings.downloads.packs.languageFilter)}
            allLabel={t(($) => $.settings.downloads.packs.allLanguages)}
            value={language}
            options={languageOptions}
            onChange={setLanguage}
          />
        )}
      </div>

      {entry?.status === "loading" || entry === undefined ? <PackLoading /> : null}
      {entry?.status === "error" ? (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-3 text-sm text-muted-foreground" data-testid="pack-load-failed">
          <span className="flex-1">{t(($) => $.settings.downloads.packs.loadFailed)}</span>
          <button
            type="button"
            onClick={() => void ensurePackIndex(packId, { force: true })}
            className={OUTLINE_BUTTON}
          >
            {t(($) => $.settings.downloads.packs.retry)}
          </button>
        </div>
      ) : null}
      {ready && filtered.length === 0 ? (
        <p className="px-1 py-6 text-sm text-muted-foreground">{t(($) => $.settings.downloads.packs.noTemplates)}</p>
      ) : null}
      {ready && filtered.length > 0 ? (
        <TemplateGrid packId={pack.id} templates={filtered} onOpen={setPreviewId} />
      ) : null}

      {ready && previewId !== null ? (
        <TemplatePreviewDialog
          pack={pack}
          templates={filtered}
          allTemplates={ready.templates}
          templateId={previewId}
          linked={previewId === linkedId}
          onNavigate={setPreviewId}
          onClose={closePreview}
        />
      ) : null}
    </div>
  );
}
