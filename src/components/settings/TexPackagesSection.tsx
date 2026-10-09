import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { LATEX_PACKAGES, type TaggingStatus } from "@/lib/latex-packages";
import { tlmgrSearch, type TexPackage } from "@/lib/tauri";
import { packageErrorMessage, useEngineStore } from "@/store/engine";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScrollTopOnChange } from "@/hooks/use-scroll-top-on-change";
import { describeError } from "@/lib/app-error";
import { formatNumber } from "@/lib/intl";
import { Spinner } from "@/components/ui/spinner";
import { SectionHeading } from "@/components/ui/section-heading";
import { CheckBadge } from "@/components/ui/check-badge";

const TAG_BADGE: Record<TaggingStatus, { tone: "caution" | "breaks"; variant: BadgeVariant } | null> = {
  ok: null,
  caution: { tone: "caution", variant: "warning" },
  breaks: { tone: "breaks", variant: "destructive" },
};

export function TexPackagesSection() {
  const { t } = useTranslation(["common", "settings"]);
  const {
    info,
    installed,
    userInstalled,
    systemInstalled,
    packageNotice,
    busyPkg,
    packageError,
    addPackage,
    removePackage,
    refreshPackages,
  } = useEngineStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TexPackage[] | null>(null);
  const listRef = useScrollTopOnChange(results ?? query);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const requestId = useRef(0);
  const available = !!info?.tlmgr;

  useEffect(() => {
    if (!info?.tlmgr) setQuery("");
    requestId.current += 1;
    setResults(null);
    setSearchError(null);
    setSearching(false);
    return () => {
      requestId.current += 1;
    };
  }, [info?.tlmgr]);

  const search = async () => {
    if (!available || searching || query.trim().length < 2) return;
    const request = ++requestId.current;
    setSearching(true);
    setSearchError(null);
    try {
      const packages = await tlmgrSearch(query.trim());
      if (request === requestId.current) setResults(packages);
    } catch (error) {
      if (request === requestId.current) setSearchError(describeError(error));
    } finally {
      if (request === requestId.current) setSearching(false);
    }
  };

  const normalized = query.toLowerCase().trim();
  const rows =
    results?.map((p) => ({ ...p, texLivePackage: p.name, tagging: undefined })) ??
    LATEX_PACKAGES.filter(
      (p) =>
        p.name.includes(normalized) ||
        p.description.toLowerCase().includes(normalized) ||
        p.texLivePackage?.includes(normalized),
    );

  const resultsSummary = (): string => {
    if (!results) return t(($) => $.settings.engine.packages.suggested);
    if (results.length === 200) {
      return t(($) => $.settings.engine.packages.resultsCapped, {
        total: formatNumber(results.length),
      });
    }
    return t(($) => $.settings.engine.packages.results, { count: results.length });
  };

  const toggleLabel = (on: boolean): string =>
    on ? t(($) => $.common.actions.remove) : t(($) => $.common.actions.add);

  return (
    <section aria-label={t(($) => $.settings.engine.packages.ariaLabel)}>
      <SectionHeading className="mb-2">
        {t(($) => $.settings.engine.packages.heading)}
      </SectionHeading>
      <p className="mb-2 text-xs text-muted-foreground">
        {available
          ? t(($) => $.settings.engine.packages.intro.available)
          : t(($) => $.settings.engine.packages.intro.unavailable)}
      </p>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Input
          value={query}
          onChange={(event) => {
            requestId.current += 1;
            setQuery(event.target.value);
            setResults(null);
            setSearchError(null);
            setSearching(false);
          }}
          placeholder={t(($) => $.settings.engine.packages.filterPlaceholder)}
          aria-label={t(($) => $.settings.engine.packages.filterAriaLabel)}
          maxLength={128}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!available || searching || !!busyPkg || normalized.length < 2}
        >
          {searching
            ? t(($) => $.settings.engine.packages.searching)
            : t(($) => $.settings.engine.packages.search)}
        </Button>
      </form>
      {(searchError || packageError) && (
        <div role="alert" className="mb-2 rounded-md border border-destructive/30 p-2 text-xs">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">
            {searchError || (packageError && packageErrorMessage(packageError))}
          </pre>
          {packageError && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!!busyPkg || searching}
              onClick={() => void refreshPackages()}
            >
              {t(($) => $.settings.engine.packages.refreshInstalled)}
            </Button>
          )}
        </div>
      )}
      {packageNotice && (
        <output className="block mb-2 rounded-md border bg-muted/30 p-2 text-xs">
          {packageNotice}
        </output>
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        {resultsSummary()}
      </p>
      <div ref={listRef} className="max-h-72 overflow-auto rounded-md border">
        {rows.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            {results
              ? t(($) => $.settings.engine.packages.emptySearch)
              : t(($) => $.settings.engine.packages.emptySuggested)}
          </p>
        )}
        {rows.map((p) => {
          const packageName = p.texLivePackage ?? p.name;
          const on = installed.includes(packageName);
          const inUserTree = userInstalled.includes(packageName);
          const inSystemTree = systemInstalled.includes(packageName);
          const treeFor = (): string | null => {
            if (!on) return null;
            if (inUserTree && inSystemTree) return t(($) => $.settings.engine.packages.tree.both);
            if (inUserTree) return t(($) => $.settings.engine.packages.tree.user);
            return t(($) => $.settings.engine.packages.tree.system);
          };
          const tree = treeFor();
          const badge = p.tagging ? TAG_BADGE[p.tagging] : null;
          const busy = busyPkg === packageName;
          return (
            <div key={p.name} className="flex items-center gap-2 border-b px-2.5 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{p.name}</span>
                  {on && <CheckBadge tone="success" className="size-3.5" />}
                  {tree && (
                    <Badge variant="muted" size="sm">
                      {tree}
                    </Badge>
                  )}
                  {badge && (
                    <Badge variant={badge.variant} size="sm" className="gap-1">
                      {p.tagging === "breaks" && <AlertTriangle className="size-2.5" />}
                      {t(($) => $.settings.engine.packages.badge[badge.tone])}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-[0.6875rem] text-muted-foreground">{p.description}</p>
                {packageName !== p.name && (
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {t(($) => $.settings.engine.packages.includedIn, { package: packageName })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchError(null);
                  void (on ? removePackage(packageName) : addPackage(packageName));
                }}
                disabled={!available || !!busyPkg || searching}
                className="inline-flex w-16 items-center justify-center gap-1 rounded border border-input px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
              >
                {busy ? <Spinner size="xs" /> : null}
                {!busy && on ? <X className="size-3" /> : null}
                {busy ? "" : toggleLabel(on)}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
