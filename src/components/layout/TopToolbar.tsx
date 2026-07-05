import { useState } from "react";
import {
  CircleHelp,
  Columns2,
  ChevronRight,
  Download,
  FileText,
  FileArchive,
  FileType,
  GitFork,
  History,
  Loader2,
  Play,
  SquarePen,
  X,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { GithubBadge } from "@/components/layout/GithubBadge";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useSettingsStore, type ViewMode } from "@/store/settings";
import { exportCurrentPdf } from "@/features/export";
import { downloadProjectZip, duplicateProject, exportDocument } from "@/lib/tauri";
import { useFullscreen } from "@/lib/use-fullscreen";
import { notifyError, toast } from "@/lib/toast";
import { cn, isMac } from "@/lib/utils";

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: typeof Columns2 }[] = [
  { mode: "editor", label: "Editor View", icon: SquarePen },
  { mode: "split", label: "Split View", icon: Columns2 },
  { mode: "pdf", label: "PDF View", icon: FileText },
];

export function TopToolbar() {
  const projectName = useFilesStore((s) => s.projectName);
  const projectId = useFilesStore((s) => s.projectId);
  const closeProject = useFilesStore((s) => s.closeProject);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const openProject = useFilesStore((s) => s.openProject);
  const pdfBytes = useCompileStore((s) => s.pdfBytes);
  const setHistoryOpen = useSettingsStore((s) => s.setHistoryOpen);
  const setHotkeysOpen = useSettingsStore((s) => s.setHotkeysOpen);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const recompile = useCompileStore((s) => s.recompile);
  const status = useCompileStore((s) => s.status);
  const compiling = status === "compiling";
  const fullscreen = useFullscreen();

  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

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
      toast.success("Project downloaded.");
    } catch (e) {
      notifyError("download zip", e, "Couldn't download the project zip.");
    } finally {
      setExporting(null);
    }
  };

  const doExportFormat = async (format: "docx" | "html" | "md") => {
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
      await exportDocument(projectId, useFilesStore.getState().mainDoc || "main.tex", format, dest);
      toast.success(`Exported ${format.toUpperCase()}.`);
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
        <span className="truncate max-w-[200px] text-sm text-muted-foreground">
          {projectName || "project"}
        </span>
      </div>

      {/* Center: view-mode segmented control */}
      <div data-tauri-drag-region className="flex items-center rounded-md border bg-muted/40 p-0.5">
        {VIEW_OPTIONS.map(({ mode, label, icon: Icon }) => (
          <Tooltip key={mode} label={label} side="bottom">
            <button
              onClick={() => setViewMode(mode)}
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
        <GithubBadge />

        <Tooltip label="Recompile (⌘↵)">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-md bg-primary text-white shadow-sm hover:bg-primary"
            disabled={compiling}
            onClick={() => void recompile()}
            aria-label="Recompile"
          >
            {compiling ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          </Button>
        </Tooltip>

        <div className="relative">
          <Tooltip label="Download">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setDlOpen((v) => !v)}
              aria-label="Download"
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
                  Download source (.zip)
                </button>
                <button onClick={() => void doDownloadPdf()} disabled={!pdfBytes} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40">
                  <FileText className="size-4 text-muted-foreground" />
                  Download as PDF
                </button>
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
                {(exporting || !pdfBytes) && (
                  <p className="px-2 py-1 text-[10px] text-muted-foreground">
                    {exporting ? `Exporting .${exporting}…` : "PDF requires a compile first."}
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

        <Tooltip label="Shortcuts (⌘/)">
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
