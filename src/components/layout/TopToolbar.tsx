import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Columns2,
  ChevronRight,
  Download,
  FileText,
  FileArchive,
  FileType,
  GitFork,
  Presentation,
  History,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { CompileControls } from "@/components/layout/CompileControls";
import { WorkspaceDockControls } from "@/components/layout/WorkspaceControls";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { WindowControls } from "@/components/layout/WindowControls";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useProjectColorsStore } from "@/store/project-colors";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useSettingsStore, type LayoutPreset, type ViewMode } from "@/store/settings";
import { exportCurrentPdf, exportCurrentImagePng } from "@/features/export";
import { ensurePandoc } from "@/features/pandoc";
import {
  downloadProjectZip,
  duplicateProject,
  exportDocument,
  revealInDir,
} from "@/lib/tauri";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFullscreen } from "@/lib/use-fullscreen";
import { notifyError, toast } from "@/lib/toast";
import { cn, isMac } from "@/lib/utils";
import { pickSavePath } from "@/lib/native-file-dialog";
import { E2E_HOOKS } from "@/lib/e2e-flags";

const FMT_LABEL: Record<string, string> = {
  zip: "Zip",
  pdf: "PDF",
  docx: "Docx",
  html: "html",
  md: "Md",
  pptx: "PowerPoint",
  epub: "EPUB",
  txt: "Text",
};

type DocFormat = "docx" | "html" | "md" | "pptx" | "epub" | "txt";

function classifyDoc(source: string): "presentation" | "book" | "doc" {
  if (/\\documentclass(\[[^\]]*\])?\{\s*beamer\s*\}/.test(source)) return "presentation";
  if (/\\documentclass(\[[^\]]*\])?\{\s*(book|report|memoir|scrbook|scrreprt)\s*\}/.test(source))
    return "book";
  return "doc";
}

export const LAYOUT_OPTIONS: { preset: LayoutPreset; label: string; icon: typeof Columns2 }[] = [
  { preset: "editor-preview-ai", label: "Editor + Preview + AI", icon: Columns2 },
  { preset: "editor-preview", label: "Editor + Preview", icon: Columns2 },
  { preset: "editor-ai", label: "Editor + AI", icon: Columns2 },
  { preset: "preview-ai", label: "Preview + AI", icon: Columns2 },
  { preset: "editor-only", label: "Editor Only", icon: Maximize },
  { preset: "preview-only", label: "Preview Only", icon: Columns2 },
  { preset: "ai-only", label: "AI Only", icon: Sparkles },
];

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: typeof Columns2 }[] = [
  { mode: "editor", label: "Editor only", icon: SquarePen },
  { mode: "split", label: "Editor and preview", icon: Columns2 },
  { mode: "pdf", label: "Preview only", icon: FileText },
];

function activeLayoutPreset(
  viewMode: ViewMode,
  assistantOpen: boolean,
  showTree: boolean,
  hideEditorArea: boolean
): LayoutPreset | null {
  if (hideEditorArea) return null;
  if (!showTree) {
    if (viewMode === "editor") return assistantOpen ? "ai-only" : "editor-only";
    if (viewMode === "pdf") return assistantOpen ? "preview-ai" : "preview-only";
    return null;
  }
  if (viewMode === "split") return assistantOpen ? "editor-preview-ai" : "editor-preview";
  if (viewMode === "editor") return assistantOpen ? "editor-ai" : null;
  if (viewMode === "pdf") return assistantOpen ? "preview-ai" : null;
  return null;
}

// Groups the right-side toolbar into: Recompile | Export | History + Fork
// project | account | Shortcuts + Layout.
function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export function TopToolbar() {
  const projectName = useFilesStore((s) => s.projectName);
  const projectId = useFilesStore((s) => s.projectId);
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
  const setHistoryOpen = useSettingsStore((s) => s.setHistoryOpen);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const showTree = useSettingsStore((s) => s.showTree);
  const hideEditorArea = useSettingsStore((s) => s.hideEditorArea);
  const setLayoutPreset = useSettingsStore((s) => s.setLayoutPreset);
  const fullscreen = useFullscreen();

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
      toast.success("Project renamed");
    } catch (e) {
      notifyError("rename project", e);
    }
  };
  const [dlOpen, setDlOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportKind, setExportKind] = useState<"presentation" | "book" | "doc">("doc");

  // Imperative read (not a subscription) to avoid re-rendering on every keystroke.
  const setExportMenuOpen = (open: boolean) => {
    if (open) {
      const f = useFilesStore.getState();
      // Classify the document that would actually be exported, which a
      // `% !TEX root` comment in the active file may redirect.
      const src = f.files[resolveEffectiveMainDoc().mainDoc]?.content ?? "";
      setExportKind(classifyDoc(src));
    }
    setDlOpen(open);
  };
  const safeName = () => (projectName || "document").replace(/[^\w.-]+/g, "_");

  const doDownloadZip = async () => {
    if (!projectId) return;
    setDlOpen(false);
    const dest = await pickSavePath({
      defaultPath: `${safeName()}.zip`,
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    if (!dest) return;
    setExporting("zip");
    try {
      await downloadProjectZip(projectId, dest);
      toast.success(
        "Export Zip complete",
        { label: "View File", onClick: () => void revealInDir(dest) },
        true,
      );
    } catch (e) {
      notifyError("export zip", e, "Couldn't export the project zip");
    } finally {
      setExporting(null);
    }
  };

  const doExportFormat = async (format: DocFormat) => {
    if (!projectId) return;
    setDlOpen(false);
    const ext = format;
    const dest = await pickSavePath({
      defaultPath: `${safeName()}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (!dest) return;
    setExporting(format);
    try {
      if (!(await ensurePandoc())) return;
      await exportDocument(projectId, resolveEffectiveMainDoc().mainDoc, format, dest);
      toast.success(
        `Export ${FMT_LABEL[format] ?? format} complete`,
        { label: "View File", onClick: () => void revealInDir(dest) },
        true,
      );
    } catch (e) {
      notifyError(`export ${format}`, e);
    } finally {
      setExporting(null);
    }
  };

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
      notifyError("fork project", e, "Couldn't fork the project.");
    } finally {
      setForkBusy(false);
    }
  };

  return (
    <>
    <header
      data-tauri-drag-region
      data-tour="project-toolbar"
      {...(E2E_HOOKS
        ? { "data-e2e-project-id": projectId ?? undefined }
        : {})}
      className={cn(
        "relative z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background",
        isMac && "pr-3",
        isMac && !fullscreen && "pl-[78px]",
        isMac && fullscreen && "pl-2"
      )}
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <HomeBrandButton onClick={() => void closeProject()} />
        <ChevronRight className="size-4 text-muted-foreground/50" />
        {editingTitle ? (
          <span ref={titleEditRef} className="flex items-center gap-1">
            <Input
              ref={titleInputRef}
              aria-label="Project name"
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
              className="h-6 w-[280px] rounded border bg-muted px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <Tooltip label="Save (Enter)">
              <button
                type="button"
                onClick={() => void commitTitle()}
                aria-label="Save name"
                className="flex size-6 items-center justify-center rounded text-emerald-600 hover:bg-accent dark:text-emerald-400"
              >
                <Check className="size-3.5" />
              </button>
            </Tooltip>
            <Tooltip label="Cancel (Esc)">
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                aria-label="Cancel"
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </Tooltip>
          </span>
        ) : (
          <Tooltip label={projectName || "project"} side="bottom">
            <button
                data-testid="project-title"
              type="button"
              onClick={startEditTitle}
              className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: coverColor }}
              />
              <span className="min-w-0 max-w-[calc(50vw-260px)] truncate">{projectName || "project"}</span>
            </button>
          </Tooltip>
        )}
      </div>

      {!hideEditorArea && projectId && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="pointer-events-auto flex items-center rounded-md border border-border bg-muted/40 p-0.5">
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
        </div>
      )}

      <div data-tauri-drag-region className="ml-auto flex items-center justify-end gap-1.5">

        <CompileControls />

        {engineError && <span className="max-w-48 truncate text-xs text-destructive" title={engineError}>{engineError}</span>}

        <Divider />

        <DropdownMenu open={dlOpen} onOpenChange={setExportMenuOpen}>
          <Tooltip label="Export">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Export"
              >
                <Download className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onSelect={() => void doDownloadZip()}>
                  <FileArchive className="size-4 text-muted-foreground" />
                  Export source (.zip)
                </DropdownMenuItem>
                {engine.capabilities.produces_pdf && <DropdownMenuItem onSelect={() => void doDownloadPdf()} disabled={!pdfBytes}>
                  <FileText className="size-4 text-muted-foreground" />
                  Export as PDF {isSingleFigureProject ? "(vector image)" : ""}
                </DropdownMenuItem>}
                {isSingleFigureProject && (
                  <DropdownMenuItem onSelect={() => void doExportPng()} disabled={!pdfBytes}>
                    <ImagePlay className="size-4 text-muted-foreground" />
                    Export as PNG (raster image)
                  </DropdownMenuItem>
                )}
                {!pdfBytes && (
                  <p className="px-2 py-1 pl-8 text-[10px] text-muted-foreground">
                    {isSingleFigureProject ? "Compile the figure first" : "PDF requires a compile first"}
                  </p>
                )}
                {!isSingleFigureProject && engine.capabilities.conversion_exports.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    {engine.capabilities.conversion_exports.includes("docx") && <DropdownMenuItem onSelect={() => void doExportFormat("docx")}>
                      <FileType className="size-4 text-muted-foreground" />
                      Export as Word (.docx)
                    </DropdownMenuItem>}
                    {engine.capabilities.conversion_exports.includes("html") && <DropdownMenuItem onSelect={() => void doExportFormat("html")}>
                      <FileType className="size-4 text-muted-foreground" />
                      Export as HTML (.html)
                    </DropdownMenuItem>}
                    {engine.capabilities.conversion_exports.includes("md") && <DropdownMenuItem onSelect={() => void doExportFormat("md")}>
                      <FileType className="size-4 text-muted-foreground" />
                      Export as Markdown (.md)
                    </DropdownMenuItem>}
                    {engine.capabilities.conversion_exports.includes("txt") && <DropdownMenuItem onSelect={() => void doExportFormat("txt")}>
                      <FileType className="size-4 text-muted-foreground" />
                      Export as Plain text (.txt)
                    </DropdownMenuItem>}
                  </>
                )}
                {exportKind === "presentation" && engine.capabilities.conversion_exports.includes("pptx") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void doExportFormat("pptx")}>
                      <Presentation className="size-4 text-muted-foreground" />
                      Export as PowerPoint (.pptx)
                    </DropdownMenuItem>
                  </>
                )}
                {exportKind === "book" && engine.capabilities.conversion_exports.includes("epub") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void doExportFormat("epub")}>
                      <BookOpen className="size-4 text-muted-foreground" />
                      Export as EPUB (.epub)
                    </DropdownMenuItem>
                  </>
                )}
                {exporting && (
                  <p className="px-2 py-1 text-[10px] text-muted-foreground">
                    {`Exporting .${exporting}…`}
                  </p>
                )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Divider />

        <Tooltip label="Fork project">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            disabled={!projectId}
            onClick={() => { setForkName(`${projectName || "project"} (copy)`); setForkOpen(true); }}
          >
            <GitFork className="size-4" />
          </Button>
        </Tooltip>

        <Tooltip label="Version history">
          <Button
            variant="ghost"
            size="icon"
            aria-label="History"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="size-4" />
          </Button>
        </Tooltip>

        <Divider />

        <DropdownMenu>
          <Tooltip label="Layout">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Layout"
              >
                <LayoutGrid className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            {LAYOUT_OPTIONS.map(({ preset, label, icon: Icon }) => {
              const active = activeLayoutPreset(viewMode, assistantOpen, showTree, hideEditorArea) === preset;
              return (
                <DropdownMenuItem key={preset} onClick={() => setLayoutPreset(preset)}>
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{label}</span>
                  {active && <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Divider />
        <WorkspaceDockControls />
        <WindowControls />
      </div>
    </header>

    {forkOpen && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <button type="button" aria-label="Close fork dialog" className="absolute inset-0" onMouseDown={onForkBackdropMouseDown} />
        <div
          ref={forkDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="toolbar-fork-title"
          tabIndex={-1}
          className="relative w-full max-w-md rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id="toolbar-fork-title" className="text-base font-semibold">Fork project</h2>
            <Button variant="ghost" size="icon" className="size-7" onClick={closeFork}>
              <X className="size-4" />
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Copies <span className="font-medium text-foreground">{projectName}</span> and its full history into a new project.
          </p>
          <div className="flex items-center gap-2">
            <Input
              data-modal-initial-focus
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !forkBusy) void submitFork(); }}
              placeholder="New project name"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
            />
            <Button onClick={() => void submitFork()} disabled={forkBusy}>
              {forkBusy ? <Loader2 className="size-4 animate-spin" /> : <GitFork className="size-4" />}
              Fork
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
