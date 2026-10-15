import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Search } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import type { SearchHit } from "@/lib/tauri";
import { useDocSearch } from "@/hooks/use-doc-search";
import { useScrollMemory } from "@/hooks/use-scroll-memory";
import { useScrollTopOnChange } from "@/hooks/use-scroll-top-on-change";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { readSidebarView } from "@/store/sidebar-view-state";
import { gotoLine } from "@/components/editor/cm/controller";
import { registry } from "@oleafly/registry";
import { FileTree } from "@/components/files/FileTree";
import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { SidebarSectionStack, type StackSection } from "@/components/layout/SidebarSectionStack";
import { objectKey } from "@/lib/react-key";
import { basename } from "@/lib/path-utils";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const DocumentOutline = lazy(() =>
  import("@/components/layout/DocumentOutline").then((module) => ({
    default: memo(module.DocumentOutline),
  })),
);

const ProjectStructure = lazy(() =>
  import("@/components/layout/Outline").then((module) => ({
    default: memo(module.Outline),
  })),
);

const SourceTree = memo(FileTree);

const EXPLORER_GROUP_ID = "sidebar-explorer-sections-v3";

export function ProjectSearch() {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((s) => s.projectId);
  const openFile = useFilesStore((s) => s.openFile);
  const [remembered] = useState(() => readSidebarView(projectId, "search"));
  const [q, setQ] = useState(remembered?.query ?? "");
  const [queryEdits, setQueryEdits] = useState(0);
  const { hits, loading, term } = useDocSearch(q, { projectId });
  const searchInputRef = useInitialFocus<HTMLInputElement>();
  const resultsRef = useScrollTopOnChange(queryEdits);
  const settled = useRef<{ term: string; hits: readonly SearchHit[] } | null>(
    remembered?.term ? remembered : null,
  );
  if (!loading) settled.current = term ? { term, hits } : null;
  const shownHits =
    loading && settled.current?.term === term ? settled.current.hits : hits;
  useSidebarViewMemory(projectId, "search", {
    query: q,
    term: settled.current?.term ?? "",
    hits: settled.current?.hits ?? [],
  });
  useScrollMemory({ scrollRef: resultsRef, projectId, slot: "search" });
  const previousProjectId = useRef(projectId);
  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    const next = readSidebarView(projectId, "search");
    settled.current = next?.term ? next : null;
    setQ(next?.query ?? "");
  }, [projectId]);

  const open = async (hit: SearchHit) => {
    useSettingsStore.getState().revealEditor();
    await openFile(hit.path);
    window.setTimeout(() => gotoLine(hit.line), 80);
  };

  return (
    <div className="flex h-full flex-col">
      <SidebarPanelHeader icon={Search} title={t(($) => $.shell.projectSearch.title)} />
      <div className="border-b border-sidebar-border p-2">
        <Input
          ref={searchInputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setQueryEdits((count) => count + 1);
          }}
          placeholder={t(($) => $.shell.projectSearch.placeholder)}
          data-testid="project-search-input"
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:border-input focus-visible:bg-accent/40"
        />
      </div>
      <div ref={resultsRef} className="flex-1 overflow-auto p-1.5">
        {shownHits.map((hit) => (
          <button type="button"
            key={objectKey(hit, "search-hit")}
            onClick={() => void open(hit)}
            className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
          >
            <div className="flex items-center gap-1.5 text-sm">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{basename(hit.path)}</span>
              <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                {`:${hit.line}`}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground">
              {hit.preview}
            </div>
          </button>
        ))}
        {q.trim() && !loading && shownHits.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t(($) => $.shell.projectSearch.noResults)}
          </p>
        )}
        {!q.trim() && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t(($) => $.shell.projectSearch.hint)}
          </p>
        )}
      </div>
    </div>
  );
}

const SOURCE_PANEL = "source-tree-v";
const OUTLINE_PANEL = "document-outline-v";
const STRUCTURE_PANEL = "project-structure-v";

export function FilesPanel() {
  const { t } = useTranslation(["workspace"]);
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [structureCollapsed, setStructureCollapsed] = useState(true);
  const resizeLabel = useCallback(
    (first: string, second: string) => t(($) => $.workspace.explorer.resizeSections, { first, second }),
    [t],
  );
  const sections: StackSection[] = [
    {
      id: SOURCE_PANEL,
      title: t(($) => $.workspace.files.title),
      handleId: "source-tree-resize",
      collapsed: sourceCollapsed,
      onCollapsedChange: setSourceCollapsed,
      render: (collapsed, toggle) => <SourceTree collapsed={collapsed} onCollapsedChange={toggle} />,
    },
    {
      id: OUTLINE_PANEL,
      title: t(($) => $.workspace.outline.title),
      handleId: "source-outline-resize",
      collapsed: outlineCollapsed,
      onCollapsedChange: setOutlineCollapsed,
      render: (collapsed, toggle) => (
        <Suspense fallback={<SidebarPanelFallback />}>
          <DocumentOutline collapsed={collapsed} onCollapsedChange={toggle} />
        </Suspense>
      ),
    },
    {
      id: STRUCTURE_PANEL,
      title: t(($) => $.workspace.structure.title),
      handleId: "outline-structure-resize",
      collapsed: structureCollapsed,
      onCollapsedChange: setStructureCollapsed,
      render: (collapsed, toggle) => (
        <Suspense fallback={<SidebarPanelFallback />}>
          <ProjectStructure collapsed={collapsed} onCollapsedChange={toggle} />
        </Suspense>
      ),
    },
  ];
  return (
    <SidebarSectionStack
      groupId={EXPLORER_GROUP_ID}
      fillerId="explorer-filler-v"
      fillerHandleId="explorer-filler-resize"
      sections={sections}
      resizeLabel={resizeLabel}
      testId="explorer-stack"
    />
  );
}

function SidebarPanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="text-muted-foreground" />
    </div>
  );
}

export function Sidebar() {
  const railTab = useSettingsStore((s) => s.railTab);
  const ActivePanel = registry.railTabs.find((t) => t.id === railTab)?.panel ?? FilesPanel;
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-sidebar-border bg-background px-1.5">
        <SidebarViews />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<SidebarPanelFallback />}>
          <ActivePanel />
        </Suspense>
      </div>
    </div>
  );
}
