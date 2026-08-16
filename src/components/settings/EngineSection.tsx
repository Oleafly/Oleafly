import { useEffect, useState } from "react";
import { AlertTriangle, Check, Cpu, Download, HardDrive, Info, Loader2, Trash2, X } from "lucide-react";
import { installPhaseLabel, useEngineStore } from "@/store/engine";
import { useSettingsStore, type DefaultLatexEngine } from "@/store/settings";
import { LATEX_PACKAGES, type TaggingStatus } from "@/lib/latex-packages";
import { texDistributions, type TexDistribution } from "@/lib/tauri";
import { isTauri } from "@tauri-apps/api/core";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ENGINE_CHOICES: Array<{
  id: DefaultLatexEngine;
  name: string;
  detail: string;
}> = [
  {
    id: "tectonic",
    name: "Tectonic (built in)",
    detail: "Ships with Oleafly. Fast, offline, zero setup. Covers plain LaTeX and most common packages.",
  },
  {
    id: "latexmk",
    name: "latexmk (system TeX)",
    detail:
      "For trusted projects only. Runs a local TeX distribution that can read files available to your account. Supports full package sets and multi-pass workflows. Host command execution remains a separate per-project permission.",
  },
];

// Plain-sentence summary of what a detected distribution ships and where
// Oleafly runs it from, for the info icon on each row.
function distroTooltip(distro: TexDistribution): string {
  const tools = [distro.latexmk && "latexmk", distro.tlmgr && "tlmgr"].filter(Boolean);
  const bundled =
    tools.length > 0
      ? `Bundled with ${tools.join(" and ")}.`
      : "No latexmk or tlmgr was found in this install.";
  return `${bundled} Oleafly runs its TeX tools from ${distro.bin_dir}.`;
}

const TAG_BADGE: Record<TaggingStatus, { label: string; className: string } | null> = {
  ok: null,
  caution: { label: "tagging: caution", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  breaks: { label: "breaks tagging", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

export function EngineSection() {
  const { info, installing, progress, installed, busyPkg, refresh, refreshPackages, install, remove, addPackage, removePackage } =
    useEngineStore();
  const defaultLatexEngine = useSettingsStore((s) => s.defaultLatexEngine);
  const setDefaultLatexEngine = useSettingsStore((s) => s.setDefaultLatexEngine);
  const installPhase = useEngineStore((s) => s.installPhase);
  const partialDownloadBytes = useEngineStore((s) => s.partialDownloadBytes);
  const [query, setQuery] = useState("");
  const [distros, setDistros] = useState<TexDistribution[]>([]);

  useEffect(() => {
    // refreshPackages() needs engine info from refresh() first, so run in sequence.
    void refresh().then(() => refreshPackages());
  }, [refresh, refreshPackages]);

  // Reload the distribution list whenever an install or removal lands, so the
  // freshly installed TinyTeX row replaces the download card immediately (and
  // returns after a removal).
  // biome-ignore lint/correctness/useExhaustiveDependencies: info triggers a reload after remove()
  useEffect(() => {
    if (installing || !isTauri()) return;
    void texDistributions().then(setDistros).catch(() => {});
  }, [installing, info]);

  const kind = info?.kind ?? "none";
  const hasEngine = kind !== "none";
  const filtered = LATEX_PACKAGES.filter(
    (p) => p.name.includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default compile engine</h3>
        <Tooltip
          wide
          side="right"
          label="Applies to new projects. Each project pins its own engine in project.json, so collaborators opening the same project compile it the same way regardless of this setting."
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>

      <div className="flex flex-col gap-2">
        {ENGINE_CHOICES.map((choice) => {
          const selected = defaultLatexEngine === choice.id;
          const missing = choice.id === "latexmk" && !info?.latexmk;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => setDefaultLatexEngine(choice.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
                selected && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" />
                <span className="text-sm">{choice.name}</span>
                {selected && <Check className="size-3.5 text-primary" />}
                {missing && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-2.5" /> no latexmk found
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{choice.detail}</p>
              {choice.id === "latexmk" && info?.latexmk && (
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{info.latexmk}</p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manage TeX distributions</h3>
        <Tooltip
          wide
          side="right"
          label="Everything the latexmk engine can use on this machine. TinyTeX installs into your home folder with no admin rights. System installs (MacTeX, TeX Live, MiKTeX) are detected automatically."
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>

      <div className="flex flex-col gap-2">
        {distros.length === 0 && (
          <p className="text-xs text-muted-foreground">No TeX distribution detected on this machine.</p>
        )}
        {distros.map((distro) => (
          <div key={distro.bin_dir} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <HardDrive className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">{distro.label}</span>
              <Tooltip wide side="right" label={distroTooltip(distro)}>
                <Info className="size-3.5 shrink-0 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
              </Tooltip>
              {distro.latexmk && (
                <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                  latexmk
                </span>
              )}
              {distro.tlmgr && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  tlmgr
                </span>
              )}
              {distro.kind === "oleafly-tinytex" && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] hover:bg-accent"
                >
                  <Trash2 className="size-3" /> Remove
                </button>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{distro.bin_dir}</p>
          </div>
        ))}
        {!distros.some((d) => d.kind === "oleafly-tinytex") && (
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Download className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">TinyTeX</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              A compact TeX Live in your home folder. The core download is about 250 MB.
              Journal templates can add packages later, up to about 1 GB in total.
              Installing ahead of time makes system LaTeX available when you explicitly choose it.
            </p>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => void install()}
                disabled={installing}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
              >
                {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                {installing
                  ? installPhaseLabel(installPhase, progress)
                  : partialDownloadBytes > 0
                    ? `Resume download (${Math.round(partialDownloadBytes / 1_000_000)} MB done)`
                    : "Download TinyTeX (~250 MB)"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tagged / accessible export</h3>
        <Tooltip
          wide
          side="right"
          label="The default engine (Tectonic) is fast and offline but cannot produce tagged, Section 508 / PDF-UA PDFs. That needs system LuaLaTeX, which can read local files available to your account and should be used only with trusted projects. Oleafly can use an existing distribution or managed TinyTeX."
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
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
            <span className="text-xs text-muted-foreground">
              Install TinyTeX under “Manage TeX distributions” above to enable tagged export.
            </span>
          )}
          {kind === "tinytex" && (
            <span className="text-xs text-muted-foreground">Provided by TinyTeX (managed above).</span>
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
        <Input
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
                <button type="button"
                  onClick={() => void (on ? removePackage(p.name) : addPackage(p.name))}
                  disabled={!hasEngine || !!busyPkg}
                  className={cn(
                    "inline-flex w-16 items-center justify-center gap-1 rounded border px-2 py-1 text-xs disabled:opacity-40",
                    "border-input hover:bg-accent",
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
