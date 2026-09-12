import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileText,
  FolderInput,
  Hash,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "./cn";
import { modalCoordinator, visibleFocusable } from "./modal-coordinator";
import type { TemplateInfo, TemplatesHost, TemplatesKit } from "./types";
import type { TemplatesMessageKey, TemplatesTranslator } from "./messages";

// Preferred category order (anything else falls to the end, alphabetically).
const CATEGORY_ORDER = [
  "Blank",
  "Diagrams & Figures",
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
const CATEGORY_KEYS: Record<string, { label: TemplatesMessageKey; full?: TemplatesMessageKey }> = {
  All: { label: "category.all" },
  "AI Generated": { label: "category.aiGenerated" },
  Blank: { label: "category.blank" },
  "Diagrams & Figures": { label: "category.diagrams", full: "category.diagramsFull" },
  "CVs & Resumes": { label: "category.resume", full: "category.resumeFull" },
  "Journals & Conferences": { label: "category.journals", full: "category.journalsFull" },
  Bibliographies: { label: "category.bibliographies" },
  Assignments: { label: "category.assignments" },
  "Theses & Reports": { label: "category.theses" },
  Books: { label: "category.books" },
  Presentations: { label: "category.presentations" },
  Posters: { label: "category.posters" },
  Newsletters: { label: "category.newsletters" },
  Calendars: { label: "category.calendars" },
  Letters: { label: "category.letters" },
  Other: { label: "category.other" },
};

function categoryLabel(category: string, t: TemplatesTranslator): string {
  const entry = CATEGORY_KEYS[category];
  return entry ? t(entry.label) : category;
}

function categoryFullName(category: string, t: TemplatesTranslator): string | undefined {
  const full = CATEGORY_KEYS[category]?.full;
  return full ? t(full) : undefined;
}

// Aspirational, template-specific placeholders for the project-name field, keyed
// by template id first, then falling back by category. A small, editable map.
const NAME_HINT_BY_ID: Record<string, TemplatesMessageKey> = {
  blank: "nameHint.blank",
  "ats-resume": "nameHint.atsResume",
  resume: "nameHint.resume",
  "modern-resume": "nameHint.modernResume",
  "sidebar-resume": "nameHint.sidebarResume",
  ieee: "nameHint.ieee",
  acm: "nameHint.acm",
  elsevier: "nameHint.elsevier",
  "article-academic": "nameHint.articleAcademic",
  thesis: "nameHint.thesis",
  book: "nameHint.book",
  beamer: "nameHint.beamer",
  poster: "nameHint.poster",
  newsletter: "nameHint.newsletter",
  assignment: "nameHint.assignment",
  calendar: "nameHint.calendar",
  bibliography: "nameHint.bibliography",
  letter: "nameHint.letter",
};
const NAME_HINT_BY_CATEGORY: Record<string, TemplatesMessageKey> = {
  "CVs & Resumes": "nameHint.categoryResume",
  "Journals & Conferences": "nameHint.categoryJournals",
  Presentations: "nameHint.categoryPresentations",
  Books: "nameHint.categoryBooks",
  "Theses & Reports": "nameHint.categoryTheses",
  Posters: "nameHint.categoryPosters",
  Letters: "nameHint.categoryLetters",
  Newsletters: "nameHint.categoryNewsletters",
  Assignments: "nameHint.categoryAssignments",
  Calendars: "nameHint.categoryCalendars",
  Bibliographies: "nameHint.categoryBibliographies",
};
function nameHint(template: TemplateInfo | null, t: TemplatesTranslator): string {
  if (!template) return t("nameHint.default");
  const key = NAME_HINT_BY_ID[template.id] ?? NAME_HINT_BY_CATEGORY[template.category];
  return key ? t(key) : t("nameHint.default");
}

// "All" first, then AI Generated, then the curated order, then anything new
// alphabetically so an unrecognised category still lands somewhere sensible.
export function orderedCategories(
  templates: readonly Pick<TemplateInfo, "category">[],
): string[] {
  const present = new Set(templates.map((t) => t.category || "Other"));
  const ordered = CATEGORY_ORDER.filter(
    (c) => present.has(c) && c !== "AI Generated",
  );
  const rest = [...present]
    .filter((c) => !CATEGORY_ORDER.includes(c) && c !== "AI Generated")
    .sort((a, b) => a.localeCompare(b));
  return [
    "All",
    ...(present.has("AI Generated") ? ["AI Generated"] : []),
    ...ordered,
    ...rest,
  ];
}

export function compilerLabel(template: TemplateInfo, t: TemplatesTranslator): string {
  if (template.document_engine === "unknown") return t("compiler.unknown");
  if (template.document_engine === "typst") return "Typst";
  if (template.document_engine === "markdown") return "Pandoc";
  return template.engine === "luatex" ? "LuaLaTeX" : "Tectonic";
}
export function wrappedModalFocus(
  active: unknown,
  first: unknown,
  last: unknown,
  shift: boolean,
): "first" | "last" | null {
  if (shift && active === first) return "last";
  if (!shift && active === last) return "first";
  return null;
}

// Cache preview data URIs so switching steps or categories doesn't refetch.
const previewCache = new Map<string, string | null>();
function useTemplatePreview(t: TemplateInfo, host: TemplatesHost): string | null {
  const [uri, setUri] = useState<string | null>(() => previewCache.get(t.id) ?? null);
  useEffect(() => {
    if (!t.has_preview) return;
    if (previewCache.has(t.id)) {
      setUri(previewCache.get(t.id) ?? null);
      return;
    }
    let alive = true;
    void host
      .loadPreview(t.id)
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
  }, [t.id, t.has_preview, host]);
  return uri;
}

interface TemplateFilters {
  category: string;
  atsOnly: boolean;
  offlineOnly: boolean;
  engine: string;
  q: string;
}

function matchesTemplateFilters(t: TemplateInfo, filters: TemplateFilters): boolean {
  if (filters.category !== "All" && (t.category || "Other") !== filters.category) return false;
  if (filters.atsOnly && t.ats_profile !== "friendly") return false;
  if (filters.offlineOnly && !t.assets_ready) return false;
  if (filters.engine !== "all" && t.document_engine !== filters.engine) return false;
  if (
    filters.q &&
    !`${t.name} ${t.description} ${t.category}`.toLowerCase().includes(filters.q)
  ) {
    return false;
  }
  return true;
}

function trapDialogTab(event: KeyboardEvent, elements: HTMLElement[]): void {
  if (!elements.length) return;
  const first = elements[0];
  const last = elements.at(-1)!;
  const wrap = wrappedModalFocus(document.activeElement, first, last, event.shiftKey);
  if (!wrap) return;
  event.preventDefault();
  (wrap === "first" ? first : last).focus({ preventScroll: true });
}

function engineIcon(engine: TemplateInfo["document_engine"]) {
  if (engine === "markdown") return Hash;
  if (engine === "typst") return Sparkles;
  return FileText;
}

function Preview({
  template,
  host,
  className,
  t,
}: Readonly<{
  template: TemplateInfo;
  host: TemplatesHost;
  className?: string;
  t: TemplatesTranslator;
}>) {
  const uri = useTemplatePreview(template, host);
  if (uri) {
    // Diagram/figure previews are a standalone cropped image, not a document
    // page, and rarely share the card's portrait aspect ratio. Cropping them
    // like a page thumbnail (object-cover) can clip content off the bottom;
    // show the whole figure instead.
    const isFigure = template.category === "Diagrams & Figures";
    return (
      <img
        src={uri}
        alt={t("dialog.previewAlt", { name: template.name })}
        className={cn(
          "h-full w-full bg-white",
          isFigure ? "object-contain p-3" : "object-cover object-top",
          className,
        )}
        draggable={false}
      />
    );
  }
  // No rendered thumbnail (e.g. Markdown previews need Pandoc at build time):
  // fall back to an intentional, engine-branded placeholder tinted by the
  // template's accent color, rather than a generic gray file icon.
  const tint = /^#[0-9a-fA-F]{6}$/.test(template.default_color ?? "")
    ? (template.default_color as string)
    : null;
  const Icon = engineIcon(template.document_engine);
  return (
    <div
      className={cn("flex h-full w-full flex-col items-center justify-center gap-2 bg-white", className)}
    >
      <div
        className="flex size-11 items-center justify-center rounded-xl"
        style={{
          backgroundColor: tint ? `${tint}1a` : "#f5f5f5",
          color: tint ?? "#a3a3a3",
        }}
      >
        <Icon className="size-6" />
      </div>
      <span
        className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
        style={{ color: tint ?? "#737373", backgroundColor: tint ? `${tint}14` : "#f5f5f5" }}
      >
        {compilerLabel(template, t)}
      </span>
      <span className="line-clamp-2 px-3 text-center text-[10px] font-medium text-neutral-500">
        {template.name}
      </span>
    </div>
  );
}

function AtsBadge({
  profile,
  t,
}: Readonly<{
  profile: TemplateInfo["ats_profile"];
  t: TemplatesTranslator;
}>) {
  if (profile === "friendly")
    return (
      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        {t("dialog.atsFriendly")}
      </span>
    );
  if (profile === "design-forward")
    return (
      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500">
        {t("dialog.designForward")}
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
  onGenerateWithAi,
  importControl,
  onImportProject,
  onOpenTemplateDownloads,
  host,
  kit,
  colorOptions,
  defaultColor,
  allowEnterSubmit = true,
  allowClose = true,
}: Readonly<{
  open: boolean;
  templates: TemplateInfo[];
  busy?: boolean;
  onClose: () => void;
  onCreate: (name: string, templateId: string, color: string) => void | Promise<void>;
  onGenerateWithAi?: () => void;
  /** App-owned import menu, used when multiple import sources are available. */
  importControl?: ReactNode;
  /** Backward-compatible single import action. */
  onImportProject?: () => void;
  onOpenTemplateDownloads?: () => void;
  host: TemplatesHost;
  kit: TemplatesKit;
  colorOptions: { name: string; hex: string }[];
  defaultColor: string;
  allowEnterSubmit?: boolean;
  allowClose?: boolean;
}>) {
  const { Button, Input, Tooltip, Select, t } = kit;
  const [step, setStep] = useState<1 | 2>(1);
  const createChordRef = useRef<{ enabled: boolean; submit: () => Promise<void> }>({
    enabled: false,
    submit: async () => {},
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      if (!createChordRef.current.enabled) return;
      event.preventDefault();
      void createChordRef.current.submit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor);
  const pendingUseRef = useRef<string | null>(null);
  useEffect(() => {
    const chooseById = (id: string): boolean => {
      const match = templates.find((t) => t.id === id);
      if (!match) return false;
      setSelectedId(match.id);
      setColor(match.default_color || defaultColor);
      setStep(2);
      return true;
    };
    const pending = pendingUseRef.current;
    if (pending && chooseById(pending)) pendingUseRef.current = null;
    const onUse = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      if (!chooseById(id)) pendingUseRef.current = id;
    };
    window.addEventListener("oleafly:use-template", onUse);
    return () => window.removeEventListener("oleafly:use-template", onUse);
  }, [templates, defaultColor]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [atsOnly, setAtsOnly] = useState(false);
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [engine, setEngine] = useState<"all" | TemplateInfo["document_engine"]>("all");
  const [setup, setSetup] = useState<{ active: boolean; label: string }>({
    active: false,
    label: "",
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const modalIdRef = useRef(Symbol("new-project-dialog"));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const allowCloseRef = useRef(allowClose);
  allowCloseRef.current = allowClose;

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedId(null);
      setName("");
      setColor(defaultColor);
      setSearch("");
      setCategory("All");
      setAtsOnly(false);
      setOfflineOnly(false);
      setEngine("all");
      setSetup({ active: false, label: "" });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const registeredId = modalCoordinator.add(openerRef.current);
    modalIdRef.current = registeredId;
    const isTopmost = () => modalCoordinator.isTop(registeredId);
    const focusable = () => visibleFocusable(Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []));
    const onKey = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (allowCloseRef.current) onCloseRef.current();
      }
      if (event.key === "Tab") trapDialogTab(event, focusable());
    };
    const onFocus = (event: FocusEvent) => {
      if (!isTopmost() || dialogRef.current?.contains(event.target as Node)) return;
      focusable()[0]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      const restore = modalCoordinator.remove(registeredId);
      if (restore) restore.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (step === 2) {
      nameRef.current?.focus({ preventScroll: true });
    } else if (open) {
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [step, open]);

  const categories = useMemo(() => orderedCategories(templates), [templates]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("All", templates.length);
    for (const t of templates) {
      const c = t.category || "Other";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) =>
      matchesTemplateFilters(t, { category, atsOnly, offlineOnly, engine, q }),
    );
  }, [templates, search, category, atsOnly, offlineOnly, engine]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  if (!open) {
    createChordRef.current.enabled = false;
    return null;
  }

  const choose = (t: TemplateInfo) => {
    setSelectedId(t.id);
    setColor(t.default_color || defaultColor);
    setStep(2);
  };

  const submit = async () => {
    if (!selected || setup.active) return;
    // Fetch any fonts/packages the template needs, showing live progress, before
    // handing off to creation (which stages them into the project).
    if (!selected.assets_ready) {
      setSetup({ active: true, label: t("setup.preparing") });
      try {
        await host.ensureAssets(selected.id, (label, index, total) => {
          setSetup({ active: true, label: t("setup.downloading", { label, index, total }) });
        });
      } catch (err) {
        host.logError("download template assets", err);
        setSetup({ active: false, label: "" });
        return;
      }
      setSetup({ active: false, label: "" });
    }
    await onCreate(name, selected.id, color);
  };

  const working = busy || setup.active;
  const createLabel = busy ? t("dialog.creating") : t("dialog.create");
  createChordRef.current = {
    enabled: step === 2 && !working && Boolean(name.trim()),
    submit,
  };

  const renderTemplatePickerStep = () => (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-44 shrink-0 flex-col overflow-y-auto border-r p-2">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            title={categoryFullName(c, t)}
            onClick={() => setCategory(c)}
            className={cn(
              "mb-0.5 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
              category === c
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {c === "AI Generated" && <Sparkles className="size-3.5 shrink-0 text-primary" />}
              <span className="truncate">{categoryLabel(c, t)}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                category === c
                  ? "bg-accent-foreground/15 text-accent-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {categoryCounts.get(c) ?? 0}
            </span>
          </button>
        ))}
        {onOpenTemplateDownloads && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="open-template-downloads"
            onClick={onOpenTemplateDownloads}
            className="mt-auto w-full justify-start gap-2 text-muted-foreground"
          >
            <Download className="size-3.5" />
            {t("dialog.getMoreTemplates")}
          </Button>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("dialog.searchPlaceholder")}
              className="h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Select
            aria-label={t("dialog.engineLabel")}
            data-testid="template-engine-filter"
            value={engine}
            onValueChange={(v) => setEngine(v as typeof engine)}
            className="w-[132px] text-xs"
            options={[
              { value: "all", label: t("dialog.engineAll") },
              { value: "latex", label: t("dialog.engineLatex") },
              { value: "typst", label: t("dialog.engineTypst") },
              { value: "markdown", label: t("dialog.engineMarkdown") },
            ]}
          />
          <Tooltip label={t("dialog.atsTooltip")}>
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
              <Check className={cn("size-3", !atsOnly && "opacity-0")} /> {t("dialog.atsFriendly")}
            </button>
          </Tooltip>
          <Tooltip label={t("dialog.offlineTooltip")}>
            <button
              type="button"
              data-testid="template-offline-filter"
              onClick={() => setOfflineOnly((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                offlineOnly
                  ? "border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              <Check className={cn("size-3", !offlineOnly && "opacity-0")} /> {t("dialog.offlineFilter")}
            </button>
          </Tooltip>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          data-tour="project-template-list"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="size-6" />
              </span>
              <p className="text-base font-semibold text-foreground">
                {t("dialog.emptyTitle")}
              </p>
              <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                {t("dialog.emptyBody")}
              </p>
              {onGenerateWithAi && (
                <Button
                  className="mt-1"
                  data-testid="generate-template-empty-state"
                  data-tour-hide
                  onClick={onGenerateWithAi}
                >
                  <Sparkles className="size-4" /> {t("dialog.generateWithAi")}
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4">
              {filtered.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-tour="project-template-card"
                  data-testid={`template-card-${entry.id}`}
                  onClick={() => choose(entry)}
                  title={entry.description}
                  className="group flex flex-col text-left focus:outline-none"
                >
                  <div className="relative aspect-[17/22] overflow-hidden rounded-md border border-black/10 bg-white shadow-sm ring-1 ring-transparent transition-all duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:ring-primary/50 group-focus-visible:ring-primary">
                    <Preview template={entry} host={host} t={t} />
                    {(entry.category || "") === "AI Generated" && (
                      <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-white shadow-md">
                        <Sparkles className="size-2.5" /> {t("dialog.aiBadge")}
                      </span>
                    )}
                    {!entry.assets_ready && (
                      <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                        <Download className="size-2.5" /> {t("dialog.setupBadge")}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 px-0.5">
                    <span className="truncate text-xs font-medium leading-tight text-foreground">
                      {entry.name}
                    </span>
                    {entry.ats_profile === "friendly" && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                        title={t("dialog.atsFriendly")}
                      />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 px-0.5">
                    <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
                      {compilerLabel(entry, t)}
                    </span>
                    {!entry.assets_ready && (
                      <span className="text-[9px] font-medium text-amber-600 dark:text-amber-400">
                        {t("dialog.needsSetup")}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderProjectDetailsStep = () => (
    selected && (
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-64 shrink-0 flex-col gap-3 border-r p-5 sm:flex">
          <div className="aspect-[17/22] overflow-hidden rounded-md border border-black/10 bg-white shadow-sm">
            <Preview template={selected} host={host} t={t} />
          </div>
          <div>
            <div className="text-sm font-semibold">{selected.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{categoryLabel(selected.category, t)}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <AtsBadge profile={selected.ats_profile} t={t} />
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {compilerLabel(selected, t)}
            </span>
          </div>
          {selected.license && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {selected.license.spdx}
              {selected.license.author ? ` · ${selected.license.author}` : ""}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col p-6">
          <label
            htmlFor="new-project-name"
            className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t("dialog.projectName")}
          </label>
          <Input
            id="new-project-name"
            data-tour="project-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (allowEnterSubmit && e.key === "Enter" && name.trim() && !working) {
                void submit();
              }
            }}
            placeholder={nameHint(selected, t)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />

          <p className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dialog.coverColor")}
          </p>
          <div
            className="flex flex-wrap items-center gap-2"
            data-tour="project-cover-color"
          >
            {colorOptions.map((c) => {
              const active = color === c.hex;
              return (
                <Tooltip key={c.hex} label={c.name}>
                  <button
                    type="button"
                    onClick={() => setColor(c.hex)}
                    aria-label={c.name}
                    aria-pressed={active}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110",
                      active && "scale-110 ring-1 ring-primary ring-offset-2 ring-offset-background",
                    )}
                    style={{ background: c.hex }}
                  >
                    {active && (
                      <span className="flex size-4 items-center justify-center rounded-full bg-black/65 text-white shadow-sm">
                        <Check className="size-3 stroke-[3]" />
                      </span>
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>

          {!selected.assets_ready && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" />
              <span>{t("dialog.setupNotice")}</span>
            </div>
          )}

          <div className="mt-auto flex items-center justify-end gap-2 pt-6">
            <Button
              data-tour="project-dialog-back"
              variant="ghost"
              onClick={() => setStep(1)}
              disabled={working}
            >
              <ArrowLeft className="size-4" /> {t("dialog.back")}
            </Button>
            <Button
              data-testid="create-project"
              data-tour="create-project"
              className="bg-primary text-white hover:bg-primary"
              onClick={() => void submit()}
              disabled={working || !name.trim()}
            >
              {setup.active ? setup.label : createLabel}
              {!working && <ArrowRight className="size-4" />}
              {!working && (
                <span className="inline-flex items-center gap-1">
                  <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-white/20 px-1 font-sans text-[10px] font-medium text-white">
                    {/Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318" : "Ctrl"}
                  </kbd>
                  <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-white/20 px-1 font-sans text-[10px] font-medium text-white">
                    {"\u21B5"}
                  </kbd>
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        const modalId = modalIdRef.current;
        if (
          allowClose &&
          modalId &&
          modalCoordinator.isTop(modalId) &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div // NOSONAR - the only handler is a stopPropagation guard, and Escape (line ~309) is the modal's keyboard path
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        data-testid="template-gallery"
        data-tour="project-template-gallery"
        data-tour-stage={step === 1 ? "templates" : "details"}
        data-tour-template-selected={selected ? "true" : "false"}
        data-tour-name-valid={name.trim() ? "true" : "false"}
        className="flex h-[min(80vh,680px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 id="new-project-title" className="text-base font-semibold">
            {step === 1 ? t("dialog.chooseTemplate") : t("dialog.nameProject")}
          </h2>
          <div className="flex items-center gap-2">
            {step === 1 && importControl}
            {step === 1 && !importControl && onImportProject && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="import-from-overleaf"
                data-tour-hide
                onClick={onImportProject}
              >
                <FolderInput className="size-3.5" /> {t("dialog.import")}
              </Button>
            )}
            {step === 1 && onGenerateWithAi && (
              <Button
                variant="ghostPrimary"
                size="sm"
                data-testid="generate-template-with-ai"
                data-tour-hide
                onClick={onGenerateWithAi}
              >
                <Sparkles className="size-3.5" /> {t("dialog.generateWithAi")}
              </Button>
            )}
            {allowClose ? (
              <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label={t("dialog.close")}>
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {step === 1 ? (
          renderTemplatePickerStep()
        ) : (
          renderProjectDetailsStep()
        )}
      </div>
    </div>
  );
}
