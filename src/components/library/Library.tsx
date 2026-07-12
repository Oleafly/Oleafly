import { useEffect, useState } from "react";
import { Bookmark, Check, FileText, GitFork, Moon, Palette, Plus, Search, Sun, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Tooltip } from "@/components/ui/tooltip";
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
import { cn, isMac } from "@/lib/utils";
import { deleteProject, duplicateProject, readCompiledPdf } from "@/lib/tauri";
import { pdfPageToPng } from "@/lib/pdf-image";

const thumbCache = new Map<string, string | null>();

export function Library() {
  const projects = useFilesStore((s) => s.projects);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const openProject = useFilesStore((s) => s.openProject);
  const favs = useFavoritesStore((s) => s.favs);
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const projectColors = useProjectColorsStore((s) => s.colors);
  const setProjectColor = useProjectColorsStore((s) => s.setColor);
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const hoverPreview = useSettingsStore((s) => s.hoverPreview);
  const { theme, toggleTheme } = useTheme();
  const [forkTarget, setForkTarget] = useState<{ id: string; name: string } | null>(null);
  const [forkName, setForkName] = useState("");
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  const loadThumb = (id: string, updatedAt: number) => {
    const key = `${id}:${updatedAt}`;
    if (thumbCache.has(key)) {
      const cached = thumbCache.get(key) ?? null;
      if (thumbs[id] !== cached) setThumbs((t) => ({ ...t, [id]: cached }));
      return;
    }
    thumbCache.set(key, null);
    void readCompiledPdf(id)
      .then((buf) => pdfPageToPng(new Uint8Array(buf), 1, 1.2, "#ffffff"))
      .then((png) => {
        thumbCache.set(key, png);
        setThumbs((t) => ({ ...t, [id]: png }));
      })
      .catch(() => {
        setThumbs((t) => ({ ...t, [id]: null }));
      });
  };

  const visibleProjects = onlyFavs ? projects.filter((p) => favs.includes(p.id)) : projects;

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
    <div data-testid="library" className="relative flex h-full flex-col bg-background">
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
        <div data-tauri-drag-region className="flex items-center justify-center gap-1.5">
          {projects.length > 0 && (
            <>
              <LeafLogo className="size-5" />
              <span className="text-sm font-semibold tracking-tight">OpenLeaf</span>
            </>
          )}
        </div>
        <div data-tauri-drag-region className="flex items-center justify-end gap-1.5">
          {projects.length > 0 && (
            <>
              <Tooltip label="New project">
                <Button
                  data-testid="new-project"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setNewProjectOpen(true)}
                >
                  <Plus className="size-4" /> New project
                </Button>
              </Tooltip>
              <Tooltip label="Search documents (⌘⇧F)">
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
            <Empty className="min-h-[60vh] py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LeafLogo className="size-7" />
                </EmptyMedia>
                <EmptyTitle>Welcome to OpenLeaf</EmptyTitle>
                <EmptyDescription>
                  A local-first LaTeX &amp; resume studio. Everything stays on your disk -
                  create your first project to get going. Your PDFs are about to get a whole lot prettier.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="max-w-2xl">
                <Button
                  data-testid="create-first-project"
                  className="bg-primary text-white hover:bg-primary"
                  onClick={() => setNewProjectOpen(true)}
                >
                  <Plus className="size-4" /> Create your first project
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
          onlyFavs && visibleProjects.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No bookmarked projects yet. Hover a book and click its bookmark to add one.
            </p>
          ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {visibleProjects.map((p) => (
              <ContextMenu key={p.id}>
                <ContextMenuTrigger asChild>
                  <div className="flex justify-center" onMouseEnter={() => hoverPreview && loadThumb(p.id, p.updated_at)}>
                    <Book
                      title={p.name}
                      color={projectColors[p.id] ?? (p.color || DEFAULT_BOOK_COLOR)}
                      date={p.updated_at > 0 ? new Date(p.updated_at * 1000).toLocaleDateString() : undefined}
                      starred={favs.includes(p.id)}
                      onStarToggle={() => toggleFav(p.id)}
                      onClick={() => void openProject(p.id)}
                      preview={hoverPreview ? thumbs[p.id] : undefined}
                    />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onClick={() => void openProject(p.id)}>
                    <FileText className="mr-2 size-4" /> Open project
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
                        await deleteProject(p.id);
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

      {/* The New Project gallery is mounted globally (GlobalNewProject), so it
          can also be opened from the omnibar and command palette. */}
      {/* Fork modal */}
      {forkTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setForkTarget(null); setForkName(""); }}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Fork project</h2>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => { setForkTarget(null); setForkName(""); }}>
                <X className="size-4" />
              </Button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Copies <span className="font-medium text-foreground">{forkTarget.name}</span> and its full history into a new project.
            </p>
            <div className="flex items-center gap-2">
              <input
                autoFocus
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
