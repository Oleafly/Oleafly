import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, Check, Download, FileText, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BOOK_COLOR_OPTIONS, DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logError } from "@/lib/log";
import {
  ensureTemplateAssets,
  templatePreview,
  type AssetProgress,
  type TemplateInfo,
} from "@/lib/tauri";

// Preferred category order (anything else falls to the end, alphabetically).
const CATEGORY_ORDER = [
  "Blank",
  "CVs & Resumes",
  "Journals & Conferences",
  "Bibliographies",
  "Assignments",
  "Theses & Reports",
  "Books",
  "Presentations",
  "Posters",
  "Newsletters",
  "Calendars",
  "Letters",
];

// Cache preview data URIs so switching steps or categories doesn't refetch.
const previewCache = new Map<string, string | null>();

function useTemplatePreview(t: TemplateInfo): string | null {
  const [uri, setUri] = useState<string | null>(() => previewCache.get(t.id) ?? null);
  useEffect(() => {
    if (!t.has_preview) return;
    if (previewCache.has(t.id)) {
      setUri(previewCache.get(t.id) ?? null);
      return;
    }
    let alive = true;
    void templatePreview(t.id)
      .then((u) => {
        previewCache.set(t.id, u);
        if (alive) setUri(u);
      })
      .catch(() => {
        previewCache.set(t.id, null);
      });
    return () => {
      alive = false;
    };
  }, [t.id, t.has_preview]);
  return uri;
}

/** The page-1 thumbnail, or a graceful placeholder that still reads as a page. */
function Preview({ t, className }: { t: TemplateInfo; className?: string }) {
  const uri = useTemplatePreview(t);
  if (uri) {
    return (
      <img
        src={uri}
        alt={`${t.name} preview`}
        className={cn("h-full w-full bg-white object-cover object-top", className)}
        draggable={false}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1.5 bg-white text-neutral-300",
        className,
      )}
    >
      <FileText className="size-7" />
      <span className="px-3 text-center text-[10px] font-medium text-neutral-400">{t.name}</span>
    </div>
  );
}

function AtsBadge({ profile }: { profile: TemplateInfo["ats_profile"] }) {
  if (profile === "friendly")
    return (
      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        ATS-friendly
      </span>
    );
  if (profile === "design-forward")
    return (
      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500">
        Design-forward
      </span>
    );
  return null;
}

export function NewProjectDialog({
  open,
  templates,
  busy = false,
  onClose,
  onCreate,
}: {
  open: boolean;
  templates: TemplateInfo[];
  busy?: boolean;
  onClose: () => void;
  onCreate: (name: string, templateId: string, color: string) => void | Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_BOOK_COLOR);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [atsOnly, setAtsOnly] = useState(false);
  const [setup, setSetup] = useState<{ active: boolean; label: string }>({
    active: false,
    label: "",
  });
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset the wizard whenever it opens.
  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedId(null);
      setName("");
      setColor(DEFAULT_BOOK_COLOR);
      setSearch("");
      setCategory("All");
      setAtsOnly(false);
      setSetup({ active: false, label: "" });
    }
  }, [open]);

  useEffect(() => {
    if (step === 2) nameRef.current?.focus();
  }, [step]);

  const categories = useMemo(() => {
    const present = new Set(templates.map((t) => t.category || "Other"));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    const rest = [...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return ["All", ...ordered, ...rest];
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== "All" && (t.category || "Other") !== category) return false;
      if (atsOnly && t.ats_profile !== "friendly") return false;
      if (q && !`${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, search, category, atsOnly]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  if (!open) return null;

  const choose = (t: TemplateInfo) => {
    setSelectedId(t.id);
    setColor(t.default_color || DEFAULT_BOOK_COLOR);
    setStep(2);
  };

  const submit = async () => {
    if (!selected || setup.active) return;
    // Fetch any fonts/packages the template needs, showing live progress, before
    // handing off to creation (which stages them into the project).
    if (!selected.ready) {
      setSetup({ active: true, label: "Setting up your template..." });
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await listen<AssetProgress>("asset-progress", (e) => {
          const p = e.payload;
          setSetup({ active: true, label: `Downloading ${p.label} (${p.index} of ${p.total})` });
        });
        await ensureTemplateAssets(selected.id);
      } catch (err) {
        void logError("download template assets", err);
        setSetup({ active: false, label: "" });
        unlisten?.();
        return;
      }
      unlisten?.();
      setSetup({ active: false, label: "" });
    }
    await onCreate(name, selected.id, color);
  };

  const working = busy || setup.active;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(80vh,680px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">
            {step === 1 ? "Choose a template" : "Name your project"}
          </h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {step === 1 ? (
          <div className="flex min-h-0 flex-1">
            {/* Category rail */}
            <nav className="w-44 shrink-0 overflow-y-auto border-r p-2">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "mb-0.5 w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                    category === c
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
            </nav>

            {/* Main column */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search templates"
                    className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setAtsOnly((v) => !v)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    atsOnly
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  <Check className={cn("size-3", !atsOnly && "opacity-0")} /> ATS-friendly
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {filtered.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No templates match.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4">
                    {filtered.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => choose(t)}
                        title={t.description}
                        className="group flex flex-col text-left focus:outline-none"
                      >
                        <div className="relative aspect-[17/22] overflow-hidden rounded-md border border-black/10 bg-white shadow-sm ring-2 ring-transparent transition-all duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:ring-primary/50 group-focus-visible:ring-primary">
                          <Preview t={t} />
                          {!t.ready && (
                            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                              <Download className="size-2.5" /> Setup
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 px-0.5">
                          <span className="truncate text-xs font-medium leading-tight text-foreground">
                            {t.name}
                          </span>
                          {t.ats_profile === "friendly" && (
                            <span
                              className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                              title="ATS-friendly"
                            />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          selected && (
            <div className="flex min-h-0 flex-1">
              {/* Selected template summary */}
              <div className="hidden w-64 shrink-0 flex-col gap-3 border-r p-5 sm:flex">
                <div className="aspect-[17/22] overflow-hidden rounded-md border border-black/10 bg-white shadow-sm">
                  <Preview t={selected} />
                </div>
                <div>
                  <div className="text-sm font-semibold">{selected.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{selected.category}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <AtsBadge profile={selected.ats_profile} />
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {selected.engine === "luatex" ? "LuaLaTeX" : "Tectonic"}
                  </span>
                </div>
                {selected.license && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {selected.license.spdx}
                    {selected.license.author ? ` · ${selected.license.author}` : ""}
                  </p>
                )}
              </div>

              {/* Name + cover */}
              <div className="flex min-w-0 flex-1 flex-col p-6">
                <label
                  htmlFor="new-project-name"
                  className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Project name
                </label>
                <input
                  id="new-project-name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim() && !working) void submit();
                  }}
                  placeholder="e.g. My Resume"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />

                <p className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Cover color
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {BOOK_COLOR_OPTIONS.map((c) => {
                    const active = color === c.hex;
                    return (
                      <Tooltip key={c.hex} label={c.name}>
                        <button
                          type="button"
                          onClick={() => setColor(c.hex)}
                          aria-label={c.name}
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110",
                            active && "scale-110 ring-1 ring-primary ring-offset-2 ring-offset-background",
                          )}
                          style={{ background: c.hex }}
                        >
                          {active && <Check className="size-3.5 text-white drop-shadow" />}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>

                {!selected.ready && (
                  <div className="mt-5 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      This template needs a one-time setup download (fonts and packages). We will
                      fetch it in the background right after you create the project.
                    </span>
                  </div>
                )}

                <div className="mt-auto flex items-center justify-end gap-2 pt-6">
                  <Button variant="ghost" onClick={() => setStep(1)} disabled={working}>
                    <ArrowLeft className="size-4" /> Back
                  </Button>
                  <Button
                    className="bg-primary text-white hover:bg-primary"
                    onClick={() => void submit()}
                    disabled={working || !name.trim()}
                  >
                    {setup.active
                      ? setup.label
                      : busy
                        ? "Setting up..."
                        : "Create project"}
                    {!working && <ArrowRight className="size-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
