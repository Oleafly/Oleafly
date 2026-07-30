import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  ExternalLink,
  Globe2,
  Landmark,
  Loader2,
  MapPin,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/store/settings";

interface Institution {
  id: string;
  displayName: string;
  countryCode: string | null;
  type: string | null;
  worksCount: number;
  citedByCount: number;
  homepageUrl: string | null;
  rorUrl: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

interface InstitutionSearchResult {
  results: Institution[];
  total: number;
}

const COUNTRIES = [
  ["all", "All countries"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["CN", "China"],
  ["JP", "Japan"],
  ["IN", "India"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["CH", "Switzerland"],
  ["NL", "Netherlands"],
  ["KR", "South Korea"],
  ["SG", "Singapore"],
  ["BR", "Brazil"],
] as const;

const SUGGESTIONS = [
  {
    domain: "Artificial intelligence",
    query: "MIT Computer Science and Artificial Intelligence Laboratory",
  },
  {
    domain: "Genomics",
    query: "Broad Institute",
  },
  {
    domain: "Robotics",
    query: "Max Planck Institute for Intelligent Systems",
  },
  {
    domain: "Quantum research",
    query: "RIKEN Center for Quantum Computing",
  },
  {
    domain: "Ocean science",
    query: "Woods Hole Oceanographic Institution",
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function safeInstitutionUrl(value: unknown): string | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function buildInstitutionSearchUrl(
  query: string,
  country: string,
): string {
  const url = new URL("https://api.openalex.org/institutions");
  url.searchParams.set("search", query.trim());
  if (country !== "all") {
    url.searchParams.set("filter", `country_code:${country}`);
  }
  url.searchParams.set("per-page", "24");
  return url.href;
}

export function parseInstitutionSearchResult(
  value: unknown,
): InstitutionSearchResult {
  if (!isRecord(value)) return { results: [], total: 0 };
  const rawResults = Array.isArray(value.results) ? value.results : [];
  const institutions = rawResults.flatMap((candidate): Institution[] => {
    if (!isRecord(candidate)) return [];
    const id = stringOrNull(candidate.id);
    const displayName = stringOrNull(candidate.display_name);
    if (!id || !displayName) return [];
    const geo = isRecord(candidate.geo) ? candidate.geo : {};
    return [
      {
        id,
        displayName,
        countryCode: stringOrNull(candidate.country_code),
        type: stringOrNull(candidate.type),
        worksCount: finiteNumber(candidate.works_count),
        citedByCount: finiteNumber(candidate.cited_by_count),
        homepageUrl: safeInstitutionUrl(candidate.homepage_url),
        rorUrl: safeInstitutionUrl(candidate.ror),
        city: stringOrNull(geo.city),
        region: stringOrNull(geo.region),
        country: stringOrNull(geo.country),
      },
    ];
  });
  const meta = isRecord(value.meta) ? value.meta : {};
  const total = finiteNumber(meta.count);
  return {
    results: institutions,
    total: Math.max(total, institutions.length),
  };
}

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }
  return String(value);
}

function formatType(value: string | null): string {
  if (!value) return "Research institution";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

interface InstitutionVisualStyle {
  badge: string;
}

const DEFAULT_INSTITUTION_STYLE: InstitutionVisualStyle = {
  badge:
    "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

const INSTITUTION_STYLES: Record<string, InstitutionVisualStyle> = {
  education: {
    badge:
      "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  healthcare: {
    badge:
      "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  company: {
    badge:
      "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  facility: {
    badge:
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  government: {
    badge:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  nonprofit: {
    badge:
      "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  archive: {
    badge:
      "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
};

function institutionStyle(type: string | null): InstitutionVisualStyle {
  return type
    ? (INSTITUTION_STYLES[type.toLowerCase()] ??
        DEFAULT_INSTITUTION_STYLE)
    : DEFAULT_INSTITUTION_STYLE;
}

export function countryFlag(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return String.fromCodePoint(
    ...[...normalized].map(
      (character) => 127397 + character.charCodeAt(0),
    ),
  );
}

function countryLabel(code: string): string {
  return (
    COUNTRIES.find(([countryCode]) => countryCode === code)?.[1] ??
    code
  );
}

function institutionLocation(institution: Institution): string {
  const parts = [
    institution.city,
    institution.region,
    institution.country ??
      (institution.countryCode
        ? countryLabel(institution.countryCode)
        : null),
  ].filter(
    (part, index, values): part is string =>
      Boolean(part) && values.indexOf(part) === index,
  );
  return parts.join(", ") || "Location not listed";
}

function InstitutionCard({
  institution,
}: {
  institution: Institution;
}) {
  const openAlexUrl = safeInstitutionUrl(institution.id);
  const visualStyle = institutionStyle(institution.type);
  return (
    <article className="flex min-h-[15.5rem] flex-col rounded-lg border bg-gradient-to-br from-card via-card to-muted/25 p-5 shadow-sm">
      <div className="flex items-start gap-3.5">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300"
        >
          <Building2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug sm:text-lg">
            {institution.displayName}
          </h2>
          <p className="mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" />
            {institutionLocation(institution)}
          </p>
        </div>
        {institution.countryCode && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-background/80 px-2 py-1 text-[10px] font-semibold text-muted-foreground shadow-sm"
            title={countryLabel(institution.countryCode)}
          >
            <span className="text-sm leading-none" aria-hidden="true">
              {countryFlag(institution.countryCode)}
            </span>
            {institution.countryCode}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${visualStyle.badge}`}
        >
          {formatType(institution.type)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 divide-x border-y py-3">
        <div className="px-3 first:pl-0">
          <dt className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Works
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-blue-700 dark:text-blue-300">
            {formatCount(institution.worksCount)}
          </dd>
        </div>
        <div className="px-3">
          <dt className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Citations
          </dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-violet-700 dark:text-violet-300">
            {formatCount(institution.citedByCount)}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-1 pt-4">
        {institution.homepageUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
            asChild
          >
            <a
              href={institution.homepageUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Globe2 /> Website
              <ExternalLink className="opacity-60" />
            </a>
          </Button>
        )}
        {institution.rorUrl && (
          <Button type="button" variant="ghost" size="sm" asChild>
            <a
              href={institution.rorUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              ROR record
              <ExternalLink className="opacity-60" />
            </a>
          </Button>
        )}
        {openAlexUrl && (
          <Button type="button" variant="ghost" size="sm" asChild>
            <a
              href={openAlexUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenAlex
              <ExternalLink className="opacity-60" />
            </a>
          </Button>
        )}
      </div>
    </article>
  );
}

function LabSearchSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"
      role="status"
      aria-label="Searching institutions"
    >
      <div className="mb-4 h-4 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="min-h-[15.5rem] animate-pulse rounded-lg border p-5"
          >
            <div className="flex gap-3.5">
              <div className="size-11 rounded-lg bg-muted" />
              <div className="flex-1">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="mt-2.5 h-3 w-1/2 rounded bg-muted" />
              </div>
            </div>
            <div className="mt-5 h-6 w-32 rounded-full bg-muted" />
            <div className="mt-5 h-16 rounded bg-muted/70" />
            <div className="mt-4 h-8 w-36 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLabSearch({
  noResults,
  onTry,
}: {
  noResults: boolean;
  onTry: (query: string) => void;
}) {
  return (
    <div className="mx-auto grid min-h-[24rem] max-w-4xl place-items-center px-6 py-10">
      <div className="w-full border-y border-border/70 py-9">
        <div className="grid gap-8 sm:grid-cols-[1fr_1.15fr] sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {noResults ? "No matching institutions" : "Getting started"}
            </p>
            <h2 className="mt-2.5 text-2xl font-semibold tracking-tight">
              {noResults
                ? "No institutions match the current search."
                : "Search by institution name, acronym, or location."}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              {noResults
                ? "Try a shorter name, remove the country filter, or search for the institution's parent organization."
                : "Lab Search returns universities, hospitals, government institutes, companies, and independent research organizations listed by OpenAlex."}
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Institution examples
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
                    0{index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                      {suggestion.domain}
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

export function LabSearchPanel() {
  const offline = useSettingsStore((state) => state.offline);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [country, setCountry] = useState("all");
  const [results, setResults] = useState<Institution[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const runSearch = useCallback(
    async (nextQuery: string, nextCountry = country) => {
      const searchTerm = nextQuery.trim();
      if (!searchTerm) return;
      if (offline) {
        setError(
          "Offline mode is enabled. Lab Search requires network access.",
        );
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setQuery(searchTerm);
      setSubmittedQuery(searchTerm);
      setResults(null);
      setBusy(true);
      setError(null);

      try {
        const response = await fetch(
          buildInstitutionSearchUrl(searchTerm, nextCountry),
          { signal: controller.signal },
        );
        if (!response.ok) {
          if (response.status === 429) {
            throw new Error(
              "OpenAlex is receiving too many requests. Wait a moment and try again.",
            );
          }
          throw new Error(
            `OpenAlex could not complete the search. HTTP ${response.status}.`,
          );
        }
        const parsed = parseInstitutionSearchResult(await response.json());
        if (abortRef.current !== controller) return;
        setResults(parsed.results);
        setTotal(parsed.total);
      } catch (searchError) {
        if (
          searchError instanceof DOMException &&
          searchError.name === "AbortError"
        ) {
          return;
        }
        if (abortRef.current !== controller) return;
        setError(
          searchError instanceof TypeError
            ? "Could not reach OpenAlex. Check your connection and try again."
            : searchError instanceof Error
              ? searchError.message
              : "OpenAlex could not complete the search.",
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    },
    [country, offline],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const chooseCountry = (nextCountry: string) => {
    setCountry(nextCountry);
    if (submittedQuery) {
      void runSearch(submittedQuery, nextCountry);
    }
  };

  const trySuggestion = (suggestion: string) => {
    setQuery(suggestion);
    void runSearch(suggestion);
  };

  return (
    <div
      data-testid="lab-search-panel"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <section className="shrink-0 border-b bg-card/35">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Lab Search
            </p>
            <span className="h-4 w-px bg-border" />
            <span className="text-[11px] text-muted-foreground">
              OpenAlex institution directory
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Find research institutions worldwide
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Search institutional records and compare publication and citation
            counts. Open a website, ROR record, or OpenAlex profile for more
            detail.
          </p>

          <form
            onSubmit={submit}
            className="mt-5 flex items-center gap-2 rounded-lg border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
          >
            <Search className="ml-2 size-5 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by institution name, acronym, or location"
              aria-label="Search research institutions"
              className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
            />
            <Button
              type="submit"
              className="h-11 shrink-0 px-5 text-sm [&_svg]:size-5"
              disabled={busy || !query.trim() || offline}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Search />
              )}
              <span className="hidden sm:inline">
                {busy ? "Searching" : "Search"}
              </span>
            </Button>
          </form>

          <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Country
              <Select value={country} onValueChange={chooseCountry}>
                <SelectTrigger
                  className="h-9 w-48 bg-background text-sm font-normal normal-case tracking-normal"
                  aria-label="Country filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      <span className="inline-flex items-center gap-2">
                        {code !== "all" && (
                          <span className="text-base leading-none" aria-hidden="true">
                            {countryFlag(code)}
                          </span>
                        )}
                        {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary sm:self-auto">
              <Check className="size-3.5" />
              OpenAlex
            </div>
          </div>

          {offline && (
            <div className="mt-3 flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Offline mode is enabled. Lab Search requires network access.
            </div>
          )}
          {error && (
            <div className="mt-3 flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {busy ? (
          <LabSearchSkeleton />
        ) : results === null ? (
          <EmptyLabSearch noResults={false} onTry={trySuggestion} />
        ) : results.length === 0 ? (
          <EmptyLabSearch noResults onTry={trySuggestion} />
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
            <div
              className="flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-center sm:justify-between"
              aria-live="polite"
            >
              <p className="text-sm font-medium">
                {results.length} institutions shown
              </p>
              <p className="text-xs text-muted-foreground">
                {total.toLocaleString()} matches for “{submittedQuery}”
                {country !== "all" ? ` in ${countryLabel(country)}` : ""}
              </p>
            </div>
            <div className="grid gap-4 py-4 md:grid-cols-2">
              {results.map((institution) => (
                <InstitutionCard
                  key={institution.id}
                  institution={institution}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 border-t py-4 text-xs text-muted-foreground">
              <Landmark className="size-3.5 text-primary" />
              Publication and citation counts are supplied by OpenAlex.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
