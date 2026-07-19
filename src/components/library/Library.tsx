import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  Clock3,
  FileText,
  GitFork,
  History,
  Info,
  ListFilter,
  Moon,
  Palette,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Tooltip } from "@/components/ui/tooltip";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { Book, BOOK_COLOR_OPTIONS, DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { GridPattern } from "@/components/ui/grid-pattern";
import { useFavoritesStore } from "@/store/favorites";
import { useProjectColorsStore } from "@/store/project-colors";
import { logError } from "@/lib/log";
import { notifyError, toast } from "@/lib/toast";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTheme } from "@/lib/theme";
import { cn, isMac, shortcut } from "@/lib/utils";
import { cancelAutoCommit } from "@/lib/auto-commit";
import {
  deleteProject,
  duplicateProject,
  readCompiledPdf,
  type ProjectInfo,
} from "@/lib/tauri";

const thumbCache = new Map<string, string | null>();
const MAX_THUMBNAILS = 64;
// In-flight keys so a second hover during a load does not start a parallel job.
const thumbInflight = new Set<string>();

type ProjectFilters = {
  metadata: string;
  engine: "all" | "tectonic" | "typst" | "markdown";
  kind: "all" | "document" | "image";
  bookmark: "all" | "yes" | "no";
  preview: "all" | "yes" | "no";
  created: "all" | "7" | "30" | "365";
  modified: "all" | "7" | "30" | "365";
};

const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  metadata: "",
  engine: "all",
  kind: "all",
  bookmark: "all",
  preview: "all",
  created: "all",
  modified: "all",
};

function projectEngineLabel(engine: string | undefined, mainDoc: string) {
  const value = engine?.trim().toLowerCase();
  const path = mainDoc.toLowerCase();
  if (value === "typst" || value === "typ" || path.endsWith(".typ")) return "Typst";
  if (
    value === "markdown" ||
    value === "md" ||
    value === "pandoc" ||
    path.endsWith(".md") ||
    path.endsWith(".markdown")
  ) {
    return "Markdown";
  }
  return "Tectonic";
}

function projectModifiedLabel(timestamp: number) {
  if (!timestamp) return undefined;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

function projectDateTime(timestamp: number) {
  if (!timestamp) return "Unavailable";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function keyedExports(exports: ProjectInfo["exports"]) {
  const occurrences = new Map<string, number>();
  return [...(exports ?? [])].reverse().map((item) => {
    const base = `${item.path}:${item.date}:${item.filename}:${item.format}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { item, key: `${base}:${occurrence}` };
  });
}

function cacheThumbnail(key: string, png: string) {
  thumbCache.delete(key);
  thumbCache.set(key, png);
  if (thumbCache.size > MAX_THUMBNAILS) {
    const oldest = thumbCache.keys().next().value;
    if (oldest) thumbCache.delete(oldest);
  }
}

function isWithinDays(timestamp: number, days: ProjectFilters["created"]) {
  if (days === "all") return true;
  if (!timestamp) return true;
  return timestamp * 1000 >= Date.now() - Number(days) * 24 * 60 * 60 * 1000;
}

function projectMetadataText(project: ProjectInfo) {
  return [
    project.id,
    project.name,
    project.engine,
    projectEngineLabel(project.engine, project.main_doc),
    project.kind,
    project.main_doc,
    project.color,
    project.created_at,
    project.updated_at,
    project.has_preview ? "preview available" : "preview missing",
    ...(project.exports ?? []).flatMap((item) => [
      item.filename,
      item.format,
      item.path,
      item.date,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = `project-filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label
      htmlFor={id}
      className="flex min-w-0 flex-col gap-1 text-xs font-medium"
    >
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}

export function Library() {
  const projects = useFilesStore((s) => s.projects);
  const projectsLoaded = useFilesStore((s) => s.projectsLoaded);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const openProject = useFilesStore((s) => s.openProject);
  const favs = useFavoritesStore((s) => s.favs);
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const removeFav = useFavoritesStore((s) => s.remove);
  const projectColors = useProjectColorsStore((s) => s.colors);
  const setProjectColor = useProjectColorsStore((s) => s.setColor);
  const removeProjectColor = useProjectColorsStore((s) => s.remove);
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const hoverPreview = useSettingsStore((s) => s.hoverPreview);
  const { theme, toggleTheme } = useTheme();
  const [forkTarget, setForkTarget] = useState<{ id: string; name: string } | null>(null);
  const [forkName, setForkName] = useState("");
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [filters, setFilters] = useState<ProjectFilters>(DEFAULT_PROJECT_FILTERS);
  const [detailsProject, setDetailsProject] = useState<ProjectInfo | null>(null);
  const [historyProject, setHistoryProject] = useState<ProjectInfo | null>(null);
  const currentDetailsProject =
    detailsProject && projects.find((project) => project.id === detailsProject.id) || detailsProject;
  const currentHistoryProject =
    historyProject && projects.find((project) => project.id === historyProject.id) || historyProject;
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const releasePointerLock = () => {
    const release = (observer?: MutationObserver) => {
      const overlay = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      );
      if (overlay) return;
      observer?.disconnect();
      document.body.style.removeProperty("pointer-events");
    };
    const observer = new MutationObserver(() => release(observer));
    observer.observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(() => release(observer));
  };
  const closeFork = () => {
    setForkTarget(null);
    setForkName("");
  };
  const { dialogRef: forkDialogRef, onBackdropMouseDown: onForkBackdropMouseDown } =
    useModalAccessibility<HTMLDivElement>(!!forkTarget, closeFork);

  // Successful PNGs are cached; failures are NOT permanently cached so a
  // later compile can still produce a preview.
  const loadThumb = (id: string, updatedAt: number) => {
    const key = `${id}:${updatedAt}`;
    if (thumbCache.has(key)) {
      const cached = thumbCache.get(key) ?? null;
      if (cached && thumbs[id] !== cached) setThumbs((t) => ({ ...t, [id]: cached }));
      return;
    }
    if (thumbInflight.has(key)) return;
    thumbInflight.add(key);
    const rasterizeLatest = async () => {
      const { pdfPageToPng } = await import("@/lib/pdf-image");
      const buf = await readCompiledPdf(id);
      return pdfPageToPng(new Uint8Array(buf), 1, 1.2, "#ffffff");
    };
    void rasterizeLatest()
      .then((png) => {
        cacheThumbnail(key, png);
        setThumbs((t) => ({ ...t, [id]: png }));
      })
      .catch((error) => {
        void logError("library thumbnail", error);
        // No permanent negative cache: the project may compile later.
        setThumbs((t) => (t[id] === undefined ? t : { ...t, [id]: null }));
      })
      .finally(() => {
        thumbInflight.delete(key);
      });
  };

  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([key, value]) => {
        if (key === "metadata") return value.trim().length > 0;
        return value !== DEFAULT_PROJECT_FILTERS[key as keyof ProjectFilters];
      }).length,
    [filters],
  );
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        const bookmarked = favs.includes(project.id);
        if (onlyFavs && !bookmarked) return false;
        if (
          filters.metadata.trim() &&
          !projectMetadataText(project).includes(filters.metadata.trim().toLowerCase())
        ) {
          return false;
        }
        if (
          filters.engine !== "all" &&
          projectEngineLabel(project.engine, project.main_doc).toLowerCase() !== filters.engine
        ) {
          return false;
        }
        const kind = project.kind || "document";
        if (filters.kind !== "all" && kind !== filters.kind) return false;
        if (filters.bookmark === "yes" && !bookmarked) return false;
        if (filters.bookmark === "no" && bookmarked) return false;
        if (filters.preview === "yes" && !project.has_preview) return false;
        if (filters.preview === "no" && project.has_preview) return false;
        if (!isWithinDays(project.created_at, filters.created)) return false;
        if (!isWithinDays(project.updated_at, filters.modified)) return false;
        return true;
      }),
    [projects, favs, onlyFavs, filters],
  );

  useEffect(() => {
    void refreshProjects().catch((e) => void logError("load projects", e));
  }, [refreshProjects]);

  const submitFork = async () => {
    if (!forkTarget) return;
    const n = forkName.trim() || `${forkTarget.name} (copy)`;
    try {
      const id = await duplicateProject(forkTarget.id, n);
      await refreshProjects();
      if (id) setProjectColor(id, DEFAULT_BOOK_COLOR);
    } catch (e) {
      notifyError("fork project", e, "Couldn't fork the project.");
    }
    setForkTarget(null);
    setForkName("");
  };

  return (
    <div
      data-testid="library"
      data-tour="home"
      data-projects-loaded={projectsLoaded ? "true" : "false"}
      className="relative flex h-full flex-col bg-background"
    >
      <GridPattern
        width={48}
        height={48}
        className="[mask-image:linear-gradient(to_bottom_right,white,transparent,transparent)]"
      />
      <header
        data-tauri-drag-region
        className={cn(
          "relative z-10 grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center",
          isMac ? "pl-[78px] pr-3" : "px-4"
        )}
      >
        <div data-tauri-drag-region />
        <div
          data-tauri-drag-region
          data-tour="home-brand"
          className="flex items-center justify-center gap-1.5"
        >
          {projects.length > 0 && (
            <>
              <LeafLogo className="size-5" />
              <span className="text-sm font-semibold tracking-tight">Oleafly</span>
            </>
          )}
        </div>
        <div data-tauri-drag-region className="flex items-center justify-end gap-1.5">
          {projects.length > 0 && (
            <>
              <Tooltip label="New project">
                <Button
                  data-testid="new-project"
                  data-tour="new-project"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setNewProjectOpen(true)}
                >
                  <Plus className="size-4" /> New project
                </Button>
              </Tooltip>
              <Tooltip label={`Search documents (${shortcut("⌘⇧F")})`}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search documents"
                >
                  <Search className="size-4" />
                </Button>
              </Tooltip>
              <Tooltip label="Advanced project filters">
                <Popover
                  ariaLabel="Advanced project filters"
                  align="right"
                  closeOnClick={false}
                  className="flex w-80 flex-col gap-3 p-3"
                  trigger={
                    <span className="relative inline-flex">
                      <ListFilter className="size-4" />
                      {activeFilterCount > 0 && (
                        <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" />
                      )}
                    </span>
                  }
                >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <h2 className="text-sm font-semibold">Advanced filters</h2>
                    <p className="text-xs text-muted-foreground">
                      Filters apply to the project shelf immediately
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={activeFilterCount === 0}
                    onClick={() => setFilters(DEFAULT_PROJECT_FILTERS)}
                  >
                    Reset
                  </Button>
                </div>
                <label
                  htmlFor="project-filter-metadata"
                  className="flex flex-col gap-1 text-xs font-medium"
                >
                  Project metadata
                  <Input
                    id="project-filter-metadata"
                    value={filters.metadata}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        metadata: event.target.value,
                      }))
                    }
                    placeholder="Name, ID, main file, color, or export"
                    className="h-8 text-xs"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <FilterSelect
                    label="Engine"
                    value={filters.engine}
                    onChange={(engine) =>
                      setFilters((current) => ({
                        ...current,
                        engine: engine as ProjectFilters["engine"],
                      }))
                    }
                    options={[
                      { value: "all", label: "All engines" },
                      { value: "tectonic", label: "Tectonic" },
                      { value: "typst", label: "Typst" },
                      { value: "markdown", label: "Markdown" },
                    ]}
                  />
                  <FilterSelect
                    label="Project kind"
                    value={filters.kind}
                    onChange={(kind) =>
                      setFilters((current) => ({
                        ...current,
                        kind: kind as ProjectFilters["kind"],
                      }))
                    }
                    options={[
                      { value: "all", label: "All kinds" },
                      { value: "document", label: "Document" },
                      { value: "image", label: "Image" },
                    ]}
                  />
                  <FilterSelect
                    label="Bookmark"
                    value={filters.bookmark}
                    onChange={(bookmark) =>
                      setFilters((current) => ({
                        ...current,
                        bookmark: bookmark as ProjectFilters["bookmark"],
                      }))
                    }
                    options={[
                      { value: "all", label: "Any status" },
                      { value: "yes", label: "Bookmarked" },
                      { value: "no", label: "Not bookmarked" },
                    ]}
                  />
                  <FilterSelect
                    label="PDF preview"
                    value={filters.preview}
                    onChange={(preview) =>
                      setFilters((current) => ({
                        ...current,
                        preview: preview as ProjectFilters["preview"],
                      }))
                    }
                    options={[
                      { value: "all", label: "Any status" },
                      { value: "yes", label: "Available" },
                      { value: "no", label: "Not available" },
                    ]}
                  />
                  <FilterSelect
                    label="Created"
                    value={filters.created}
                    onChange={(created) =>
                      setFilters((current) => ({
                        ...current,
                        created: created as ProjectFilters["created"],
                      }))
                    }
                    options={[
                      { value: "all", label: "Any time" },
                      { value: "7", label: "Last 7 days" },
                      { value: "30", label: "Last 30 days" },
                      { value: "365", label: "Last year" },
                    ]}
                  />
                  <FilterSelect
                    label="Modified"
                    value={filters.modified}
                    onChange={(modified) =>
                      setFilters((current) => ({
                        ...current,
                        modified: modified as ProjectFilters["modified"],
                      }))
                    }
                    options={[
                      { value: "all", label: "Any time" },
                      { value: "7", label: "Last 7 days" },
                      { value: "30", label: "Last 30 days" },
                      { value: "365", label: "Last year" },
                    ]}
                  />
                </div>
                  <p className="text-xs text-muted-foreground">
                    Showing {visibleProjects.length} of {projects.length} projects
                  </p>
                </Popover>
              </Tooltip>
              <Tooltip label={onlyFavs ? "Show all projects" : "Show bookmarked only"}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Show bookmarked only"
                  aria-pressed={onlyFavs}
                  className={cn(
                    "hover:text-foreground",
                    onlyFavs ? "text-amber-500 hover:text-amber-500" : "text-muted-foreground"
                  )}
                  onClick={() => setOnlyFavs((v) => !v)}
                >
                  <Bookmark className={cn("size-4", onlyFavs && "fill-current")} />
                </Button>
              </Tooltip>
            </>
          )}
          <Tooltip label="Settings">
            <SettingsMenu />
          </Tooltip>
          <Tooltip label={theme === "dark" ? "Light theme" : "Dark theme"}>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-4xl">
          {projects.length === 0 ? (
            // Until the first listProjects resolves we don't know whether the
            // library is empty, so don't flash the first-run welcome.
            projectsLoaded ? (
            <Empty className="min-h-[60vh] py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LeafLogo className="size-7" />
                </EmptyMedia>
                <EmptyTitle>Welcome to Oleafly</EmptyTitle>
                <EmptyDescription>
                  A local-first LaTeX &amp; resume studio. Everything stays on your disk -
                  create your first project to get going. Your PDFs are about to get a whole lot prettier.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="max-w-2xl">
                <Button
                  data-testid="create-first-project"
                  data-tour="new-project"
                  className="bg-primary text-white hover:bg-primary"
                  onClick={() => setNewProjectOpen(true)}
                >
                  <Plus className="size-4" /> Create your first project
                </Button>
              </EmptyContent>
            </Empty>
            ) : null
          ) : (
          visibleProjects.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {onlyFavs && activeFilterCount === 0
                ? "No bookmarked projects yet. Hover a book and click its bookmark to add one."
                : "No projects match the current filters."}
            </p>
          ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {visibleProjects.map((p) => (
              <ContextMenu key={p.id}>
                <ContextMenuTrigger asChild>
                  <div className="flex justify-center">
                    <Book
                      title={p.name}
                      color={projectColors[p.id] ?? (p.color || DEFAULT_BOOK_COLOR)}
                      date={projectModifiedLabel(p.updated_at)}
                      engine={projectEngineLabel(p.engine, p.main_doc)}
                      starred={favs.includes(p.id)}
                      onStarToggle={() => toggleFav(p.id)}
                      onClick={() => void openProject(p.id)}
                      onPreviewRequest={() => hoverPreview && loadThumb(p.id, p.updated_at)}
                      preview={hoverPreview ? thumbs[p.id] : undefined}
                    />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-52">
                  <ContextMenuItem onClick={() => void openProject(p.id)}>
                    <FileText className="mr-2 size-4" /> Open project
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      window.setTimeout(() => setDetailsProject(p), 0);
                    }}
                  >
                    <Info className="mr-2 size-4" /> Project details
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      window.setTimeout(() => setHistoryProject(p), 0);
                    }}
                  >
                    <History className="mr-2 size-4" /> Export history
                  </ContextMenuItem>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Palette className="mr-2 size-4" /> Change book color
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-44">
                      {BOOK_COLOR_OPTIONS.map((c) => {
                        const active = (projectColors[p.id] ?? (p.color || DEFAULT_BOOK_COLOR)) === c.hex;
                        return (
                          <ContextMenuItem key={c.hex} onClick={() => setProjectColor(p.id, c.hex)}>
                            <span className="mr-2 size-3.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: c.hex }} />
                            {c.name}
                            {active && <Check className="ml-auto size-3.5" />}
                          </ContextMenuItem>
                        );
                      })}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuItem
                    onClick={() => {
                      setForkName(`${p.name} (copy)`);
                      setForkTarget({ id: p.id, name: p.name });
                    }}
                  >
                    <GitFork className="mr-2 size-4" /> Fork project
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={async () => {
                      if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
                      try {
                        cancelAutoCommit(p.id);
                        await deleteProject(p.id);
                        removeFav(p.id);
                        removeProjectColor(p.id);
                        await refreshProjects();
                        toast.success(`Deleted "${p.name}".`);
                      } catch (e) {
                        notifyError("delete project", e, `Couldn't delete "${p.name}".`);
                      }
                    }}
                  >
                    <Trash2 className="mr-2 size-4" /> Delete project
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
          )
          )}
        </div>
      </div>

      {/* New Project gallery is mounted globally (GlobalNewProject), not here. */}
      {detailsProject && <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            setDetailsProject(null);
            releasePointerLock();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Project details</DialogTitle>
            <DialogDescription>
              Read-only metadata used by project search and filters.
            </DialogDescription>
          </DialogHeader>
          {currentDetailsProject && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="min-w-0 break-words font-medium">{currentDetailsProject.name}</dd>
              <dt className="text-muted-foreground">Project ID</dt>
              <dd className="min-w-0 break-all font-mono text-xs">{currentDetailsProject.id}</dd>
              <dt className="text-muted-foreground">Engine</dt>
              <dd>{projectEngineLabel(currentDetailsProject.engine, currentDetailsProject.main_doc)}</dd>
              <dt className="text-muted-foreground">Kind</dt>
              <dd className="capitalize">{currentDetailsProject.kind || "document"}</dd>
              <dt className="text-muted-foreground">Main document</dt>
              <dd className="min-w-0 break-all font-mono text-xs">
                {currentDetailsProject.main_doc}
              </dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{projectDateTime(currentDetailsProject.created_at)}</dd>
              <dt className="text-muted-foreground">Modified</dt>
              <dd>{projectDateTime(currentDetailsProject.updated_at)}</dd>
              <dt className="text-muted-foreground">Cover color</dt>
              <dd className="flex items-center gap-2">
                <span
                  className="size-3.5 rounded-full border"
                  style={{ background: currentDetailsProject.color || DEFAULT_BOOK_COLOR }}
                />
                <span className="font-mono text-xs">
                  {currentDetailsProject.color || DEFAULT_BOOK_COLOR}
                </span>
              </dd>
              <dt className="text-muted-foreground">Bookmarked</dt>
              <dd>{favs.includes(currentDetailsProject.id) ? "Yes" : "No"}</dd>
              <dt className="text-muted-foreground">PDF preview</dt>
              <dd>{currentDetailsProject.has_preview ? "Available" : "Not available"}</dd>
              <dt className="text-muted-foreground">Exports</dt>
              <dd>{currentDetailsProject.exports.length}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>}

      {historyProject && <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            setHistoryProject(null);
            releasePointerLock();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Export history</DialogTitle>
            <DialogDescription asChild>
              <p>
                {currentHistoryProject ? (
                  <>
                    Files exported from{" "}
                    <strong className="font-medium text-foreground">
                      “{currentHistoryProject.name}”
                    </strong>
                  </>
                ) : (
                  "Files exported from this project"
                )}
              </p>
            </DialogDescription>
          </DialogHeader>
          {currentHistoryProject &&
            (currentHistoryProject.exports.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                This project has no recorded exports
              </p>
            ) : (
              <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                {keyedExports(currentHistoryProject.exports).map(({ item, key }) => (
                  <div
                    key={key}
                    className="flex flex-col gap-1 rounded-lg border bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 break-words text-sm font-medium">
                        {item.filename}
                      </span>
                      <span className="shrink-0 text-xs font-medium uppercase text-muted-foreground">
                        {item.format || "file"}
                      </span>
                    </div>
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {item.path}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="size-3" />
                      {projectDateTime(item.date)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
        </DialogContent>
      </Dialog>}

      {forkTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <button type="button" aria-label="Close fork dialog" className="absolute inset-0" onMouseDown={onForkBackdropMouseDown} />
          <div
            ref={forkDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-fork-title"
            tabIndex={-1}
            className="relative w-full max-w-md rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="library-fork-title" className="text-base font-semibold">Fork project</h2>
              <Button variant="ghost" size="icon" className="size-7" onClick={closeFork}>
                <X className="size-4" />
              </Button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Copies <span className="font-medium text-foreground">{forkTarget.name}</span> and its full history into a new project.
            </p>
            <div className="flex items-center gap-2">
              <Input
                data-modal-initial-focus
                value={forkName}
                onChange={(e) => setForkName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submitFork(); }}
                placeholder="New project name"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
              />
              <Button onClick={() => void submitFork()}>Fork</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
