import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CircleHelp,
  Columns2,
  ChevronRight,
  Download,
  FileText,
  FileArchive,
  FileType,
  GitFork,
  Presentation,
  History,
  Loader2,
  ImagePlay,
  Play,
  SquarePen,
  X,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { GithubMenu } from "@/components/layout/GithubMenu";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useSettingsStore, type ViewMode } from "@/store/settings";
import { exportCurrentPdf, exportCurrentImagePng } from "@/features/export";
import { ensurePandoc } from "@/features/pandoc";
import {
  downloadProjectZip,
  duplicateProject,
  exportDocument,
  gitGetRemote,
  revealInDir,
} from "@/lib/tauri";
import { toGithubWebUrl } from "@/lib/github-url";
import { useFullscreen } from "@/lib/use-fullscreen";
import { notifyError, toast } from "@/lib/toast";
import { cn, isMac, shortcut } from "@/lib/utils";

/** Display labels for export formats (matches "Export PDF/Zip/Docx/Md/html"). */
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

/** Classify the main document so the export menu can offer the right formats. */
function classifyDoc(source: string): "presentation" | "book" | "doc" {
  if (/\\documentclass(\[[^\]]*\])?\{\s*beamer\s*\}/.test(source)) return "presentation";
  if (/\\documentclass(\[[^\]]*\])?\{\s*(book|report|memoir|scrbook|scrreprt)\s*\}/.test(source))
    return "book";
  return "doc";
}

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: typeof Columns2 }[] = [
  { mode: "editor", label: "Source View", icon: SquarePen },
  { mode: "split", label: "Split View", icon: Columns2 },
  { mode: "pdf", label: "PDF View", icon: FileText },
];

export function TopToolbar() {
  const projectName = useFilesStore((s) => s.projectName);
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const closeProject = useFilesStore((s) => s.closeProject);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const openProject = useFilesStore((s) => s.openProject);
  const renameProject = useFilesStore((s) => s.renameProject);
  const pdfBytes = useCompileStore((s) => s.pdfBytes);
  const setHistoryOpen = useSettingsStore((s) => s.setHistoryOpen);
  const setHotkeysOpen = useSettingsStore((s) => s.setHotkeysOpen);
  const setDiagramComposerOpen = useSettingsStore((s) => s.setDiagramComposerOpen);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const recompile = useCompileStore((s) => s.recompile);
  const status = useCompileStore((s) => s.status);
  const compiling = status === "compiling";
  const fullscreen = useFullscreen();

  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleEditRef = useRef<HTMLSpanElement>(null);

  // Clicking anywhere outside the title editor cancels the edit (like Escape).
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

  // Classify the current document (cheap, imperative read) whenever the export
  // menu opens, so we can show the right formats without subscribing to content.
  const openExportMenu = () => {
    setDlOpen((v) => {
      const next = !v;
      if (next) {
        const f = useFilesStore.getState();
        const src = f.files[f.mainDoc]?.content ?? "";
        setExportKind(classifyDoc(src));
      }
      return next;
    });
  };
  const [githubUrl, setGithubUrl] = useState<string | null>(null);

  // Track the project's GitHub web URL (null until it's pushed to a remote).
  useEffect(() => {
    if (!projectId) {
      setGithubUrl(null);
      return;
    }
    const load = () =>
      void gitGetRemote(projectId)
        .then((r) => setGithubUrl(toGithubWebUrl(r)))
        .catch(() => setGithubUrl(null));
    load();
    window.addEventListener("openleaf:git-changed", load);
    return () => window.removeEventListener("openleaf:git-changed", load);
  }, [projectId]);

  const openInGithub = () => {
    if (githubUrl) void open(githubUrl);
  };
  const shareGithub = async () => {
    if (!githubUrl) return;
    try {
      await navigator.clipboard.writeText(githubUrl);
      toast.success("GitHub link copied");
    } catch {
      toast.info(githubUrl);
    }
  };

  const safeName = () => (projectName || "document").replace(/[^\w.-]+/g, "_");

  const doDownloadZip = async () => {
    if (!projectId) return;
    setDlOpen(false);
    const dest = await save({
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
    const dest = await save({
      defaultPath: `${safeName()}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (!dest) return;
    setExporting(format);
    try {
      // Word/HTML/Markdown need pandoc — fetch it on demand the first time.
      if (!(await ensurePandoc())) return;
      await exportDocument(projectId, useFilesStore.getState().mainDoc || "main.tex", format, dest);
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
      className={cn(
        "grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b bg-background",
        isMac && "pr-3",
        isMac && !fullscreen && "pl-[78px]",
        isMac && fullscreen && "pl-4"
      )}
    >
      {/* Left: brand | project name */}
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={closeProject}
          title="Back to library"
          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm font-semibold tracking-tight hover:bg-accent"
        >
          <LeafLogo className="size-5" />
          OpenLeaf
        </button>
        <ChevronRight className="size-4 text-muted-foreground/50" />
        {editingTitle ? (
          <span ref={titleEditRef} className="flex items-center gap-1">
            <input
              aria-label="Project name"
              autoFocus
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
              className="h-6 w-[180px] rounded border bg-muted px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
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
          <button
              data-testid="project-title"
            type="button"
            onClick={startEditTitle}
            className="flex min-w-0 items-center rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="max-w-[200px] truncate">{projectName || "project"}</span>
          </button>
        )}
      </div>

      {/* Center: view-mode segmented control */}
      <div data-tauri-drag-region className="flex items-center rounded-md border bg-muted/40 p-0.5">
        {VIEW_OPTIONS.map(({ mode, label, icon: Icon }) => (
          <Tooltip key={mode} label={label} side="bottom">
            <button
              onClick={() => setViewMode(mode)}
              aria-label={label}
              aria-pressed={viewMode === mode}
              className={cn(
                "flex h-7 items-center rounded-[5px] px-2 text-muted-foreground transition-colors",
                viewMode === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Right: actions */}
      <div data-tauri-drag-region className="flex items-center justify-end gap-1.5">

        <Tooltip label={`Recompile (${shortcut("⌘↵")})`}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "rounded-md bg-primary text-white shadow-sm hover:bg-primary",
              "h-7 gap-1.5 px-2.5",
            )}
            disabled={compiling}
            onClick={() => {
              // If the PDF pane is hidden (editor-only), reveal it so the result shows.
              if (viewMode === "editor") setViewMode("split");
              void recompile();
            }}
            aria-label="Recompile"
          >
            {compiling ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            <span className="text-xs font-medium">Compile</span>
          </Button>
        </Tooltip>

        {projectKind !== "image" && (
          <Tooltip label="Insert diagram">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setDiagramComposerOpen(true)}
              aria-label="Insert diagram"
            >
              <ImagePlay className="size-4" />
            </Button>
          </Tooltip>
        )}

        <div className="relative">
          <Tooltip label="Export">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={openExportMenu}
              aria-label="Export"
            >
              <Download className="size-4" />
            </Button>
          </Tooltip>
          {dlOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDlOpen(false)} />
              <div className="absolute right-0 top-9 z-50 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl">
                <button onClick={() => void doDownloadZip()} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                  <FileArchive className="size-4 text-muted-foreground" />
                  Export source (.zip)
                </button>
                <button onClick={() => void doDownloadPdf()} disabled={!pdfBytes} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40">
                  <FileText className="size-4 text-muted-foreground" />
                  Export as PDF {projectKind === "image" ? "(vector image)" : ""}
                </button>
                {projectKind === "image" && (
                  <button onClick={() => void doExportPng()} disabled={!pdfBytes} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40">
                    <ImagePlay className="size-4 text-muted-foreground" />
                    Export as PNG (raster image)
                  </button>
                )}
                {!pdfBytes && (
                  <p className="px-2 py-1 pl-8 text-[10px] text-muted-foreground">
                    {projectKind === "image" ? "Compile the figure first" : "PDF requires a compile first"}
                  </p>
                )}
                {projectKind !== "image" && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <button onClick={() => void doExportFormat("docx")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <FileType className="size-4 text-muted-foreground" />
                      Export as Word (.docx)
                    </button>
                    <button onClick={() => void doExportFormat("html")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <FileType className="size-4 text-muted-foreground" />
                      Export as HTML (.html)
                    </button>
                    <button onClick={() => void doExportFormat("md")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <FileType className="size-4 text-muted-foreground" />
                      Export as Markdown (.md)
                    </button>
                    <button onClick={() => void doExportFormat("txt")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <FileType className="size-4 text-muted-foreground" />
                      Export as Plain text (.txt)
                    </button>
                  </>
                )}
                {exportKind === "presentation" && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <button onClick={() => void doExportFormat("pptx")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <Presentation className="size-4 text-muted-foreground" />
                      Export as PowerPoint (.pptx)
                    </button>
                  </>
                )}
                {exportKind === "book" && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <button onClick={() => void doExportFormat("epub")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <BookOpen className="size-4 text-muted-foreground" />
                      Export as EPUB (.epub)
                    </button>
                  </>
                )}
                {exporting && (
                  <p className="px-2 py-1 text-[10px] text-muted-foreground">
                    {`Exporting .${exporting}…`}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <Tooltip label="History">
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

        <GithubMenu
          githubUrl={githubUrl}
          onOpenInGithub={openInGithub}
          onCopyLink={() => void shareGithub()}
        />

        <Tooltip label={`Shortcuts (${shortcut("⌘/")})`}>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setHotkeysOpen(true)}
          >
            <CircleHelp className="size-4" />
          </Button>
        </Tooltip>
      </div>
    </header>

    {forkOpen && (
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
        onClick={() => setForkOpen(false)}
      >
        <div
          className="w-full max-w-md rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Fork project</h2>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setForkOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Copies <span className="font-medium text-foreground">{projectName}</span> and its full history into a new project.
          </p>
          <div className="flex items-center gap-2">
            <input
              autoFocus
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
