import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Institution {
  id: string;
  display_name: string;
  country_code: string | null;
  type: string | null;
  works_count: number;
  cited_by_count: number;
  homepage_url: string | null;
  ror: string | null;
}

const COUNTRIES: [string, string][] = [
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
];

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

export function LabSearchPanel() {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("all");
  const [results, setResults] = useState<Institution[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useMemo(
    () => async (q: string, cc: string) => {
      if (!q.trim()) {
        setResults(null);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      setError(null);
      try {
        const filter = cc !== "all" ? `&filter=country_code:${cc}` : "";
        const url = `https://api.openalex.org/institutions?search=${encodeURIComponent(q.trim())}${filter}&per-page=24`;
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(`OpenAlex returned HTTP ${res.status}`);
        const data = await res.json();
        setResults(
          (data.results ?? []).map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ""),
            display_name: String(r.display_name ?? ""),
            country_code: (r.country_code as string) ?? null,
            type: (r.type as string) ?? null,
            works_count: Number(r.works_count ?? 0),
            cited_by_count: Number(r.cited_by_count ?? 0),
            homepage_url: (r.homepage_url as string) ?? null,
            ror: (r.ror as string) ?? null,
          })),
        );
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError(String(e instanceof Error ? e.message : e));
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => void search(query, country), 350);
    return () => clearTimeout(t);
  }, [query, country, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. computational neuroscience, MIT, Max Planck"
          aria-label="Search research institutions"
          className="max-w-md flex-1"
        />
        <Select value={country} onValueChange={setCountry}>
          <SelectTrigger className="w-44 text-xs" aria-label="Country filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map(([code, label]) => (
              <SelectItem key={code} value={code}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {busy && <span className="text-xs text-muted-foreground">Searching...</span>}
        {results && !busy && (
          <span className="text-xs text-muted-foreground">{results.length} results</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!results && !error && (
          <p className="text-sm text-muted-foreground">
            Search millions of research institutions worldwide. Queries go directly from your
            device to the open OpenAlex API, nothing passes through Oleafly's servers.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results?.map((r) => (
            <div key={r.id} className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                  {r.display_name}
                </span>
                {r.country_code && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {r.country_code}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {r.type ?? "institution"} · {fmt(r.works_count)} works · {fmt(r.cited_by_count)} citations
              </div>
              <div className="mt-2 flex items-center gap-3">
                {r.homepage_url && (
                  <a
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                    href={r.homepage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Website <ExternalLink className="size-3" />
                  </a>
                )}
                {r.ror && (
                  <a
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                    href={r.ror}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ROR record <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
