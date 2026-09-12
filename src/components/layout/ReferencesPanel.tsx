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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { runCiteOleaflyAction } from "@/features/cite-oleafly";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import {
  buildCitationNodes,
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
  state,
  projectId,
}: {
  state: ProjectIntelligenceState;
  projectId: string | null;
}) {
  const { t } = useTranslation(["references"]);
  if (!projectId) {
    return (
      <PanelState
        state="empty"
        title={t(($) => $.references.unavailable.noProject.title)}
        detail={t(($) => $.references.unavailable.noProject.detail)}
      />
    );
  }
  switch (state.status) {
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
          detail={
            projectIntelligenceReasonText(state.reason) ??
            t(($) => $.references.unavailable.unsupported.detail)
          }
        />
      );
    case "unavailable":
      return (
        <PanelState
          state="error"
          title={t(($) => $.references.unavailable.offline.title)}
          detail={
            projectIntelligenceReasonText(state.reason) ??
            t(($) => $.references.unavailable.offline.detail)
          }
        />
      );
    case "error":
      return (
        <PanelState
          state="error"
          title={t(($) => $.references.unavailable.failed.title)}
          detail={
            projectIntelligenceFailureText(state) ??
            t(($) => $.references.unavailable.failed.detail)
          }
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

function useAnalysisNotice(state: ProjectIntelligenceState): string | null {
  const { t } = useTranslation(["references"]);
  if (state.stale) {
    return t(($) => $.references.notice.stale);
  }
  if (state.status === "partial" || state.data?.status === "partial") {
    return t(($) => $.references.notice.partial);
  }
  return null;
}

function QueryContent({
  query,
  state,
  snapshot,
  filter,
  onActivate,
}: {
  query: ReferenceQuery | null;
  state: ProjectIntelligenceState;
  snapshot: ProjectIntelligenceSnapshot;
  filter: string;
  onActivate: (node: IntelligenceTreeNode) => void;
}) {
  const { t } = useTranslation(["references"]);
  const current = query ? identitiesMatch(query, state, snapshot) : false;
  const result = useMemo(
    () =>
      query && current
        ? resolveQuery(snapshot, query)
        : { definitions: [], uses: [] },
    [current, query, snapshot],
  );
  const nodes = useMemo(
    () => buildReferenceResultNodes(result.definitions, result.uses),
    [result],
  );

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
      emptyMessage={t(($) => $.references.filter.noResult, { query: filter.trim() })}
    />
  );
}

export function ReferencesPanel() {
  const { t } = useTranslation(["references"]);
  const intelligenceState = useIndexStore((state) => state.intelligenceState);
  const projectId = useFilesStore((state) => state.projectId);
  const projectName = useFilesStore((state) => state.projectName);
  const activePath = useFilesStore((state) => state.activePath);
  const query = useReferencesStore((state) => state.query);
  const focusRequest = useReferencesStore((state) => state.focusRequest);
  const clearQuery = useReferencesStore((state) => state.clear);
  const [importOpen, setImportOpen] = useState(false);
  const [view, setView] = useState<ReferencePanelView>(
    query ? "results" : "citations",
  );
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const snapshot = acceptedProjectSnapshot(
    intelligenceState,
    projectId,
  );
  const notice = useAnalysisNotice(intelligenceState);
  const citationNodes = useMemo(
    () => (snapshot ? buildCitationNodes(snapshot) : []),
    [snapshot],
  );
  const symbolNodes = useMemo(
    () => (snapshot ? buildSymbolNodes(snapshot) : []),
    [snapshot],
  );
  const issues = snapshot ? projectIssueCount(snapshot) : 0;

  useEffect(() => {
    if (!query || focusRequest < 1) return;
    setView("results");
    setFilter("");
    filterRef.current?.focus({ preventScroll: true });
  }, [focusRequest, query]);

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

  return (
    <>
      <section
        aria-label={t(($) => $.references.panel.ariaLabel)}
        aria-busy={intelligenceState.status === "running"}
        className="flex h-full min-h-0 flex-col"
      >
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border px-2.5">
        <SearchCode aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/75">
          {t(($) => $.references.panel.title)}
        </span>
        {view === "citations" && projectId ? (
          <Tooltip label={t(($) => $.references.import.title)} side="bottom">
            <button
              type="button"
              aria-label={t(($) => $.references.panel.importAriaLabel)}
              onClick={() => setImportOpen(true)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Upload aria-hidden className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
        {issues > 0 ? (
          <span
            role="status"
            aria-label={t(($) => $.references.panel.issues, { count: issues })}
            className="rounded-sm bg-amber-500/12 px-1 font-mono text-[9px] text-amber-700 dark:text-amber-300"
          >
            {issues}
          </span>
        ) : null}
        {query ? (
          <button
            type="button"
            aria-label={t(($) => $.references.panel.clearQuery)}
            title={t(($) => $.references.panel.clearQuery)}
            onClick={clearQuery}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </header>

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
            className="flex h-auto w-full gap-1"
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
                className="min-w-0 flex-1 gap-1.5 px-2 [&_svg]:size-3.5 [&_svg]:shrink-0"
              >
                <Icon aria-hidden />
                <span className="truncate">{label}</span>
                {count !== undefined && count > 0 ? (
                  <Badge
                    aria-hidden
                    variant="secondary"
                    className="h-4 min-w-4 px-1 text-[10px] tabular-nums"
                  >
                    {count}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative mt-1.5">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={filterRef}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label={
              view === "results"
                ? t(($) => $.references.filter.ariaLabelResults)
                : view === "citations"
                  ? t(($) => $.references.filter.ariaLabelCitations)
                  : t(($) => $.references.filter.ariaLabelSymbols)
            }
            placeholder={
              view === "results"
                ? t(($) => $.references.filter.placeholderResults)
                : view === "citations"
                  ? t(($) => $.references.filter.placeholderCitations)
                  : t(($) => $.references.filter.placeholderSymbols)
            }
            className="h-8 pl-7 pr-8 text-xs"
          />
          {filter ? (
            <button
              type="button"
              aria-label={t(($) => $.references.filter.clear)}
              onClick={() => setFilter("")}
              className="absolute right-0 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-2 px-0.5">
          <PanelBreadcrumb
            project={projectName || undefined}
            path={activePath}
          />
          {view === "results" && query ? (
            <Tooltip label={query.title} side="bottom">
              <span className="ml-auto max-w-[48%] shrink truncate text-[9px] font-medium text-sidebar-foreground/75">
                {query.title}
              </span>
            </Tooltip>
          ) : null}
          {notice ? (
            <Tooltip label={notice} side="bottom">
              <span
                className={`flex shrink-0 items-center text-amber-600 dark:text-amber-400 ${
                  view === "results" && query ? "" : "ml-auto"
                }`}
              >
                <Info aria-hidden className="size-3.5" />
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {notice ? (
        <output className="sr-only">{notice}</output>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-1 [scrollbar-width:thin]">
        {snapshot ? (
          view === "results" ? (
            <QueryContent
              query={query}
              state={intelligenceState}
              snapshot={snapshot}
              filter={filter}
              onActivate={navigate}
            />
          ) : view === "citations" ? (
            citationNodes.length ? (
              <IntelligenceTree
                label={t(($) => $.references.trees.citations)}
                nodes={citationNodes}
                query={filter}
                onActivate={navigate}
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
                    className="h-8 gap-1.5 rounded-full px-3.5 text-[11px] shadow-sm"
                  >
                    <BookPlus aria-hidden className="size-3.5" />
                    {t(($) => $.references.import.title)}
                  </Button>
                }
              />
            )
          ) : symbolNodes.length ? (
            <IntelligenceTree
              label={t(($) => $.references.trees.symbols)}
              nodes={symbolNodes}
              query={filter}
              onActivate={navigate}
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
          )
        ) : (
          <ReferencesUnavailable
            state={intelligenceState}
            projectId={projectId}
          />
        )}
        </div>
        {view === "citations" && projectId ? (
          <div className="shrink-0 border-t border-sidebar-border/65 px-2 py-1.5">
            <button
              type="button"
              data-testid="cite-oleafly-row"
              onClick={() => void runCiteOleaflyAction()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Quote aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t(($) => $.references.citeOleafly)}
              </span>
            </button>
          </div>
        ) : null}
      </section>
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
