import { useTranslation } from "react-i18next";
import {
  BookPlus,
  BookOpenText,
  Braces,
  Info,
  ListRestart,
  Search,
  SearchCode,
  Upload,
  X,
  Quote,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IntelligenceTree,
  PanelBreadcrumb,
  PanelState,
  type IntelligenceTreeNode,
} from "@/components/layout/IntelligenceTree";
import { ImportReferenceLibraryDialog } from "@/components/layout/ImportReferenceLibraryDialog";
import { Button } from "@/components/ui/button";
import { type ScrollMemory, useScrollMemory } from "@/hooks/use-scroll-memory";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { readSidebarView } from "@/store/sidebar-view-state";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { runCiteOleaflyAction } from "@/features/cite-oleafly";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { CleanLibraryDialog } from "@/components/layout/CleanLibraryDialog";
import { TypstBibliographyStylePicker } from "@/components/layout/TypstBibliographyStylePicker";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import {
  buildCitationNodes,
  buildLocationResultNodes,
  buildReferenceResultNodes,
  buildSymbolNodes,
  projectIssueCount,
} from "@/components/layout/project-intelligence-view";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { acceptedProjectSnapshot } from "@/lib/project-intelligence/current";
import {
  definitionsForUse,
  referencesFor,
} from "@/lib/project-intelligence/selectors";
import type {
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
  ProjectUse,
} from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  useReferencesStore,
  type ReferenceQuery,
} from "@/store/references";
import {
  projectIntelligenceFailureText,
  projectIntelligenceReasonText,
} from "@/lib/project-intelligence/reason";

type ReferencePanelView = "results" | "citations" | "symbols";

function identitiesMatch(
  query: ReferenceQuery,
  state: ProjectIntelligenceState,
  snapshot: ProjectIntelligenceSnapshot,
): boolean {
  const current = state.identity;
  const accepted = snapshot.identity;
  return (
    !state.stale &&
    current?.projectId === query.projectId &&
    current.projectRevision === query.projectRevision &&
    current.requestGeneration === query.requestGeneration &&
    accepted.projectId === query.projectId &&
    accepted.projectRevision === query.projectRevision &&
    accepted.requestGeneration === query.requestGeneration
  );
}

function queryIsCurrent(
  query: ReferenceQuery | null,
  state: ProjectIntelligenceState,
  snapshot: ProjectIntelligenceSnapshot,
): boolean {
  if (!query) return false;
  if (query.locations) return query.projectId === snapshot.identity.projectId;
  return identitiesMatch(query, state, snapshot);
}

function resolveQuery(
  snapshot: ProjectIntelligenceSnapshot,
  query: ReferenceQuery,
): {
  definitions: readonly ProjectDefinition[];
  uses: readonly ProjectUse[];
} {
  if (query.mode === "references") {
    const definition = snapshot.definitions.find(
      (candidate) => candidate.id === query.targetId,
    );
    return {
      definitions: definition ? [definition] : [],
      uses: referencesFor(snapshot, query.targetId),
    };
  }

  return {
    definitions: definitionsForUse(snapshot, query.targetId),
    uses: [],
  };
}

function ReferencesUnavailable({
  projectId,
}: Readonly<{
  projectId: string | null;
}>) {
  const { t } = useTranslation(["references"]);
  const status = useIndexStore((state) => state.intelligenceState.status);
  const reasonText = useIndexStore((state) =>
    projectIntelligenceReasonText(state.intelligenceState.reason),
  );
  const failureText = useIndexStore((state) =>
    projectIntelligenceFailureText(state.intelligenceState),
  );
  if (!projectId) {
    return (
      <PanelState
        state="empty"
        title={t(($) => $.references.unavailable.noProject.title)}
        detail={t(($) => $.references.unavailable.noProject.detail)}
      />
    );
  }
  switch (status) {
    case "running":
    case "not_run":
      return (
        <PanelState
          state="pending"
          title={t(($) => $.references.unavailable.indexing.title)}
          detail={t(($) => $.references.unavailable.indexing.detail)}
        />
      );
    case "unsupported":
      return (
        <PanelState
          state="unsupported"
          title={t(($) => $.references.unavailable.unsupported.title)}
          detail={reasonText ?? t(($) => $.references.unavailable.unsupported.detail)}
        />
      );
    case "unavailable":
      return (
        <PanelState
          state="error"
          title={t(($) => $.references.unavailable.offline.title)}
          detail={reasonText ?? t(($) => $.references.unavailable.offline.detail)}
        />
      );
    case "error":
      return (
        <PanelState
          state="error"
          title={t(($) => $.references.unavailable.failed.title)}
          detail={failureText ?? t(($) => $.references.unavailable.failed.detail)}
        />
      );
    default:
      return (
        <PanelState
          state="pending"
          title={t(($) => $.references.unavailable.waiting.title)}
          detail={t(($) => $.references.unavailable.waiting.detail)}
        />
      );
  }
}

type AnalysisNotice = "stale" | "partial" | null;

function analysisNotice(state: ProjectIntelligenceState): AnalysisNotice {
  if (state.stale) return "stale";
  if (state.status === "partial" || state.data?.status === "partial") return "partial";
  return null;
}

function useAnalysisNotice(): string | null {
  const { t } = useTranslation(["references"]);
  const notice = useIndexStore((state) => analysisNotice(state.intelligenceState));
  if (notice === "stale") {
    return t(($) => $.references.notice.stale);
  }
  if (notice === "partial") {
    return t(($) => $.references.notice.partial);
  }
  return null;
}

function QueryContent({
  query,
  snapshot,
  filter,
  onActivate,
  memoryProjectId,
  scrollMemory,
}: Readonly<{
  query: ReferenceQuery | null;
  snapshot: ProjectIntelligenceSnapshot;
  filter: string;
  onActivate: (node: IntelligenceTreeNode) => void;
  memoryProjectId: string | null;
  scrollMemory: ScrollMemory;
}>) {
  const { t } = useTranslation(["references"]);
  const current = useIndexStore((state) =>
    queryIsCurrent(query, state.intelligenceState, snapshot),
  );
  const result = useMemo(
    () =>
      query && current && !query.locations
        ? resolveQuery(snapshot, query)
        : { definitions: [], uses: [] },
    [current, query, snapshot],
  );
  const nodes = useMemo(() => {
    if (!query?.locations) return buildReferenceResultNodes(result.definitions, result.uses);
    return buildLocationResultNodes(current ? query.locations : []);
  }, [current, query, result]);

  if (!query) {
    return (
      <PanelState
        state="empty"
        title={t(($) => $.references.query.none.title)}
        detail={t(($) => $.references.query.none.detail)}
      />
    );
  }
  if (!current) {
    return (
      <PanelState
        state="pending"
        title={t(($) => $.references.query.expired.title)}
        detail={t(($) => $.references.query.expired.detail)}
      />
    );
  }
  if (!nodes.length) {
    return (
      <PanelState
        state="empty"
        title={t(($) => $.references.query.noLocations.title)}
        detail={t(($) => $.references.query.noLocations.detail)}
      />
    );
  }

  return (
    <IntelligenceTree
      label={query.title}
      nodes={nodes}
      query={filter}
      onActivate={onActivate}
      memoryProjectId={memoryProjectId}
      memorySlot="references.results"
      scrollMemory={scrollMemory}
      emptyMessage={t(($) => $.references.filter.noResult, { query: filter.trim() })}
    />
  );
}

export function ReferencesPanel() {
  const { t } = useTranslation(["references"]);
  const projectId = useFilesStore((state) => state.projectId);
  const projectName = useFilesStore((state) => state.projectName);
  const activePath = useFilesStore((state) => state.activePath);
  const query = useReferencesStore((state) => state.query);
  const focusRequest = useReferencesStore((state) => state.focusRequest);
  const clearQuery = useReferencesStore((state) => state.clear);
  const typstProject = useFilesStore(
    (state) => state.engine.capabilities.formatting_profile === "typst",
  );
  const [importOpen, setImportOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [remembered] = useState(() => readSidebarView(projectId, "references"));
  const [view, setView] = useState<ReferencePanelView>(
    remembered?.view ?? (query ? "results" : "citations"),
  );
  const [filter, setFilter] = useState(remembered?.filter ?? "");
  const [handledFocusRequest, setHandledFocusRequest] = useState(
    remembered?.handledFocusRequest ?? 0,
  );
  useSidebarViewMemory(projectId, "references", { view, filter, handledFocusRequest });
  const filterRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const snapshot = useIndexStore((state) =>
    acceptedProjectSnapshot(state.intelligenceState, projectId),
  );
  const analysisRunning = useIndexStore(
    (state) => state.intelligenceState.status === "running",
  );
  const notice = useAnalysisNotice();
  const citationNodes = useMemo(
    () => (snapshot ? buildCitationNodes(snapshot) : []),
    [snapshot],
  );
  const symbolNodes = useMemo(
    () => (snapshot ? buildSymbolNodes(snapshot) : []),
    [snapshot],
  );
  const issues = snapshot ? projectIssueCount(snapshot) : 0;
  const scrollMemory = useScrollMemory({
    scrollRef: bodyRef,
    projectId,
    slot: `references.${view}`,
    ready: snapshot !== null,
  });

  const previousProjectId = useRef(projectId);
  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    const next = readSidebarView(projectId, "references");
    setView(next?.view ?? (query ? "results" : "citations"));
    setFilter(next?.filter ?? "");
    setHandledFocusRequest(next?.handledFocusRequest ?? 0);
  }, [projectId, query]);

  useEffect(() => {
    if (!query || focusRequest < 1 || focusRequest === handledFocusRequest) return;
    setHandledFocusRequest(focusRequest);
    setView("results");
    setFilter("");
    filterRef.current?.focus({ preventScroll: true });
  }, [focusRequest, handledFocusRequest, query]);

  const navigate = useCallback((node: IntelligenceTreeNode) => {
    if (!node.target) return;
    void navigateToProjectRange({
      path: node.target.path,
      range: { from: node.target.from, to: node.target.to },
      source: "references",
    });
  }, []);

  const tabs: readonly {
    id: ReferencePanelView;
    label: string;
    icon: typeof SearchCode;
    count?: number;
  }[] = [
    {
      id: "results",
      label: t(($) => $.references.tabs.results),
      icon: ListRestart,
      count: query ? undefined : 0,
    },
    {
      id: "citations",
      label: t(($) => $.references.tabs.citations),
      icon: BookOpenText,
      count: snapshot?.bibliography.entries.length,
    },
    {
      id: "symbols",
      label: t(($) => $.references.tabs.symbols),
      icon: Braces,
      count: snapshot?.definitions.length,
    },
  ];

  const filterAriaLabel = (): string => {
    if (view === "results") return t(($) => $.references.filter.ariaLabelResults);
    if (view === "citations") return t(($) => $.references.filter.ariaLabelCitations);
    return t(($) => $.references.filter.ariaLabelSymbols);
  };
  const filterPlaceholder = (): string => {
    if (view === "results") return t(($) => $.references.filter.placeholderResults);
    if (view === "citations") return t(($) => $.references.filter.placeholderCitations);
    return t(($) => $.references.filter.placeholderSymbols);
  };

  const renderPanelBody = () => {
    if (!snapshot) {
      return <ReferencesUnavailable projectId={projectId} />;
    }
    if (view === "results") {
      return (
        <QueryContent
          query={query}
          snapshot={snapshot}
          filter={filter}
          onActivate={navigate}
          memoryProjectId={projectId}
          scrollMemory={scrollMemory}
        />
      );
    }
    if (view === "citations") {
      return citationNodes.length ? (
        <IntelligenceTree
          label={t(($) => $.references.trees.citations)}
          nodes={citationNodes}
          query={filter}
          onActivate={navigate}
          memoryProjectId={projectId}
          memorySlot="references.citations"
          scrollMemory={scrollMemory}
          emptyMessage={
            filter
              ? t(($) => $.references.filter.noCitation, { query: filter.trim() })
              : t(($) => $.references.trees.noCitations)
          }
        />
      ) : (
        <PanelState
          state="empty"
          title={t(($) => $.references.empty.citations.title)}
          detail={t(($) => $.references.empty.citations.detail)}
          action={
            <Button
              size="sm"
              onClick={() => setImportOpen(true)}
              className="h-8 gap-1.5 rounded-full px-3.5 text-[0.6875rem] shadow-sm"
            >
              <BookPlus aria-hidden className="size-3.5" />
              {t(($) => $.references.import.title)}
            </Button>
          }
        />
      );
    }
    return symbolNodes.length ? (
      <IntelligenceTree
        label={t(($) => $.references.trees.symbols)}
        nodes={symbolNodes}
        query={filter}
        onActivate={navigate}
        memoryProjectId={projectId}
        memorySlot="references.symbols"
        scrollMemory={scrollMemory}
        emptyMessage={
          filter
            ? t(($) => $.references.filter.noSymbol, { query: filter.trim() })
            : t(($) => $.references.trees.noSymbols)
        }
      />
    ) : (
      <PanelState
        state="empty"
        title={t(($) => $.references.empty.symbols.title)}
        detail={t(($) => $.references.empty.symbols.detail)}
      />
    );
  };

  const renderPanelBreadcrumbRow = () => (
    <div className="mt-2 flex min-w-0 items-center gap-2 px-0.5">
      <div className="min-w-0 flex-1 overflow-hidden">
        <PanelBreadcrumb
          project={projectName || undefined}
          path={activePath}
        />
      </div>
      {view === "results" && query ? (
        <Tooltip label={query.title} side="bottom">
          <span className="min-w-0 max-w-[48%] shrink truncate text-[0.5625rem] font-medium text-sidebar-foreground/75">
            {query.title}
          </span>
        </Tooltip>
      ) : null}
      {notice ? (
        <Tooltip label={notice} side="bottom">
          <button
            type="button"
            aria-label={notice}
            data-testid="references-status-info"
            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground focus-visible:bg-accent/60"
          >
            <Info aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );

  return (
    <>
      <section
        aria-label={t(($) => $.references.panel.ariaLabel)}
        aria-busy={analysisRunning}
        className="flex h-full min-h-0 flex-col"
      >
        <SidebarPanelHeader icon={SearchCode} title={t(($) => $.references.panel.title)}>
        {view === "citations" && projectId ? (
          <Tooltip label={t(($) => $.references.panel.cleanLibrary)} side="bottom">
            <button
              type="button"
              aria-label={t(($) => $.references.panel.cleanLibrary)}
              data-testid="clean-library-button"
              onClick={() => setCleanOpen(true)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground"
            >
              <Sparkles aria-hidden className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
        {view === "citations" && projectId ? (
          <Tooltip label={t(($) => $.references.import.title)} side="bottom">
            <button
              type="button"
              aria-label={t(($) => $.references.panel.importAriaLabel)}
              onClick={() => setImportOpen(true)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground"
            >
              <Upload aria-hidden className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
        {issues > 0 ? (
          <output
            aria-label={t(($) => $.references.panel.issues, { count: issues })}
            className="rounded-sm bg-amber-500/12 px-1 font-mono text-[0.5625rem] text-amber-700 dark:text-amber-300"
          >
            {issues}
          </output>
        ) : null}
        {query ? (
          <button
            type="button"
            aria-label={t(($) => $.references.panel.clearQuery)}
            title={t(($) => $.references.panel.clearQuery)}
            onClick={clearQuery}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}
        </SidebarPanelHeader>

      <div className="shrink-0 border-b border-sidebar-border/65 px-2 py-1.5">
        <Tabs
          value={view}
          onValueChange={(next) => {
            setView(next as ReferencePanelView);
            setFilter("");
          }}
        >
          <TabsList
            aria-label={t(($) => $.references.panel.viewTabs)}
            fill
          >
            {tabs.map(({ id, label, icon: Icon, count }) => (
              <TabsTrigger
                key={id}
                value={id}
                aria-label={
                  count !== undefined && count > 0
                    ? t(($) => $.references.panel.tabWithCount, { label, count })
                    : label
                }
                onClick={() => setView(id)}
                className="gap-1.5 px-2 [&_svg]:size-3.5 [&_svg]:shrink-0"
              >
                <Icon aria-hidden />
                <span className="truncate">{label}</span>
                {count !== undefined && count > 0 ? (
                  <Badge
                    aria-hidden
                    variant="secondary"
                    className="h-4 min-w-4 px-1 text-[0.625rem] tabular-nums"
                  >
                    {count}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative mt-2">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={filterRef}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label={filterAriaLabel()}
            placeholder={filterPlaceholder()}
            className="h-8 pl-7 pr-8 text-xs"
          />
          {filter ? (
            <button
              type="button"
              aria-label={t(($) => $.references.filter.clear)}
              onClick={() => setFilter("")}
              className="absolute right-0 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            >
              <X aria-hidden className="size-3" />
            </button>
          ) : null}
        </div>
        {renderPanelBreadcrumbRow()}
      </div>

      {notice ? (
        <output className="sr-only">{notice}</output>
      ) : null}

      <div
        ref={bodyRef}
        className="isolate min-h-0 flex-1 overflow-auto px-1 [scrollbar-width:thin]"
      >
        {renderPanelBody()}
        </div>
        {view === "citations" && projectId ? (
          <div className="shrink-0 border-t border-sidebar-border/65 px-2 py-1.5">
            {typstProject ? <TypstBibliographyStylePicker snapshot={snapshot} /> : null}
            <button
              type="button"
              data-testid="cite-oleafly-row"
              onClick={() => void runCiteOleaflyAction()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.6875rem] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground"
            >
              <Quote aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t(($) => $.references.citeOleafly)}
              </span>
            </button>
          </div>
        ) : null}
      </section>
      <CleanLibraryDialog open={cleanOpen} onClose={() => setCleanOpen(false)} />
      <ImportReferenceLibraryDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          setView("citations");
          setFilter("");
        }}
      />
    </>
  );
}
