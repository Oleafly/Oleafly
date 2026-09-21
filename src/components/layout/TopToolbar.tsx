import { usePreviewDetachedStore } from "@/store/preview-detached";
import { reattachPreviewWindow } from "@/lib/preview-window";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Columns2,
  ChevronRight,
  Download,
  FileText,
  FileArchive,
  FileType,
  GitFork,
  History,
  Presentation,
  LayoutGrid,
  Loader2,
  ImagePlay,
  Maximize,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { CompileControls } from "@/components/layout/CompileControls";
import {
  SidebarCollapseToggle,
  WorkspaceDockControls,
} from "@/components/layout/WorkspaceControls";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { WindowControls } from "@/components/layout/WindowControls";
import { ToolbarAction } from "@/components/layout/ToolbarAction";
import "./top-toolbar.css";
import { engineErrorMessage, useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useProjectColorsStore } from "@/store/project-colors";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useSettingsStore, type LayoutPreset, type ViewMode } from "@/store/settings";
import { exportCurrentDocument, exportCurrentPdf, exportCurrentImagePng, type DocumentExportFormat } from "@/features/export";
import { exportRoutesFor } from "@oleafly/conversion-registry";
import {
  duplicateProject,
} from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFullscreen } from "@/lib/use-fullscreen";
import { notifyError, toast } from "@/lib/toast";
import { cn, isMac } from "@/lib/utils";
import { TOOLBAR_OVERFLOW, useToolbarLayout } from "@/lib/use-toolbar-layout";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { i18n } from "@/i18n";

type DocFormat = DocumentExportFormat;

/** Backend export format id for a registry target ("md"/"tex" are the ids). */
function formatForTarget(target: string): DocFormat {
  switch (target) {
    case "markdown":
      return "md";
    case "latex":
      return "tex";
    case "typst":
      return "typst";
    case "docx":
      return "docx";
    case "html":
      return "html";
    default:
      return "docx";
  }
}

function classifyDoc(source: string): "presentation" | "book" | "doc" {
  if (/\\documentclass(\[[^\]]*\])?\{\s*beamer\s*\}/.test(source)) return "presentation";
  if (/\\documentclass(\[[^\]]*\])?\{\s*(book|report|memoir|scrbook|scrreprt)\s*\}/.test(source))
    return "book";
  return "doc";
}

export const LAYOUT_OPTIONS: { preset: LayoutPreset; label: string; icon: typeof Columns2 }[] = [
  {
    preset: "editor-preview-ai",
    get label() {
      return i18n.t(($) => $.shell.toolbar.layouts.editorPreviewAi);
    },
    icon: Columns2,
  },
  {
    preset: "editor-preview",
    get label() {
      return i18n.t(($) => $.shell.toolbar.layouts.editorPreview);
    },
    icon: Columns2,
  },
  {
    preset: "editor-ai",
    get label() {
      return i18n.t(($) => $.shell.toolbar.layouts.editorAi);
    },
    icon: Columns2,
  },
  {
    preset: "preview-ai",
    get label() {
      return i18n.t(($) => $.shell.toolbar.layouts.previewAi);
    },
    icon: Columns2,
  },
  {
    preset: "editor-only",
    get label() {
      return i18n.t(($) => $.shell.toolbar.layouts.editorOnly);
    },
    icon: Maximize,
  },
  {
    preset: "preview-only",
    get label() {
      return i18n.t(($) => $.shell.toolbar.layouts.previewOnly);
    },
    icon: Columns2,
  },
  {
    preset: "ai-only",
    get label() {
      return i18n.t(($) => $.shell.toolbar.layouts.aiOnly);
    },
    icon: Sparkles,
  },
];

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: typeof Columns2 }[] = [
  {
    mode: "editor",
    get label() {
      return i18n.t(($) => $.shell.toolbar.views.editor);
    },
    icon: SquarePen,
  },
  {
    mode: "split",
    get label() {
      return i18n.t(($) => $.shell.toolbar.views.split);
    },
    icon: Columns2,
  },
  {
    mode: "pdf",
    get label() {
      return i18n.t(($) => $.shell.toolbar.views.pdf);
    },
    icon: FileText,
  },
];

// A layout preset is defined only by the editor/preview/AI panes, never the
// file tree (that is an independent surface), so the dropdown can always check
// the active layout regardless of whether the tree is open.
function activeLayoutPreset(
  viewMode: ViewMode,
  assistantOpen: boolean,
  workspaceHidden: boolean,
): LayoutPreset | null {
  if (workspaceHidden) return assistantOpen ? "ai-only" : null;
  if (viewMode === "split") return assistantOpen ? "editor-preview-ai" : "editor-preview";
  if (viewMode === "editor") return assistantOpen ? "editor-ai" : "editor-only";
  if (viewMode === "pdf") return assistantOpen ? "preview-ai" : "preview-only";
  return null;
}

export function ProjectHistoryActions() {
  const { t } = useTranslation(["shell"]);
  const openVersioning = useSettingsStore((state) => state.openVersioning);

  return (
    <Tooltip label={t(($) => $.shell.toolbar.versioning)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t(($) => $.shell.toolbar.versioning)}
        className="size-7 text-muted-foreground hover:text-foreground"
        onClick={() => openVersioning()}
      >
        <History className="size-4" />
      </Button>
    </Tooltip>
  );
}

function ViewModeSwitch({
  viewMode,
  setViewMode,
}: Readonly<{
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}>) {
  useTranslation();
  return (
    <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {VIEW_OPTIONS.map(({ mode, label, icon: Icon }) => {
        const active = viewMode === mode;
        return (
          <Tooltip key={mode} label={label} side="bottom">
            <button
              type="button"
              aria-label={label}
              aria-pressed={active}
              onClick={() => setViewMode(mode)}
              className={cn(
                "flex size-7 items-center justify-center rounded transition-colors",
                active
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function TopToolbar() {
  const { t } = useTranslation(["common", "shell"]);
  const projectName = useFilesStore((s) => s.projectName);
  const projectId = useFilesStore((s) => s.projectId);
  const detached = usePreviewDetachedStore((s) => s.projectId === projectId && projectId !== null);
  const projects = useFilesStore((s) => s.projects);
  const projectColors = useProjectColorsStore((s) => s.colors);
  const currentProject = projects.find((p) => p.id === projectId);
  const coverColor =
    (projectId ? projectColors[projectId] : undefined) ?? (currentProject?.color || DEFAULT_BOOK_COLOR);
  const projectKind = useFilesStore((s) => s.projectKind);
  const isSingleFigureProject = projectKind === "image" || projectKind === "diagram";
  const engine = useFilesStore((s) => s.engine);
  const engineError = useFilesStore((s) => s.engineError);
  const closeProject = useFilesStore((s) => s.closeProject);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const openProject = useFilesStore((s) => s.openProject);
  const renameProject = useFilesStore((s) => s.renameProject);
  const pdfBytes = useCompileStore((s) => s.pdfBytes);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const workspaceHidden = useSettingsStore((s) => s.workspaceHidden);
  const setLayoutPreset = useSettingsStore((s) => s.setLayoutPreset);
  const fullscreen = useFullscreen();

  const toolbarRef = useRef<HTMLElement>(null);
  const toolbarLayout = useToolbarLayout(toolbarRef);
  const hideFork = toolbarLayout.overflow >= TOOLBAR_OVERFLOW.fork;
  const hideLayout = toolbarLayout.overflow >= TOOLBAR_OVERFLOW.layout;
  const hideHistory = toolbarLayout.overflow >= TOOLBAR_OVERFLOW.history;
  const hideExport = toolbarLayout.overflow >= TOOLBAR_OVERFLOW.export;

  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleEditRef = useRef<HTMLSpanElement>(null);
  const titleInputRef = useInitialFocus<HTMLInputElement>(editingTitle);
  const closeFork = () => setForkOpen(false);
  const { dialogRef: forkDialogRef, onBackdropMouseDown: onForkBackdropMouseDown } =
    useModalAccessibility<HTMLDivElement>(forkOpen, closeFork);

  useEffect(() => {
    if (!editingTitle) return;
    const onDown = (e: MouseEvent) => {
      if (titleEditRef.current && !titleEditRef.current.contains(e.target as Node)) {
        setEditingTitle(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [editingTitle]);

  const startEditTitle = () => {
    setTitleDraft(projectName || "");
    setEditingTitle(true);
  };
  const commitTitle = async () => {
    const name = titleDraft.trim();
    setEditingTitle(false);
    if (!name || name === projectName) return;
    try {
      await renameProject(name);
      toast.success(i18n.t(($) => $.shell.toolbar.projectRenamed));
    } catch (e) {
      notifyError("rename project", e);
    }
  };
  const [dlOpen, setDlOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportKind, setExportKind] = useState<"presentation" | "book" | "doc">("doc");

  // Imperative read (not a subscription) to avoid re-rendering on every keystroke.
  const prepareExportMenu = () => {
    const f = useFilesStore.getState();
    // A root directive can redirect export to another document.
    const src = f.files[resolveEffectiveMainDoc().mainDoc]?.content ?? "";
    setExportKind(classifyDoc(src));
  };
  const setExportMenuOpen = (open: boolean) => {
    if (open && exporting) return;
    if (open) prepareExportMenu();
    setDlOpen(open);
  };
  const exportBusyRef = useRef(false);
  const doExportFormat = async (format: DocFormat | "zip") => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setDlOpen(false);
    setExporting(format);
    try {
      await exportCurrentDocument(format);
    } finally {
      exportBusyRef.current = false;
      setExporting(null);
    }
  };
  const doDownloadZip = () => doExportFormat("zip");

  const doDownloadPdf = async () => {
    setDlOpen(false);
    await exportCurrentPdf();
  };

  const doExportPng = async () => {
    setDlOpen(false);
    await exportCurrentImagePng();
  };

  const submitFork = async () => {
    if (!projectId) return;
    const n = forkName.trim() || `${projectName || "project"} (copy)`;
    setForkBusy(true);
    try {
      const newId = await duplicateProject(projectId, n);
      await refreshProjects();
      setForkOpen(false);
      setForkName("");
      void openProject(newId);
    } catch (e) {
      notifyError("fork project", e, i18n.t(($) => $.shell.toolbar.forkFailed));
    } finally {
      setForkBusy(false);
    }
  };

  useEffect(() => { if (hideExport) setDlOpen(false); }, [hideExport]);

  const layoutMenuItems = LAYOUT_OPTIONS.map(({ preset, label, icon: Icon }) => (
    <DropdownMenuItem key={preset} onSelect={() => setLayoutPreset(preset)}>
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {activeLayoutPreset(viewMode, assistantOpen, workspaceHidden) === preset &&
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
    </DropdownMenuItem>
  ));

  const layoutControl = (
    <ToolbarAction name="layout" order={TOOLBAR_OVERFLOW.layout} hidden={hideLayout}>
      <DropdownMenu key={hideLayout ? "overflow" : "direct"}>
        <Tooltip label={t(($) => $.shell.toolbar.layout)}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t(($) => $.shell.toolbar.layout)}
              className="size-7 text-muted-foreground hover:text-foreground"><LayoutGrid className="size-4" /></Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">{layoutMenuItems}</DropdownMenuContent>
      </DropdownMenu>
    </ToolbarAction>
  );

  const showForkDialog = () => {
    setForkName(`${projectName || "project"} (copy)`);
    setForkOpen(true);
  };

  const exportMenuItems = <>
    <DropdownMenuItem onSelect={() => void doDownloadZip()}>
      <FileArchive className="size-4 text-muted-foreground" />
      {t(($) => $.shell.toolbar.exportSourceZip)}
    </DropdownMenuItem>
    {engine.capabilities.produces_pdf && <DropdownMenuItem onSelect={() => void doDownloadPdf()} disabled={!pdfBytes}>
      <FileText className="size-4 text-muted-foreground" />
      {isSingleFigureProject
        ? t(($) => $.shell.toolbar.exportPdfVector)
        : t(($) => $.shell.toolbar.exportPdf)}
    </DropdownMenuItem>}
    {isSingleFigureProject && (
      <DropdownMenuItem onSelect={() => void doExportPng()} disabled={!pdfBytes}>
        <ImagePlay className="size-4 text-muted-foreground" />
        {t(($) => $.shell.toolbar.exportPngRaster)}
      </DropdownMenuItem>
    )}
    {!isSingleFigureProject && engine.capabilities.produces_pdf && (
      <DropdownMenuItem onSelect={() => void doExportPng()} disabled={!pdfBytes}>
        <ImagePlay className="size-4 text-muted-foreground" />
        {t(($) => $.shell.toolbar.exportPagePng)}
      </DropdownMenuItem>
    )}
    {!pdfBytes && (
      <p className="px-2 py-1 pl-8 text-[10px] text-muted-foreground">
        {isSingleFigureProject
          ? t(($) => $.shell.toolbar.compileFigureFirst)
          : t(($) => $.shell.toolbar.compilePdfFirst)}
      </p>
    )}
    {!isSingleFigureProject && engine.capabilities.conversion_exports.length > 0 && (
      <>
        <DropdownMenuSeparator />
        {exportRoutesFor(engine.id, engine.capabilities.conversion_exports)
          .filter((route) => route.target !== "pdf")
          .map((route) => (
            <DropdownMenuItem
              key={route.id}
              data-testid={`export-route-${route.id}`}
              onSelect={() => void doExportFormat(formatForTarget(route.target))}
            >
              <FileType className="size-4 text-muted-foreground" />
              {t(($) => $.shell.toolbar.exportAs, { format: route.label })}
            </DropdownMenuItem>
          ))}
        {engine.capabilities.conversion_exports.includes("txt") && <DropdownMenuItem onSelect={() => void doExportFormat("txt")}>
          <FileType className="size-4 text-muted-foreground" />
          {t(($) => $.shell.toolbar.exportTxt)}
        </DropdownMenuItem>}
      </>
    )}
    {exportKind === "presentation" && engine.capabilities.conversion_exports.includes("pptx") && (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void doExportFormat("pptx")}>
          <Presentation className="size-4 text-muted-foreground" />
          {t(($) => $.shell.toolbar.exportPptx)}
        </DropdownMenuItem>
      </>
    )}
    {exportKind === "book" && engine.capabilities.conversion_exports.includes("epub") && (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void doExportFormat("epub")}>
          <BookOpen className="size-4 text-muted-foreground" />
          {t(($) => $.shell.toolbar.exportEpub)}
        </DropdownMenuItem>
      </>
    )}
    {exporting && (
      <p className="px-2 py-1 text-[10px] text-muted-foreground">
        {t(($) => $.shell.toolbar.exporting, { format: exporting })}
      </p>
    )}
  </>;

  return (
    <>
    <header
      ref={toolbarRef}
      data-toolbar-layout={toolbarLayout.overflow ? "compact" : "expanded"}
      data-toolbar-stacked={toolbarLayout.stacked || undefined}
      data-toolbar-spacing={toolbarLayout.roomy ? "roomy" : "compact"}
      data-tauri-drag-region
      data-tour="project-toolbar"
      {...(E2E_HOOKS
        ? { "data-e2e-project-id": projectId ?? undefined }
        : {})}
      className={cn(
        "relative z-20 grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 border-b bg-background",
        toolbarLayout.stacked && "pb-1"
      )}
    >
      <div data-toolbar-part="leading" data-tauri-drag-region className={cn(
        "col-start-1 row-start-1 flex min-h-12 min-w-0 items-center gap-2",
        isMac && !fullscreen && "pl-[78px]",
        isMac && fullscreen && "pl-2",
      )}>
      <HomeBrandButton compact={toolbarLayout.compactBrand} className="shrink-0" onClick={() => void closeProject()} />
      <ChevronRight data-toolbar-part="breadcrumb" aria-hidden
        className={cn("size-4 shrink-0 text-muted-foreground/50", toolbarLayout.compactBrand && "invisible absolute")} />
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center overflow-hidden"
      >
        {editingTitle ? (
          <span ref={titleEditRef} className="flex min-w-0 flex-1 items-center gap-1">
            <Input
              ref={titleInputRef}
              aria-label={t(($) => $.shell.toolbar.projectName)}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitTitle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingTitle(false);
                }
              }}
              className="h-6 min-w-0 flex-1 rounded border bg-muted px-1.5 text-sm focus:border-primary"
            />
            <Tooltip label={t(($) => $.shell.toolbar.saveName)}>
              <button
                type="button"
                onClick={() => void commitTitle()}
                aria-label={t(($) => $.shell.toolbar.saveNameAriaLabel)}
                className="flex size-6 items-center justify-center rounded text-emerald-600 hover:bg-accent dark:text-emerald-400"
              >
                <Check className="size-3.5" />
              </button>
            </Tooltip>
            <Tooltip label={t(($) => $.shell.toolbar.cancelRename)}>
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                aria-label={t(($) => $.common.actions.cancel)}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </Tooltip>
          </span>
        ) : (
          <Tooltip
            label={projectName || t(($) => $.shell.toolbar.untitledProject)}
            side="bottom"
            className="min-w-0 max-w-full"
          >
            <button
                data-testid="project-title"
              type="button"
              onClick={startEditTitle}
              className={cn("flex max-w-full min-w-0 items-center gap-1.5 rounded py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground", !toolbarLayout.compactBrand && "px-1")}
            >
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", toolbarLayout.compactBrand && "hidden")}
                style={{ backgroundColor: coverColor }}
              />
              <span className="min-w-0 truncate">
                {projectName || t(($) => $.shell.toolbar.untitledProject)}
              </span>
            </button>
          </Tooltip>
        )}
      </div>
      <span data-toolbar-part="title-minimum" aria-hidden className="pointer-events-none invisible absolute w-[10ch] text-sm" />
      </div>
      {projectId && <div data-toolbar-part="views" data-testid="toolbar-views" className="col-start-2 row-start-1 shrink-0">
        <ViewModeSwitch viewMode={viewMode} setViewMode={(mode) => {
          if (detached && (mode === "pdf" || mode === "split")) void reattachPreviewWindow();
          setViewMode(mode);
        }} />
      </div>}

      <div data-toolbar-part="trailing" data-tauri-drag-region
        className={cn(toolbarLayout.stacked ? "contents" : "col-start-3 row-start-1 flex shrink-0 items-center justify-self-end gap-1", isMac && "pr-3")}>
      <div data-toolbar-part="actions" data-tauri-drag-region
        className={cn("flex w-max shrink-0 items-center gap-1", toolbarLayout.stacked && "col-span-3 row-start-2 justify-self-end px-2")}>
        <div data-toolbar-item="compile" className="flex w-max shrink-0 items-center gap-1">
          <CompileControls iconOnly={toolbarLayout.iconOnly} />
        </div>
        {engineError && <Tooltip label={engineErrorMessage(engineError)}>
          <span data-toolbar-item="engine-error" className="flex size-7 shrink-0 items-center justify-center text-destructive">
            <AlertTriangle className="size-4" /><span className="sr-only">{engineErrorMessage(engineError)}</span>
          </span>
        </Tooltip>}
        <ToolbarAction name="export" order={TOOLBAR_OVERFLOW.export} hidden={hideExport}>
        <DropdownMenu open={dlOpen} onOpenChange={setExportMenuOpen}>
          <Tooltip label={t(($) => $.shell.toolbar.export)}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label={t(($) => $.shell.toolbar.export)}
              >
                <Download className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">{exportMenuItems}
          </DropdownMenuContent>
        </DropdownMenu>

        </ToolbarAction>
        <ToolbarAction name="fork" order={TOOLBAR_OVERFLOW.fork} hidden={hideFork}>
          <Tooltip label={t(($) => $.shell.toolbar.forkProject)}>
            <Button variant="ghost" size="icon" aria-label={t(($) => $.shell.toolbar.forkProject)}
              className="size-7 text-muted-foreground hover:text-foreground" onClick={showForkDialog} disabled={!projectId}>
              <GitFork className="size-4" />
            </Button>
          </Tooltip>
        </ToolbarAction>
        <ToolbarAction name="history" order={TOOLBAR_OVERFLOW.history} hidden={hideHistory}>
          <ProjectHistoryActions />
        </ToolbarAction>
        {workspaceHidden && <ToolbarAction name="sidebar"><SidebarCollapseToggle /></ToolbarAction>}
        <WorkspaceDockControls overflow={toolbarLayout.overflow} onFork={showForkDialog} layoutControl={layoutControl}>
          {hideExport && <DropdownMenuSub onOpenChange={(open) => { if (open) prepareExportMenu(); }}>
            <DropdownMenuSubTrigger><Download className="mr-2 size-4" />{t(($) => $.shell.toolbar.export)}</DropdownMenuSubTrigger>
            <DropdownMenuPortal><DropdownMenuSubContent className="w-60">{exportMenuItems}</DropdownMenuSubContent></DropdownMenuPortal>
          </DropdownMenuSub>}
          {hideHistory && <DropdownMenuItem onSelect={() => useSettingsStore.getState().openVersioning()}>
            <History className="size-4" />{t(($) => $.shell.toolbar.versioning)}
          </DropdownMenuItem>}
          {hideLayout && <DropdownMenuSub>
            <DropdownMenuSubTrigger><LayoutGrid className="mr-2 size-4" />{t(($) => $.shell.toolbar.layout)}</DropdownMenuSubTrigger>
            <DropdownMenuPortal><DropdownMenuSubContent className="w-56">{layoutMenuItems}</DropdownMenuSubContent></DropdownMenuPortal>
          </DropdownMenuSub>}
        </WorkspaceDockControls>
      </div>
      <div data-toolbar-part="captions" className={cn("shrink-0 empty:hidden", toolbarLayout.stacked && "col-start-3 row-start-1 justify-self-end")}>
        <WindowControls />
      </div>
      </div>
    </header>

    {forkOpen && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <button
          type="button"
          aria-label={t(($) => $.shell.toolbar.closeForkDialog)}
          className="absolute inset-0"
          onMouseDown={onForkBackdropMouseDown}
        />
        <div
          ref={forkDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="toolbar-fork-title"
          tabIndex={-1}
          className="relative w-full max-w-md rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id="toolbar-fork-title" className="text-base font-semibold">
              {t(($) => $.shell.toolbar.forkProject)}
            </h2>
            <Button variant="ghost" size="icon" className="size-7" onClick={closeFork}>
              <X className="size-4" />
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            <Trans
              ns="shell"
              i18nKey={($) => $.shell.toolbar.forkDescription}
              values={{ name: projectName }}
              components={{ name: <span className="font-medium text-foreground" /> }}
            />
          </p>
          <div className="flex items-center gap-2">
            <Input
              data-modal-initial-focus
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !forkBusy) void submitFork(); }}
              placeholder={t(($) => $.shell.toolbar.newProjectName)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
            />
            <Button onClick={() => void submitFork()} disabled={forkBusy}>
              {forkBusy ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
              {t(($) => $.shell.toolbar.fork)}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
