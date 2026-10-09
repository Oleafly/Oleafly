import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  BookmarkX,
  Clock3,
  FolderInput,
  LayoutGrid,
  List,
  SearchX,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { QuerySearch, queryIssueMessage } from "@/components/ui/query-search";
import {
  analyze,
  clearQualifiers,
  compile,
  readFacet,
  sortItems,
  writeFacet,
} from "@oleafly/search-query";
import {
  buildProjectSearchSchema,
  DEFAULT_PROJECT_SORT,
  PROJECT_FACETS,
  projectEngineLabel,
  type ProjectFacet,
} from "@/components/library/project-search";
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
import {
  HomeDock,
  HOME_DOCK_GLASS_SURFACE,
} from "@/components/library/HomeDock";
import { HOME_CHROME_SURFACE } from "@/components/library/home-chrome";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { markBootStage } from "@/lib/boot-telemetry";
import { useOverlayScrollbar } from "@/hooks/use-overlay-scrollbar";
import { WindowControls } from "@/components/layout/WindowControls";
import { Tooltip } from "@/components/ui/tooltip";
import { ModalShell } from "@/components/ui/modal-shell";
import {
  DEFAULT_BOOK_COLOR,
  useBookColorLabels,
} from "@/components/library/Book";
import {
  ProjectGrid,
  ProjectList,
  projectKindLabel,
  type ProjectCardActions,
  type ProjectCardData,
} from "@/components/library/ProjectCollection";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { DotPattern } from "@/components/ui/dot-pattern";
import { GridPattern } from "@/components/ui/grid-pattern";
import { useFavoritesStore } from "@/store/favorites";
import { useProjectColorsStore } from "@/store/project-colors";
import { decodeAppError, PROJECT_NOT_FOUND } from "@/lib/app-error";
import { useDisplayPath } from "@/lib/display-path";
import { logError } from "@/lib/log";
import { notifyError, toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { cn, isLinux, isWindows } from "@/lib/utils";
import {
  recycleProject,
  duplicateProject,
  readCompiledPdf,
  removeLinkedProject,
  revealProject,
  type ProjectAvailability,
  type ProjectInfo,
} from "@/lib/tauri";
import {
  folderAvailability,
  isFolderProject,
  projectUpdatedAt,
} from "@/lib/library-projects";
import {
  asUnavailable,
  type UnavailableFolder,
} from "@/components/library/folder-state";
import { FolderUnavailableDialog } from "@/components/library/FolderUnavailableDialog";
import { copyIntoLibrary } from "@/store/copy-into-library";
import { useLibraryAvailabilityStore } from "@/store/library-availability";
import { formatNumber } from "@/lib/intl";
import { projectDateTime } from "@/lib/project-format";
import { ProjectImportMenu } from "@/components/library/ProjectImportMenu";
import { LibraryStartChoices } from "@/components/library/LibraryStartChoices";
import { OpenFolderButton } from "@/components/library/OpenFolderButton";
import { OpenFolderNotice } from "@/components/library/OpenFolderNotice";
import { Spinner } from "@/components/ui/spinner";

const thumbCache = new Map<string, string | null>();
const MAX_THUMBNAILS = 64;
const THUMBNAIL_SCROLL_SETTLE_MS = 160;
// In-flight keys so a second hover during a load does not start a parallel job.
const thumbInflight = new Set<string>();

const ALL_FILTER = "all";
const CUSTOM_FILTER = "custom";

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

function FilterSelect({
  name,
  label,
  value,
  options,
  onChange,
  customLabel,
  className,
}: Readonly<{
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  customLabel: string;
  className?: string;
}>) {
  const id = `project-filter-${name}`;
  return (
    <label
      htmlFor={id}
      className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium", className)}
    >
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          className="h-10 border-white/20 bg-background/35 text-sm backdrop-blur-md dark:border-white/10"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
            {value === CUSTOM_FILTER ? (
              <SelectItem value={CUSTOM_FILTER} disabled>
                {customLabel}
              </SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}

export function Library() {
  const { t } = useTranslation(["common", "library"]);
  const displayPath = useDisplayPath();
  const colorLabels = useBookColorLabels();
  // Home-shell pages (deadlines/pdf-import/latex-tools/library) are mutually
  // exclusive siblings gated on the same store, so switching between them
  // never requires closing one first.
  const page = useHomeViewStore((s) => s.page);
  const projects = useFilesStore((s) => s.projects);
  const projectsLoaded = useFilesStore((s) => s.projectsLoaded);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const openProject = useFilesStore((s) => s.openProject);
  const favs = useFavoritesStore((s) => s.favs);
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const projectColors = useProjectColorsStore((s) => s.colors);
  const setProjectColor = useProjectColorsStore((s) => s.setColor);
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const hoverPreview = useSettingsStore((s) => s.hoverPreview);
  const bgPattern = useSettingsStore((s) => s.bgPattern);
  const projectLayout = useSettingsStore((s) => s.homeProjectLayout);
  const setProjectLayout = useSettingsStore((s) => s.setHomeProjectLayout);
  const [forkTarget, setForkTarget] = useState<{ id: string; name: string } | null>(null);
  const [forkName, setForkName] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const forkBusyRef = useRef(false);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverlayScrollbar(scrollRef);
  const [detailsProject, setDetailsProject] = useState<ProjectInfo | null>(null);
  const [historyProject, setHistoryProject] = useState<ProjectInfo | null>(null);
  const [previewProject, setPreviewProject] = useState<ProjectInfo | null>(null);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProjectInfo | null>(null);
  const [unavailableTarget, setUnavailableTarget] = useState<{
    project: ProjectInfo;
    state: UnavailableFolder;
  } | null>(null);
  const checkedFolders = useLibraryAvailabilityStore((s) => s.checked);
  const modifiedFolders = useLibraryAvailabilityStore((s) => s.modified);
  const checkFolders = useLibraryAvailabilityStore((s) => s.check);
  const folderKey = useMemo(
    () => projects.filter(isFolderProject).map((project) => project.id).join("\n"),
    [projects],
  );
  const hasFolders = folderKey.length > 0;
  const availabilityOf = (project: ProjectInfo): ProjectAvailability =>
    folderAvailability(project, checkedFolders);
  const updatedAtOf = (project: ProjectInfo) => projectUpdatedAt(project, modifiedFolders);
  const coverColor = useCallback(
    (project: ProjectInfo) => projectColors[project.id] ?? (project.color || DEFAULT_BOOK_COLOR),
    [projectColors],
  );
  const searchSchema = useMemo(
    () =>
      buildProjectSearchSchema(t, {
        favorites: favs,
        modified: modifiedFolders,
        colorOf: coverColor,
        colorLabels,
      }),
    [t, favs, modifiedFolders, coverColor, colorLabels],
  );
  const analyzedQuery = useMemo(
    () => analyze(query, searchSchema, { now: Date.now() }),
    [query, searchSchema],
  );
  const facetValue = (facet: ProjectFacet, fallback = ALL_FILTER) => {
    const state = readFacet(analyzedQuery, PROJECT_FACETS[facet]);
    if (state.kind === "option") return state.id;
    return state.kind === "custom" ? CUSTOM_FILTER : fallback;
  };
  const [hadFolders, setHadFolders] = useState(hasFolders);
  if (hadFolders !== hasFolders) {
    setHadFolders(hasFolders);
    if (!hasFolders) setQuery(writeFacet(query, analyzedQuery, PROJECT_FACETS.location, null));
  }
  const setFacet = (facet: ProjectFacet, id: string, fallback = ALL_FILTER) => {
    if (id === CUSTOM_FILTER) return;
    setQuery(writeFacet(query, analyzedQuery, PROJECT_FACETS[facet], id === fallback ? null : id));
  };
  const openFromLibrary = (project: ProjectInfo) => {
    const state = asUnavailable(availabilityOf(project));
    if (state) {
      window.setTimeout(() => setUnavailableTarget({ project, state }), 0);
      return;
    }
    void openProject(project.id);
  };
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
  const openProjectPreview = async (project: ProjectInfo) => {
    const request = ++previewRequestRef.current;
    setPreviewProject(project);
    setPreviewBytes(null);
    setPreviewError(null);
    try {
      const bytes = new Uint8Array(await readCompiledPdf(project.id));
      if (previewRequestRef.current !== request) return;
      setPreviewBytes(bytes);
    } catch (error) {
      if (previewRequestRef.current !== request) return;
      void logError("library PDF preview", error);
      setPreviewError(t(($) => $.library.projects.preview.failed));
    }
  };
  const closeProjectPreview = () => {
    previewRequestRef.current += 1;
    setPreviewProject(null);
    setPreviewBytes(null);
    setPreviewError(null);
    releasePointerLock();
  };

  const lastScrollAt = useRef(Number.NEGATIVE_INFINITY);
  const pendingThumbnail = useRef<{ id: string; timer: number } | null>(null);
  const cancelPendingThumbnail = () => {
    if (!pendingThumbnail.current) return;
    window.clearTimeout(pendingThumbnail.current.timer);
    pendingThumbnail.current = null;
  };
  const cardHandlers = useRef<ProjectCardActions | null>(null);
  cardHandlers.current = {
    open: openFromLibrary,
    openById: (id) => void openProject(id),
    toggleFavorite: toggleFav,
    showPreview: (project) => void openProjectPreview(project),
    requestThumbnail: (project) => {
      if (!hoverPreview) return;
      cancelPendingThumbnail();
      const wait = THUMBNAIL_SCROLL_SETTLE_MS - (performance.now() - lastScrollAt.current);
      if (wait <= 0 || thumbCache.has(`${project.id}:${project.updated_at}`)) {
        loadThumb(project.id, project.updated_at);
        return;
      }
      pendingThumbnail.current = {
        id: project.id,
        timer: window.setTimeout(() => {
          pendingThumbnail.current = null;
          cardHandlers.current?.requestThumbnail(project);
        }, wait),
      };
    },
    releaseThumbnail: (project) => {
      if (pendingThumbnail.current?.id === project.id) cancelPendingThumbnail();
    },
    reveal: (id) => {
      void revealProject(id).catch((error: unknown) => notifyError("reveal folder", error));
    },
    copyIntoLibrary: (project) => void copyIntoLibrary(project.id, project.name),
    setColor: setProjectColor,
    remove: (project) => {
      window.setTimeout(() => setRemoveTarget(project), 0);
    },
    details: (project) => {
      window.setTimeout(() => setDetailsProject(project), 0);
    },
    history: (project) => {
      window.setTimeout(() => setHistoryProject(project), 0);
    },
    fork: (project) => {
      setForkName(t(($) => $.library.projects.forkDialog.copySuffix, { name: project.name }));
      setForkTarget({ id: project.id, name: project.name });
    },
    trash: (project) => {
      window.setTimeout(() => setDeleteTarget({ id: project.id, name: project.name }), 0);
    },
  };
  const cardActions = useMemo<ProjectCardActions>(
    () => ({
      open: (project) => cardHandlers.current?.open(project),
      openById: (id) => cardHandlers.current?.openById(id),
      toggleFavorite: (id) => cardHandlers.current?.toggleFavorite(id),
      showPreview: (project) => cardHandlers.current?.showPreview(project),
      requestThumbnail: (project) => cardHandlers.current?.requestThumbnail(project),
      releaseThumbnail: (project) => cardHandlers.current?.releaseThumbnail(project),
      reveal: (id) => cardHandlers.current?.reveal(id),
      copyIntoLibrary: (project) => cardHandlers.current?.copyIntoLibrary(project),
      setColor: (id, hex) => cardHandlers.current?.setColor(id, hex),
      remove: (project) => cardHandlers.current?.remove(project),
      details: (project) => cardHandlers.current?.details(project),
      history: (project) => cardHandlers.current?.history(project),
      fork: (project) => cardHandlers.current?.fork(project),
      trash: (project) => cardHandlers.current?.trash(project),
    }),
    [],
  );
  const confirmProjectDeletion = async () => {
    const target = deleteTarget;
    if (!target) return;

    // Close the confirmation before invoking the destructive backend command.
    // This also makes repeated Enter/click events harmless.
    setDeleteTarget(null);
    try {
      await recycleProject(target.id);
    } catch (error) {
      const typed = decodeAppError(error);
      if (typed?.code === PROJECT_NOT_FOUND) {
        await refreshProjects().catch((refreshError: unknown) => {
          void logError("refresh projects after delete", refreshError);
        });
      }
      notifyError(
        "delete project",
        error,
        typed
          ? undefined
          : t(($) => $.library.projects.deleteDialog.failed, { name: target.name }),
      );
      return;
    }
    try {
      await refreshProjects();
    } catch (error) {
      void logError("refresh projects after delete", error);
    }
    toast.success(
      t(($) => $.library.projects.deleteDialog.moved, { name: target.name }),
    );
  };
  const confirmFolderRemoval = async () => {
    const target = removeTarget;
    if (!target) return;
    setRemoveTarget(null);
    try {
      await removeLinkedProject(target.id);
    } catch (error) {
      notifyError(
        "remove folder from library",
        error,
        decodeAppError(error)
          ? undefined
          : t(($) => $.library.folder.remove.failed, { name: target.name }),
      );
      return;
    }
    try {
      await refreshProjects();
    } catch (error) {
      void logError("refresh projects after removing a folder", error);
    }
    toast.success(t(($) => $.library.folder.remove.done, { name: target.name }));
  };

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
      // A hover preview is low-stakes: the full worker retry/fallback chain
      // can otherwise take 100+ seconds in the worst case, which just leaves
      // the hover stuck looking broken far longer than any hover lasts. Bound
      // it generously enough for the retry+fallback chain to get a fair shot
      // (two worker-setup timeouts plus the main-thread fallback), but not
      // the full multi-stage worst case.
      return pdfPageToPng(new Uint8Array(buf), 1, 1.2, "#ffffff", { overallTimeoutMs: 15_000 });
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

  const sortOptions = (searchSchema.field("sort")?.options ?? []).map((option) => ({
    value: option.value,
    label: option.meta?.label ?? option.value,
  }));
  const hasQualifiers = analyzedQuery.terms.some((term) => term.role !== "text");
  const hasActiveFilters = analyzedQuery.terms.some((term) => term.role !== "text" && term.valid);
  const bookmarkIsOnlyActiveFilter =
    analyzedQuery.terms.length === 1 && facetValue("bookmark") === "yes";
  const visibleProjects = useMemo(() => {
    const compiled = compile(analyzedQuery, searchSchema, { now: Date.now() });
    const ordered = [...projects].sort((a, b) => a.id.localeCompare(b.id));
    return sortItems(
      ordered.filter((project) => project.recovery_pending || compiled.test(project)),
      compiled.sort,
    );
  }, [projects, analyzedQuery, searchSchema]);
  const favoriteSet = useMemo(() => new Set(favs), [favs]);
  const forkNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const project of projects) {
      if (!names.has(project.id)) names.set(project.id, project.name);
    }
    return names;
  }, [projects]);
  const cardData: ProjectCardData = {
    colorOf: coverColor,
    folderStateOf: (project) => asUnavailable(availabilityOf(project)),
    updatedAtOf,
    favorites: favoriteSet,
    thumbs,
    forkNames,
    hoverPreview,
    actions: cardActions,
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (page !== "library" || !scroller) return;
    const onScroll = () => {
      lastScrollAt.current = performance.now();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [page]);

  useEffect(
    () => () => {
      if (pendingThumbnail.current) window.clearTimeout(pendingThumbnail.current.timer);
      pendingThumbnail.current = null;
    },
    [],
  );

  // Returning to the library refetches, so externally created or edited
  // projects (and their dates) show up. The store single-flights this with
  // App.tsx's boot call, so mounting during boot costs no extra IPC.
  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (projectsLoaded) markBootStage("projects-loaded");
  }, [projectsLoaded]);

  useEffect(() => {
    if (page !== "library" || !projectsLoaded || !folderKey) return;
    const ids = folderKey.split("\n");
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => void checkFolders(ids), 0);
    });
    const recheck = () => void checkFolders(ids);
    window.addEventListener("focus", recheck);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("focus", recheck);
    };
  }, [page, projectsLoaded, folderKey, checkFolders]);

  const submitFork = async () => {
    if (!forkTarget || forkBusyRef.current) return;
    forkBusyRef.current = true;
    setForkBusy(true);
    const n =
      forkName.trim() ||
      t(($) => $.library.projects.forkDialog.copySuffix, { name: forkTarget.name });
    try {
      const id = await duplicateProject(forkTarget.id, n);
      await refreshProjects();
      if (id) setProjectColor(id, DEFAULT_BOOK_COLOR);
    } catch (e) {
      notifyError(
        "fork project",
        e,
        decodeAppError(e) ? undefined : t(($) => $.library.projects.forkDialog.failed),
      );
    } finally {
      forkBusyRef.current = false;
      setForkBusy(false);
    }
    setForkTarget(null);
    setForkName("");
  };

  if (page !== "library") return null;
  const renderLayoutSwitcher = () => (
    <div data-tauri-drag-region className="flex min-w-max items-center">
      {projects.length > 0 ? (
        <fieldset
          aria-label={t(($) => $.library.home.layoutGroup)}
          className={cn(
            HOME_CHROME_SURFACE,
            "flex items-center rounded-xl p-1",
            (isWindows || isLinux) && "mr-3",
          )}
        >
          {([
            { mode: "list", label: t(($) => $.library.home.listView), icon: List },
            { mode: "grid", label: t(($) => $.library.home.gridView), icon: LayoutGrid },
          ] as const).map(({ mode, label, icon: Icon }) => (
            <Tooltip key={mode} label={label} side="bottom">
              <button
                type="button"
                onClick={() => setProjectLayout(mode)}
                aria-label={label}
                aria-pressed={projectLayout === mode}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors focus-visible:bg-accent/60 focus-visible:text-foreground",
                  projectLayout === mode
                    ? "bg-accent text-foreground"
                    : "hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4" />
              </button>
            </Tooltip>
          ))}
        </fieldset>
      ) : null}
      <WindowControls />
    </div>
  );

  const renderProjectCollection = () => (
    projects.length > 0 && visibleProjects.length > 0 && (
      projectLayout === "grid" ? (
        <ProjectGrid projects={visibleProjects} data={cardData} scrollRef={scrollRef} />
      ) : (
        <ProjectList projects={visibleProjects} data={cardData} scrollRef={scrollRef} />
      )
    )
  );

  const renderPreviewDialog = () => (
    previewProject && (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) closeProjectPreview();
        }}
      >
        <DialogContent className="h-[min(88vh,56rem)] max-w-[54rem] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
          <DialogHeader className="px-5 py-4 pr-12">
            <DialogTitle>
              {t(($) => $.library.projects.preview.title, { name: previewProject.name })}
            </DialogTitle>
            <DialogDescription>
              {t(($) => $.library.projects.preview.description)}
            </DialogDescription>
          </DialogHeader>
          <div className="relative min-h-0 overflow-hidden border-t bg-sidebar">
            {previewError ? (
              <div
                role="alert"
                className="flex h-full select-text items-center justify-center p-8 text-sm text-destructive"
              >
                {previewError}
              </div>
            ) : null}
            {!previewError && (previewBytes ? (
              <section
                data-pdf-scroll-root
                aria-label={t(($) => $.library.projects.preview.region, {
                  name: previewProject.name,
                })}
                className="h-full overflow-auto focus-visible:bg-accent/20"
              >
                <PdfViewer
                  data={previewBytes}
                  documentIdentity={`library:${previewProject.id}:${previewProject.updated_at}`}
                  scale={1}
                  layout="single"
                />
              </section>
            ) : (
              <output
                aria-live="polite"
                className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground"
              >
                <Spinner />
                {t(($) => $.library.projects.preview.loading)}
              </output>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    )
  );

  const renderDetailsDialog = () => (
    detailsProject && <Dialog
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
          <DialogTitle>{t(($) => $.library.projects.detailsDialog.title)}</DialogTitle>
          <DialogDescription>
            {t(($) => $.library.projects.detailsDialog.description)}
          </DialogDescription>
        </DialogHeader>
        {currentDetailsProject && (
          <dl className="grid select-text grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.name)}
            </dt>
            <dd className="min-w-0 break-words font-medium">{currentDetailsProject.name}</dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.id)}
            </dt>
            <dd className="min-w-0 break-all font-mono text-xs">{currentDetailsProject.id}</dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.engine)}
            </dt>
            <dd>{projectEngineLabel(currentDetailsProject)}</dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.kind)}
            </dt>
            <dd className="capitalize">{projectKindLabel(t, currentDetailsProject.kind)}</dd>
            {currentDetailsProject.forked_from && (
              <>
                <dt className="text-muted-foreground">
                  {t(($) => $.library.projects.detailsDialog.forkedFrom)}
                </dt>
                <dd className="min-w-0 break-words">{currentDetailsProject.forked_from}</dd>
              </>
            )}
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.mainDocument)}
            </dt>
            <dd className="min-w-0 break-all font-mono text-xs">
              {currentDetailsProject.main_doc}
            </dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.created)}
            </dt>
            <dd>{projectDateTime(currentDetailsProject.created_at)}</dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.modified)}
            </dt>
            <dd>{projectDateTime(currentDetailsProject.updated_at)}</dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.color)}
            </dt>
            <dd className="flex items-center gap-2">
              <span
                className="size-3.5 rounded-full border"
                style={{ background: currentDetailsProject.color || DEFAULT_BOOK_COLOR }}
              />
              <span className="font-mono text-xs">
                {currentDetailsProject.color || DEFAULT_BOOK_COLOR}
              </span>
            </dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.bookmarked)}
            </dt>
            <dd>
              {favs.includes(currentDetailsProject.id)
                ? t(($) => $.common.actions.yes)
                : t(($) => $.common.actions.no)}
            </dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.preview)}
            </dt>
            <dd>
              {currentDetailsProject.has_preview
                ? t(($) => $.library.projects.detailsDialog.previewAvailable)
                : t(($) => $.library.projects.detailsDialog.previewUnavailable)}
            </dd>
            <dt className="text-muted-foreground">
              {t(($) => $.library.projects.detailsDialog.exports)}
            </dt>
            <dd>{currentDetailsProject.exports.length}</dd>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );

  const renderHistoryDialog = () => (
    historyProject && <Dialog
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
          <DialogTitle>{t(($) => $.library.projects.exportsDialog.title)}</DialogTitle>
          <DialogDescription asChild>
            <p>
              {currentHistoryProject ? (
                <Trans
                  ns="library"
                  i18nKey={($) => $.library.projects.exportsDialog.from}
                  values={{ name: currentHistoryProject.name }}
                  components={{
                    name: <strong className="font-medium text-foreground" />,
                  }}
                />
              ) : (
                t(($) => $.library.projects.exportsDialog.fromUnknown)
              )}
            </p>
          </DialogDescription>
        </DialogHeader>
        {currentHistoryProject &&
          (currentHistoryProject.exports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(($) => $.library.projects.exportsDialog.empty)}
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
                      {item.format || t(($) => $.library.projects.exportsDialog.fallbackFormat)}
                    </span>
                  </div>
                  <span className="select-text break-all font-mono text-xs text-muted-foreground">
                    {displayPath(item.path)}
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
    </Dialog>
  );

  const renderFirstRunWelcome = () => (
    projects.length === 0 && (
      // Until the first listProjects resolves we don't know whether the
      // library is empty, so don't flash the first-run welcome.
      projectsLoaded ? (
      <Empty className="min-h-[60vh] py-10">
        <EmptyHeader className="max-w-2xl">
          <EmptyMedia className="size-16 overflow-hidden rounded-2xl border-white/20 bg-white p-0 shadow-sm sm:size-20">
            <img
              src="/oleafly-tile-gradient.png"
              alt={t(($) => $.library.home.appIconAlt)}
              className="size-full object-cover"
            />
          </EmptyMedia>
          <EmptyTitle>{t(($) => $.library.home.welcomeTitle)}</EmptyTitle>
          <EmptyDescription className="max-w-xl leading-relaxed">
            {t(($) => $.library.home.welcomeDescription)}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-2xl items-center">
          <LibraryStartChoices onNewProject={() => setNewProjectOpen(true)} />
        </EmptyContent>
      </Empty>
      ) : (
        <div className="flex min-h-[60vh] items-center justify-center">
          <output
            aria-live="polite"
            className="flex flex-col items-center gap-3"
          >
            <LeafLogo className="size-8 opacity-80" />
            <span className="ai-shimmer text-sm text-muted-foreground">
              {t(($) => $.library.home.loading)}
            </span>
          </output>
        </div>
      )
    )
  );

  const renderNoMatchesEmpty = () => (
    projects.length > 0 && visibleProjects.length === 0 ? (
      <Empty className="min-h-[60vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {bookmarkIsOnlyActiveFilter ? (
              <BookmarkX className="size-6" />
            ) : (
              <SearchX className="size-6" />
            )}
          </EmptyMedia>
          <EmptyTitle>
            {bookmarkIsOnlyActiveFilter
              ? t(($) => $.library.home.noBookmarksTitle)
              : t(($) => $.library.home.noMatchesTitle)}
          </EmptyTitle>
          <EmptyDescription>
            {bookmarkIsOnlyActiveFilter
              ? t(($) => $.library.home.noBookmarksDescription)
              : t(($) => $.library.home.noMatchesDescription)}
          </EmptyDescription>
          {analyzedQuery.diagnostics.map((issue) => (
            <p
              key={`${issue.code}-${issue.span.start}`}
              className="text-xs text-amber-700 dark:text-amber-400"
            >
              {queryIssueMessage(t, issue, query, searchSchema)}
            </p>
          ))}
        </EmptyHeader>
      </Empty>
    ) : null
  );

  const renderLibraryToolbar = () => (
    <div className="flex w-full min-w-0 max-w-[42rem] items-center gap-1.5 justify-self-center">
    {projects.length > 0 ? (
      <QuerySearch
        value={query}
        onChange={setQuery}
        query={analyzedQuery}
        schema={searchSchema}
        ariaLabel={t(($) => $.library.home.searchLabel)}
        placeholder={t(($) => $.library.home.searchPlaceholder, {
          count: projects.length,
          total: formatNumber(projects.length),
        })}
        clearLabel={t(($) => $.library.home.clearSearch)}
        className={cn(HOME_CHROME_SURFACE, "h-11 flex-1 rounded-2xl")}
      />
    ) : (
      <span />
    )}
    <div
      data-tauri-drag-region
      className="flex shrink-0 items-center gap-1.5"
    >
    {projects.length > 0 ? <OpenFolderButton className="order-2" /> : null}
    {projects.length > 0 ? (
      <div className="order-2">
        <ProjectImportMenu
          align="end"
          triggerTooltip={t(($) => $.library.home.import)}
          trigger={(busy) => (
            <Button
              data-testid="import-project-button"
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={t(($) => $.library.home.import)}
              className={cn(
                HOME_CHROME_SURFACE,
                "size-10 rounded-2xl p-0 text-muted-foreground hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground dark:focus-visible:bg-accent/60",
              )}
            >
              {busy ? (
                <Spinner />
              ) : (
                <FolderInput className="size-4" />
              )}
            </Button>
          )}
        />
      </div>
    ) : null}
    {projects.length > 0 && (
      <Tooltip label={t(($) => $.library.home.advancedFilters)} className="order-1">
          <Popover
            ariaLabel={t(($) => $.library.home.advancedFilters)}
            align="right"
            closeOnClick={false}
            className={cn(
              HOME_DOCK_GLASS_SURFACE,
              "relative flex w-96 flex-col gap-3 overflow-hidden rounded-2xl !border-white/25 !bg-background/70 p-4 backdrop-blur-2xl backdrop-saturate-150 before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(145deg,rgba(255,255,255,0.09),transparent_42%,rgba(255,255,255,0.025))] dark:!border-white/15 dark:!bg-background/65 [&>*]:relative [&>*]:z-[1]",
            )}
            triggerClassName={cn(
              HOME_CHROME_SURFACE,
              "size-10 rounded-2xl p-0",
            )}
            trigger={
              <span className="relative inline-flex">
                <SlidersHorizontal className="size-4" />
                {hasActiveFilters && (
                  <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" />
                )}
              </span>
            }
          >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold">
                {t(($) => $.library.home.filtersTitle)}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t(($) => $.library.home.filtersHint)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasQualifiers}
              onClick={() => setQuery(clearQualifiers(query, analyzedQuery))}
            >
              {t(($) => $.library.home.resetFilters)}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {hasFolders ? (
              <FilterSelect
                name="location"
                className="col-span-2"
                label={t(($) => $.library.home.filters.location)}
                value={facetValue("location")}                onChange={(value) => setFacet("location", value)}                customLabel={t(($) => $.library.home.customFilter)}
                options={[
                  { value: "all", label: t(($) => $.library.home.filters.locationAll) },
                  { value: "library", label: t(($) => $.library.home.filters.locationLibrary) },
                  { value: "external", label: t(($) => $.library.home.filters.locationExternal) },
                ]}
              />
            ) : null}
            <FilterSelect
              name="engine"
              label={t(($) => $.library.home.filters.engine)}
              value={facetValue("engine")}              onChange={(value) => setFacet("engine", value)}              customLabel={t(($) => $.library.home.customFilter)}
              options={[
                { value: "all", label: t(($) => $.library.home.filters.engineAll) },
                { value: "latex", label: "LaTeX" },
                { value: "typst", label: "Typst" },
                { value: "markdown", label: "Markdown" },
              ]}
            />
            <FilterSelect
              name="kind"
              label={t(($) => $.library.home.filters.kind)}
              value={facetValue("kind")}              onChange={(value) => setFacet("kind", value)}              customLabel={t(($) => $.library.home.customFilter)}
              options={[
                { value: "all", label: t(($) => $.library.home.filters.kindAll) },
                { value: "document", label: t(($) => $.library.home.filters.kindDocument) },
                { value: "image", label: t(($) => $.library.home.filters.kindImage) },
                { value: "diagram", label: t(($) => $.library.home.filters.kindDiagram) },
              ]}
            />
            <FilterSelect
              name="bookmark"
              label={t(($) => $.library.home.filters.bookmark)}
              value={facetValue("bookmark")}              onChange={(value) => setFacet("bookmark", value)}              customLabel={t(($) => $.library.home.customFilter)}
              options={[
                { value: "all", label: t(($) => $.library.home.filters.bookmarkAll) },
                { value: "yes", label: t(($) => $.library.home.filters.bookmarkYes) },
                { value: "no", label: t(($) => $.library.home.filters.bookmarkNo) },
              ]}
            />
            <FilterSelect
              name="preview"
              label={t(($) => $.library.home.filters.preview)}
              value={facetValue("preview")}              onChange={(value) => setFacet("preview", value)}              customLabel={t(($) => $.library.home.customFilter)}
              options={[
                { value: "all", label: t(($) => $.library.home.filters.previewAll) },
                { value: "yes", label: t(($) => $.library.home.filters.previewYes) },
                { value: "no", label: t(($) => $.library.home.filters.previewNo) },
              ]}
            />
            <FilterSelect
              name="created"
              label={t(($) => $.library.home.filters.created)}
              value={facetValue("created")}              onChange={(value) => setFacet("created", value)}              customLabel={t(($) => $.library.home.customFilter)}
              options={[
                { value: "all", label: t(($) => $.library.home.filters.anyTime) },
                { value: "7", label: t(($) => $.library.home.filters.last7Days) },
                { value: "30", label: t(($) => $.library.home.filters.last30Days) },
                { value: "365", label: t(($) => $.library.home.filters.lastYear) },
              ]}
            />
            <FilterSelect
              name="modified"
              label={t(($) => $.library.home.filters.modified)}
              value={facetValue("modified")}              onChange={(value) => setFacet("modified", value)}              customLabel={t(($) => $.library.home.customFilter)}
              options={[
                { value: "all", label: t(($) => $.library.home.filters.anyTime) },
                { value: "7", label: t(($) => $.library.home.filters.last7Days) },
                { value: "30", label: t(($) => $.library.home.filters.last30Days) },
                { value: "365", label: t(($) => $.library.home.filters.lastYear) },
              ]}
            />
            <FilterSelect
              name="sort"
              className="col-span-2"
              label={t(($) => $.library.home.sortBy)}
              value={facetValue("sort", DEFAULT_PROJECT_SORT)}
              onChange={(value) => setFacet("sort", value, DEFAULT_PROJECT_SORT)}
              customLabel={t(($) => $.library.home.customFilter)}
              options={sortOptions}
            />
          </div>
          </Popover>
      </Tooltip>
    )}
    </div>
    </div>
  );


  return (
    <div
      data-testid="library"
      data-tour="home"
      data-projects-loaded={projectsLoaded ? "true" : "false"}
      className="relative flex h-full flex-row bg-[var(--home-background)]"
    >
      {bgPattern === "grid" ? <GridPattern width={44} height={44} className="home-grid-fade" /> : null}
      {bgPattern === "dots" ? (
        <>
          <DotPattern width={22} height={22} radius={1} className="dark:hidden" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden dark:block dark:bg-[radial-gradient(oklch(1_0_0/0.17)_1px,transparent_1px)] dark:bg-[length:22px_22px]"
          />
        </>
      ) : null}
      <HomeDock />
      <div className="flex min-w-0 flex-1 flex-col">
      <header
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-20 h-16 bg-transparent"
      >
        <div
          data-tauri-drag-region
          className="grid h-16 grid-cols-[max-content_minmax(10rem,1fr)_max-content] items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8"
        >
          {projects.length > 0 ? (
            <div
              data-tauri-drag-region
              data-tour="home-brand"
              className="flex min-w-0 items-center gap-2"
            >
              <LeafLogo className="size-5 shrink-0" />
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Oleafly</h1>
            </div>
          ) : (
            <span data-tauri-drag-region />
          )}
          {renderLibraryToolbar()}
          {renderLayoutSwitcher()}
        </div>
      </header>

      <div
        ref={scrollRef}
        className={cn(
          "relative z-10 flex-1 overflow-auto pb-8",
          "pt-20",
          projectLayout === "list" ? "px-12" : "px-8",
        )}
      >
        <div
          className={cn(
            "mx-auto",
            projectLayout === "list"
              ? "w-[calc(100%_-_6rem)] max-w-[84rem]"
              : "max-w-4xl xl:max-w-5xl 2xl:max-w-7xl",
          )}
        >
          {renderFirstRunWelcome()}
          {projects.length > 0 ? <OpenFolderNotice className="mb-5" /> : null}
          {renderNoMatchesEmpty()}
          {renderProjectCollection()}
        </div>
      </div>
      </div>

      {/* New Project gallery is mounted globally (GlobalNewProject), not here. */}
      {renderPreviewDialog()}

      {renderDetailsDialog()}

      {renderHistoryDialog()}

      {forkTarget && (
        <ModalShell
          open
          onClose={closeFork}
          closeLabel={t(($) => $.library.projects.forkDialog.close)}
          width="md"
          labelledBy="library-fork-title"
          className="p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id="library-fork-title" className="text-base font-semibold">
              {t(($) => $.library.projects.forkDialog.title)}
            </h2>
            <Button variant="ghost" size="icon" className="size-7" onClick={closeFork}>
              <X className="size-4" />
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            <Trans
              ns="library"
              i18nKey={($) => $.library.projects.forkDialog.description}
              values={{ name: forkTarget.name }}
              components={{ name: <span className="font-medium text-foreground" /> }}
            />
          </p>
          <div className="flex items-center gap-2">
            <Input
              data-modal-initial-focus
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.repeat) void submitFork(); }}
              placeholder={t(($) => $.library.projects.forkDialog.namePlaceholder)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <Button onClick={() => void submitFork()} disabled={forkBusy}>
              {t(($) => $.library.projects.forkDialog.confirm)}
            </Button>
          </div>
        </ModalShell>
      )}
      <ConfirmationDialog
        open={deleteTarget !== null}
        title={t(($) => $.library.projects.deleteDialog.title, {
          name:
            deleteTarget?.name ?? t(($) => $.library.projects.deleteDialog.fallbackName),
        })}
        description={t(($) => $.library.projects.deleteDialog.description)}
        confirmLabel={t(($) => $.library.projects.deleteDialog.confirm)}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmProjectDeletion()}
      />
      <ConfirmationDialog
        open={removeTarget !== null}
        title={t(($) => $.library.folder.remove.title, { name: removeTarget?.name ?? "" })}
        description={t(($) => $.library.folder.remove.description)}
        confirmLabel={t(($) => $.library.folder.remove.confirm)}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void confirmFolderRemoval()}
      />
      <FolderUnavailableDialog
        key={unavailableTarget?.project.id ?? "closed"}
        project={unavailableTarget?.project ?? null}
        availability={unavailableTarget?.state ?? "missing"}
        reachable={
          unavailableTarget !== null && availabilityOf(unavailableTarget.project) === "ok"
        }
        onClose={() => {
          setUnavailableTarget(null);
          releasePointerLock();
        }}
        onOpen={(projectId) => {
          setUnavailableTarget(null);
          void openProject(projectId);
        }}
        onRemove={(project) => {
          setUnavailableTarget(null);
          window.setTimeout(() => setRemoveTarget(project), 0);
        }}
      />
    </div>
  );
}
