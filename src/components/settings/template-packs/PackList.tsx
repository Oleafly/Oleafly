import { memo, useMemo, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Info, RefreshCw } from "lucide-react";
import { Download, Search, Trash2 } from "@/components/icons/pack";
import { CheckBadge } from "@/components/ui/check-badge";
import { Input } from "@/components/ui/input";
import { SECTION_HEADING_CLASS, SectionHeading } from "@/components/ui/section-heading";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDownloadSize } from "@/lib/download-size";
import { formatNumber } from "@/lib/intl";
import type { PackInfo } from "@/lib/tauri";
import { groupPacks } from "@/lib/template-pack-browser";
import { cn } from "@/lib/utils";
import {
  ALL_CURATED,
  installCuratedPacks,
  installPack,
  packBusyKey,
  refreshPackCatalogInBackground,
  removePack,
  useTemplatePacksStore,
} from "@/store/template-packs";
import { PackCollage } from "./pack-images";

const OUTLINE_BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:border-ring focus-visible:bg-accent disabled:opacity-50";
const PRIMARY_BUTTON =
  "inline-flex min-w-24 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:bg-primary/85 disabled:opacity-60";

export { OUTLINE_BUTTON, PRIMARY_BUTTON };

const PackCard = memo(function PackCard({
  pack,
  busy,
  disabled,
  progress,
  onOpen,
}: Readonly<{
  pack: PackInfo;
  busy: boolean;
  disabled: boolean;
  progress: string;
  onOpen: (packId: string) => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const partial = !pack.installed && pack.installed_count > 0;
  return (
    <div
      data-testid={`pack-row-${pack.id}`}
      className="flex min-w-0 gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => onOpen(pack.id)}
        className="shrink-0 self-start rounded-md"
      >
        <PackCollage covers={pack.covers} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{pack.label}</span>
          {pack.installed && <CheckBadge tone="success" />}
        </div>
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
          {t(($) => $.settings.downloads.packs.count, { count: pack.count })}
          {pack.approx_bytes > 0 ? ` · ${formatDownloadSize(pack.approx_bytes)}` : ""}
          {partial
            ? ` · ${t(($) => $.settings.downloads.packs.installedCount, {
                installed: formatNumber(pack.installed_count),
                total: formatNumber(pack.count),
              })}`
            : ""}
        </p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {busy && progress ? progress : pack.description}
        </p>
        {pack.license_summary ? (
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground/80" title={pack.license_summary}>
            {pack.license_summary}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2.5">
          <button
            type="button"
            data-testid={`pack-open-${pack.id}`}
            onClick={() => onOpen(pack.id)}
            className={OUTLINE_BUTTON}
          >
            {t(($) => $.settings.downloads.packs.browse)}
          </button>
          {pack.installed ? (
            <button
              type="button"
              data-testid={`pack-remove-${pack.id}`}
              onClick={() => void removePack(pack.id)}
              disabled={disabled}
              className={OUTLINE_BUTTON}
            >
              {busy ? <Spinner size="sm" /> : <Trash2 className="size-3.5" />}
              {t(($) => $.common.actions.remove)}
            </button>
          ) : (
            <button
              type="button"
              data-testid={`pack-install-${pack.id}`}
              onClick={() => void installPack(pack.id)}
              disabled={disabled}
              className={PRIMARY_BUTTON}
            >
              {busy ? <Spinner size="sm" /> : <Download className="size-3.5" />}
              {t(($) => $.settings.downloads.actions.download)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export function PackList({
  onOpenPack,
  headingRef,
  initialQuery = "",
}: Readonly<{
  onOpenPack: (packId: string) => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  initialQuery?: string;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const packs = useTemplatePacksStore((s) => s.packs);
  const loaded = useTemplatePacksStore((s) => s.loaded);
  const busy = useTemplatePacksStore((s) => s.busy);
  const progress = useTemplatePacksStore((s) => s.progress);
  const refreshing = useTemplatePacksStore((s) => s.refreshing);
  const [query, setQuery] = useState(initialQuery);
  const sections = useMemo(() => groupPacks(packs, query), [packs, query]);
  const curated = useMemo(() => packs.filter((pack) => pack.group === "curated"), [packs]);
  const allCuratedInstalled = curated.length > 0 && curated.every((pack) => pack.installed);
  const anyBusy = busy !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h3 ref={headingRef} className={SECTION_HEADING_CLASS}>
            {t(($) => $.settings.downloads.templates.heading)}
          </h3>
          <Tooltip wide side="right" label={t(($) => $.settings.downloads.templates.tooltip)}>
            <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
          </Tooltip>
        </div>
        <Tooltip label={t(($) => $.settings.downloads.packs.refresh)}>
          <button
            type="button"
            data-testid="packs-refresh"
            aria-label={t(($) => $.settings.downloads.packs.refresh)}
            onClick={() => void refreshPackCatalogInBackground(true)}
            disabled={refreshing}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin motion-reduce:animate-none")} />
          </button>
        </Tooltip>
      </div>

      {packs.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            data-testid="packs-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(($) => $.settings.downloads.packs.searchPacks)}
            aria-label={t(($) => $.settings.downloads.packs.searchPacks)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}

      {loaded && packs.length === 0 && (
        <p className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
          {t(($) => $.settings.downloads.templates.empty)}
        </p>
      )}
      {packs.length > 0 && sections.length === 0 && (
        <p className="px-1 py-2 text-sm text-muted-foreground">{t(($) => $.settings.downloads.packs.noPacks)}</p>
      )}

      {sections.map((section) => (
        <section key={section.group} data-testid={`pack-group-${section.group}`} className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading as="h4">
              {t(($) => $.settings.downloads.packs.groups[section.group])}
            </SectionHeading>
            {section.group === "curated" && (
              <button
                type="button"
                data-testid="packs-download-curated"
                onClick={() => void installCuratedPacks()}
                disabled={anyBusy || allCuratedInstalled}
                className={OUTLINE_BUTTON}
              >
                {busy === ALL_CURATED ? <Spinner size="sm" /> : <Download className="size-3.5" />}
                {allCuratedInstalled
                  ? t(($) => $.settings.downloads.actions.allDownloaded)
                  : t(($) => $.settings.downloads.actions.downloadAll)}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {section.packs.map((pack) => {
              const packBusy =
                busy === packBusyKey(pack.id) ||
                (busy === ALL_CURATED && pack.group === "curated" && !pack.installed);
              return (
                <PackCard
                  key={pack.id}
                  pack={pack}
                  busy={packBusy}
                  disabled={anyBusy}
                  progress={packBusy ? progress : ""}
                  onOpen={onOpenPack}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
