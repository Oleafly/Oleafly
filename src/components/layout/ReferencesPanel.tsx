import {
  BookOpenText,
  Braces,
  ListRestart,
  SearchCode,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IntelligenceFilter,
  IntelligenceTree,
  PanelBreadcrumb,
  PanelState,
  type IntelligenceTreeNode,
} from "@/components/layout/IntelligenceTree";
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
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  useReferencesStore,
  type ReferenceQuery,
} from "@/store/references";

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
  if (!projectId) {
    return (
      <PanelState
        state="empty"
        title="No project open"
        detail="Open a document project to inspect citations, symbols, and cross-file references."
      />
    );
  }
  switch (state.status) {
    case "running":
    case "not_run":
      return (
        <PanelState
          state="pending"
          title="Indexing project intelligence"
          detail="References and citations will appear when the current project revision is ready."
        />
      );
    case "unsupported":
      return (
        <PanelState
          state="unsupported"
          title="Project intelligence unavailable"
          detail={
            state.reason ??
            "The active project does not use a supported document engine."
          }
        />
      );
    case "unavailable":
      return (
        <PanelState
          state="error"
          title="Analysis service unavailable"
          detail={
            state.reason ??
            "References and citations cannot be checked in this workspace right now."
          }
        />
      );
    case "error":
      return (
        <PanelState
          state="error"
          title="Project analysis failed"
          detail={
            state.failure?.message ??
            state.reason ??
            "The latest project revision could not be analyzed. Source files were not changed."
          }
        />
      );
    default:
      return (
        <PanelState
          state="pending"
          title="Waiting for project analysis"
          detail="The latest project revision has not been indexed yet."
        />
      );
  }
}

function AnalysisNotice({ state }: { state: ProjectIntelligenceState }) {
  if (state.stale) {
    return (
      <div
        role="status"
        className="border-b border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-800 dark:text-amber-200"
      >
        Updating. Previous-revision citations, symbols, and ranges are hidden.
      </div>
    );
  }
  if (state.status === "partial" || state.data?.status === "partial") {
    return (
      <div
        role="status"
        className="border-b border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-800 dark:text-amber-200"
      >
        Partial results. Malformed or unreadable files may omit some
        occurrences.
      </div>
    );
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
        title="No reference query"
        detail="Place the cursor on a label, citation, command, or environment and press Shift-F12."
      />
    );
  }
  if (!current) {
    return (
      <PanelState
        state="pending"
        title="Reference results expired"
        detail="The project changed after this query. Run Find References again to use current source ranges."
      />
    );
  }
  if (!nodes.length) {
    return (
      <PanelState
        state="empty"
        title="No locations found"
        detail="The symbol exists in this revision, but it has no matching definitions or occurrences."
      />
    );
  }

  return (
    <IntelligenceTree
      label={query.title}
      nodes={nodes}
      query={filter}
      onActivate={onActivate}
      emptyMessage={`No result matches “${filter.trim()}”.`}
    />
  );
}

export function ReferencesPanel() {
  const intelligenceState = useIndexStore((state) => state.intelligenceState);
  const projectId = useFilesStore((state) => state.projectId);
  const projectName = useFilesStore((state) => state.projectName);
  const activePath = useFilesStore((state) => state.activePath);
  const query = useReferencesStore((state) => state.query);
  const focusRequest = useReferencesStore((state) => state.focusRequest);
  const clearQuery = useReferencesStore((state) => state.clear);
  const [view, setView] = useState<ReferencePanelView>(
    query ? "results" : "citations",
  );
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const snapshot = acceptedProjectSnapshot(
    intelligenceState,
    projectId,
  );
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
      label: "References",
      icon: ListRestart,
      count: query ? undefined : 0,
    },
    {
      id: "citations",
      label: "Citations",
      icon: BookOpenText,
      count: snapshot?.bibliography.entries.length,
    },
    {
      id: "symbols",
      label: "Symbols",
      icon: Braces,
      count: snapshot?.definitions.length,
    },
  ];

  return (
    <section
      aria-label="References (Shift-F12)"
      aria-busy={intelligenceState.status === "running"}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border px-2.5">
        <SearchCode aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/75">
          References
        </span>
        {issues > 0 ? (
          <span
            role="status"
            aria-label={`${issues} reference or citation issues`}
            className="rounded-sm bg-amber-500/12 px-1 font-mono text-[9px] text-amber-700 dark:text-amber-300"
          >
            {issues}
          </span>
        ) : null}
        {query ? (
          <button
            type="button"
            aria-label="Clear reference query"
            title="Clear reference query"
            onClick={clearQuery}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-sidebar-border/65 px-2 py-1.5">
        <div
          role="tablist"
          aria-label="Reference panel view"
          className="grid h-7 grid-cols-3 rounded-md bg-muted/70 p-0.5"
        >
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              aria-label={
                count !== undefined && count > 0
                  ? `${label}, ${count}`
                  : label
              }
              onClick={() => {
                setView(id);
                setFilter("");
              }}
              className={cn(
                "flex min-h-6 min-w-0 items-center justify-center gap-1 rounded-[4px] px-1.5 text-[10px] font-medium text-muted-foreground transition-colors",
                "focus-visible:ring-1 focus-visible:ring-ring",
                view === id &&
                  "bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.08)]",
              )}
            >
              <Icon aria-hidden className="size-3" />
              <span className="truncate">{label}</span>
              {count !== undefined && count > 0 ? (
                <span
                  aria-hidden
                  className="font-mono text-[8px] text-muted-foreground"
                >
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="mt-1.5">
          <IntelligenceFilter
            inputRef={filterRef}
            value={filter}
            onChange={setFilter}
            label={`Filter ${view}`}
            placeholder={
              view === "results"
                ? "Filter locations…"
                : view === "citations"
                  ? "Filter keys, titles, authors…"
                  : "Filter labels and commands…"
            }
          />
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
        </div>
      </div>

      <AnalysisNotice state={intelligenceState} />

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
                label="Project citations"
                nodes={citationNodes}
                query={filter}
                onActivate={navigate}
                emptyMessage={
                  filter
                    ? `No citation matches “${filter.trim()}”.`
                    : "No bibliography entries or citation uses were found."
                }
              />
            ) : (
              <PanelState
                state="empty"
                title="No citations yet"
                detail="Add a bibliography entry or citation to begin the project catalog."
              />
            )
          ) : symbolNodes.length ? (
            <IntelligenceTree
              label="Project symbols"
              nodes={symbolNodes}
              query={filter}
              onActivate={navigate}
              emptyMessage={
                filter
                  ? `No symbol matches “${filter.trim()}”.`
                  : "No project-defined symbols were found."
              }
            />
          ) : (
            <PanelState
              state="empty"
              title="No symbols yet"
              detail="Headings, labels, commands, and environments appear here as the project is authored."
            />
          )
        ) : (
          <ReferencesUnavailable
            state={intelligenceState}
            projectId={projectId}
          />
        )}
      </div>
    </section>
  );
}
