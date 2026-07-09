import { useEffect, useState } from "react";
import { AlertTriangle, Check, Cpu, Download, Loader2, Trash2, X } from "lucide-react";
import { useEngineStore } from "@/store/engine";
import { LATEX_PACKAGES, type TaggingStatus } from "@/lib/latex-packages";
import { cn } from "@/lib/utils";

const TAG_BADGE: Record<TaggingStatus, { label: string; className: string } | null> = {
  ok: null,
  caution: { label: "tagging: caution", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  breaks: { label: "breaks tagging", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

export function EngineSection() {
  const { info, installing, progress, installed, busyPkg, refresh, refreshPackages, install, remove, addPackage, removePackage } =
    useEngineStore();
  const [query, setQuery] = useState("");

  useEffect(() => {
    // Settings needs both the engine info and the (slow) installed-package list.
    void refresh().then(() => refreshPackages());
  }, [refresh, refreshPackages]);

  const kind = info?.kind ?? "none";
  const hasEngine = kind !== "none";
  const filtered = LATEX_PACKAGES.filter(
    (p) => p.name.includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tagged / accessible export</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The default engine (Tectonic) is fast and offline but cannot produce tagged, Section 508 / PDF-UA PDFs. That
          needs LuaLaTeX. OpenLeaf uses one you already have, or installs TinyTeX (about 100 MB) on demand. It lives in
          your home folder and needs no admin rights.
        </p>
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          {kind === "system" && <span className="text-sm">Using a system LuaLaTeX / TeX Live</span>}
          {kind === "tinytex" && <span className="text-sm">TinyTeX installed</span>}
          {kind === "none" && <span className="text-sm">No tagging engine installed</span>}
          {info?.version && <span className="ml-1 truncate text-xs text-muted-foreground">{info.version}</span>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {kind === "none" && (
            <button
              onClick={() => void install()}
              disabled={installing}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
            >
              {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {installing ? (progress != null ? `Installing… ${progress}%` : "Installing…") : "Install TinyTeX (~100 MB)"}
            </button>
          )}
          {kind === "tinytex" && (
            <button
              onClick={() => void remove()}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              <Trash2 className="size-3.5" /> Delete TinyTeX to free space
            </button>
          )}
          {kind === "system" && (
            <span className="text-xs text-muted-foreground">Detected on your system. Nothing to install.</span>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packages</h3>
        {!hasEngine && (
          <p className="mb-2 text-xs text-muted-foreground">Install an engine above to add or remove LaTeX packages.</p>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter packages…"
          className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="max-h-72 overflow-auto rounded-md border">
          {filtered.map((p) => {
            const on = installed.includes(p.name);
            const badge = TAG_BADGE[p.tagging];
            const busy = busyPkg === p.name;
            return (
              <div key={p.name} className="flex items-center gap-2 border-b px-2.5 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{p.name}</span>
                    {on && <Check className="size-3 text-emerald-500" />}
                    {badge && (
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]", badge.className)}>
                        {p.tagging === "breaks" && <AlertTriangle className="size-2.5" />}
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{p.description}</p>
                </div>
                <button
                  onClick={() => void (on ? removePackage(p.name) : addPackage(p.name))}
                  disabled={!hasEngine || !!busyPkg}
                  className={cn(
                    "inline-flex w-16 items-center justify-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-40",
                    on ? "border-input hover:bg-accent" : "border-input hover:bg-accent",
                  )}
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : on ? <X className="size-3" /> : null}
                  {busy ? "" : on ? "Remove" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
