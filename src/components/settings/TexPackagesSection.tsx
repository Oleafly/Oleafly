import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { LATEX_PACKAGES, type TaggingStatus } from "@/lib/latex-packages";
import { tlmgrSearch, type TexPackage } from "@/lib/tauri";
import { useEngineStore } from "@/store/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TAG_BADGE: Record<TaggingStatus, { label: string; className: string } | null> = {
  ok: null,
  caution: { label: "tagging: caution", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  breaks: { label: "breaks tagging", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

export function TexPackagesSection() {
  const { info, installed, busyPkg, packageError, addPackage, removePackage, refreshPackages } =
    useEngineStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TexPackage[] | null>(null);
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
      if (request === requestId.current) {
        const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
        setSearchError(detail || "Could not search TeX Live. Try again.");
      }
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

  return (
    <section aria-label="LaTeX packages">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packages</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        {available
          ? "These packages are for projects using latexmk (system TeX). Tectonic uses its own package bundle."
          : "Package management requires TeX Live or TinyTeX. For MiKTeX, use MiKTeX Console."}
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
          placeholder="Filter packages…"
          aria-label="Find LaTeX packages"
          maxLength={128}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!available || searching || !!busyPkg || normalized.length < 2}
        >
          {searching ? "Searching…" : "Search TeX Live"}
        </Button>
      </form>
      {(searchError || packageError) && (
        <div role="alert" className="mb-2 rounded-md border border-destructive/30 p-2 text-xs">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">
            {searchError || packageError}
          </pre>
          {packageError && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!!busyPkg || searching}
              onClick={() => void refreshPackages()}
            >
              Refresh installed packages
            </Button>
          )}
        </div>
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        {results
          ? `${results.length} TeX Live results${results.length === 200 ? ". Use a more specific search to narrow this list." : "."}`
          : "Suggested packages. Search TeX Live for more."}
      </p>
      <div className="max-h-72 overflow-auto rounded-md border">
        {rows.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            {results
              ? "No packages found. Try another name or keyword."
              : "No suggested packages match. Search TeX Live to check the full catalog."}
          </p>
        )}
        {rows.map((p) => {
          const packageName = p.texLivePackage ?? p.name;
          const on = installed.includes(packageName);
          const badge = p.tagging ? TAG_BADGE[p.tagging] : null;
          const busy = busyPkg === packageName;
          return (
            <div key={p.name} className="flex items-center gap-2 border-b px-2.5 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{p.name}</span>
                  {on && <Check className="size-3 text-emerald-500" />}
                  {badge && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]",
                        badge.className,
                      )}
                    >
                      {p.tagging === "breaks" && <AlertTriangle className="size-2.5" />}
                      {badge.label}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] text-muted-foreground">{p.description}</p>
                {packageName !== p.name && (
                  <p className="text-[11px] text-muted-foreground">
                    Included in {packageName}. Removing it also removes the other files in that package.
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
                {busy ? <Loader2 className="size-3 animate-spin" /> : on ? <X className="size-3" /> : null}
                {busy ? "" : on ? "Remove" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
