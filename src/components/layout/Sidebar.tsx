import { lazy, Suspense, useEffect, useState } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { FileText, Loader2, Search } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { searchDocs, type SearchHit } from "@/lib/tauri";
import { gotoLine } from "@/components/editor/cm/controller";
import { registry } from "@oleafly/registry";
import { FileTree } from "@/components/files/FileTree";
import { cn } from "@/lib/utils";
import { objectKey } from "@/lib/react-key";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { Input } from "@/components/ui/input";

const DocumentOutline = lazy(() =>
  import("@/components/layout/DocumentOutline").then((module) => ({
    default: module.DocumentOutline,
  })),
);

const ProjectStructure = lazy(() =>
  import("@/components/layout/Outline").then((module) => ({
    default: module.Outline,
  })),
);

function basename(p: string) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export function ProjectSearch() {
  const projectId = useFilesStore((s) => s.projectId);
  const openFile = useFilesStore((s) => s.openFile);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useInitialFocus<HTMLInputElement>();

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const all = await searchDocs(q);
        setHits(projectId ? all.filter((h) => h.project_id === projectId) : all);
      } catch {
        setHits([]);
      }
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q, projectId]);

  const open = async (hit: SearchHit) => {
    await openFile(hit.path);
    window.setTimeout(() => gotoLine(hit.line), 80);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-sidebar-border px-3">
        <Search className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          Search
        </span>
      </div>
      <div className="border-b border-sidebar-border p-2">
        <Input
          ref={searchInputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find in project…"
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {hits.map((hit) => (
          <button type="button"
            key={objectKey(hit, "search-hit")}
            onClick={() => void open(hit)}
            className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
          >
            <div className="flex items-center gap-1.5 text-sm">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{basename(hit.path)}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                :{hit.line}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {hit.preview}
            </div>
          </button>
        ))}
        {q.trim() && !loading && hits.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No results.
          </p>
        )}
        {!q.trim() && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Search across this project's files.
          </p>
        )}
      </div>
    </div>
  );
}

export function FilesPanel() {
  return (
    <PanelGroup direction="vertical">
      {/* The file list keeps the larger share: it is what you navigate by, and
          the outline below it stays long enough to scan without crowding it.
          Both stay draggable. */}
      <Panel id="filetree-v" order={1} defaultSize={60} minSize={15}>
        <FileTree />
      </Panel>
      <PanelResizeHandle
        style={{ cursor: "row-resize" }}
        className={cn(
          "resize-handle-row group flex h-2.5 items-center justify-center",
          "transition-colors hover:bg-accent/40"
        )}
      >
        <span className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-ring" />
      </PanelResizeHandle>
      <Panel id="outline-v" order={2} defaultSize={40} minSize={10}>
        {/* Outline first and open: it answers "where am I in this document",
            which is the question you have while writing. Structure sits under
            it, collapsed, for when you want the whole project map. */}
        <Suspense fallback={<SidebarPanelFallback />}>
          <div className="flex h-full min-h-0 flex-col">
            <DocumentOutline />
            <ProjectStructure defaultCollapsed />
          </div>
        </Suspense>
      </Panel>
    </PanelGroup>
  );
}

function SidebarPanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  );
}

export function Sidebar() {
  const railTab = useSettingsStore((s) => s.railTab);
  const ActivePanel = registry.railTabs.find((t) => t.id === railTab)?.panel ?? FilesPanel;
  return (
    <Suspense fallback={<SidebarPanelFallback />}>
      <ActivePanel />
    </Suspense>
  );
}
