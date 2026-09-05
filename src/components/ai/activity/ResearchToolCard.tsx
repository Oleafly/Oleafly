import { useId } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  ExternalLink,
  FileSearch,
  FileText,
  Loader2,
  ScrollText,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ToolEntry } from "@/store/chats";
import {
  projectToolEntry,
  type ResearchChatActions,
  type ResearchToolStatus,
  type ResearchToolView,
} from "@/lib/chat-activity";
import { cn } from "@/lib/utils";
import { usePersistentExpansion } from "./expansion-state";

const PREVIEW_LIMIT = 4_000;

function ToolIcon({ view }: { view: ResearchToolView }) {
  if (view.kind === "command") return <Terminal className="size-3.5 shrink-0 text-muted-foreground" />;
  if (view.kind === "literature") return <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />;
  if (view.kind === "citation") return <ScrollText className="size-3.5 shrink-0 text-muted-foreground" />;
  if (view.kind === "source") return <FileSearch className="size-3.5 shrink-0 text-muted-foreground" />;
  if (view.kind === "compile" || view.kind === "artifact") return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
  return <Wrench className="size-3.5 shrink-0 text-muted-foreground" />;
}

function StatusIcon({ status }: { status: ResearchToolStatus }) {
  if (status === "running") return <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />;
  if (status === "completed") return <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />;
  if (status === "cancelled") return <CircleStop className="size-3 shrink-0 text-muted-foreground" />;
  return <XCircle className="size-3 shrink-0 text-destructive" />;
}

function LiteratureResults({ view, actions }: { view: ResearchToolView; actions?: ResearchChatActions }) {
  if (!view.results?.length) return null;
  return (
    <ol className="space-y-2 border-t px-2.5 py-2">
      {view.results.slice(0, 10).map((result, index) => {
        const canOpen = Boolean(actions?.openSource && (result.id || result.url || result.doi));
        return (
          <li key={result.id ?? result.doi ?? `${result.title}:${index}`} className="min-w-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug text-foreground">{result.title}</p>
                {(result.authors.length > 0 || result.year) && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {[result.authors.slice(0, 3).join(", "), result.year].filter(Boolean).join(" · ")}
                  </p>
                )}
                {(result.source || result.doi) && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {[result.source, result.doi ? `DOI ${result.doi}` : null].filter(Boolean).join(" · ")}
                  </p>
                )}
                {result.abstract && <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{result.abstract}</p>}
              </div>
              {canOpen && (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Open source: ${result.title}`}
                  onClick={() => actions?.openSource?.({ sourceId: result.id, url: result.url, doi: result.doi })}
                >
                  <ExternalLink className="size-3.5" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ResearchToolCard({
  tc,
  actions,
  expansionKey,
}: {
  tc: ToolEntry;
  actions?: ResearchChatActions;
  expansionKey?: string;
}) {
  const view = projectToolEntry(tc);
  const [expanded, setExpanded] = usePersistentExpansion(expansionKey, false);
  const [full, setFull] = usePersistentExpansion(expansionKey ? `${expansionKey}:full` : undefined, false);
  const regionId = useId();
  const hasStructuredResults = Boolean(view.results?.length);
  const hasOutput = Boolean(view.output);
  const expandable = hasOutput || hasStructuredResults || Boolean(view.diagnostics?.length);
  const failed = view.status === "failed" || view.status === "declined";
  const preview = full ? view.output : view.output.slice(0, PREVIEW_LIMIT);
  const truncated = view.output.length > PREVIEW_LIMIT;
  const canOpenArtifact = Boolean(actions?.openArtifact && view.path);
  const canOpenSource = Boolean(actions?.openSource && (view.url || view.doi));
  const canOpenSession = Boolean(actions?.openSession && view.threadId);
  return (
    <div
      data-tool-name={tc.name}
      data-tool-status={view.status}
      data-tool-result={view.status}
      data-testid={view.kind === "command" ? "exec-card" : "research-tool-card"}
      data-exec-status={view.kind === "command" ? (view.status === "completed" ? view.statusLabel : view.statusLabel.toLowerCase()) : undefined}
      className="max-w-[85%] overflow-hidden rounded-md border bg-muted text-xs"
    >
      <button
        type="button"
        aria-controls={expandable ? regionId : undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={() => expandable && setExpanded((value) => !value)}
        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left", expandable && "cursor-pointer hover:bg-accent/50")}
      >
        <ToolIcon view={view} />
        <span className={cn("min-w-0 flex-1 truncate", view.kind === "command" && "font-mono text-[11px]")}>{view.kind === "command" ? `$ ${view.command || tc.name}` : view.label}</span>
        <StatusIcon status={view.status} />
        <span className={cn("text-[10px] text-muted-foreground", failed && "text-destructive")}>{view.statusLabel}</span>
        {expandable && <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />}
      </button>
      {(view.summary || tc.approval) && (
        <div className="flex items-center gap-2 border-t px-2.5 py-1 text-[10px] text-muted-foreground">
          {view.summary && <span className={cn("min-w-0 flex-1 truncate", view.verified === false && "text-destructive")}>{view.summary}</span>}
          {tc.approval && <span className={cn("ml-auto rounded-full px-1.5 py-0.5 font-medium", tc.approval === "approved" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-destructive/15 text-destructive")}>{tc.approval === "approved" ? "Approved" : "Rejected"}</span>}
        </div>
      )}
      {expanded && (
        <div id={regionId}>
          <LiteratureResults view={view} actions={actions} />
          {view.diagnostics?.length ? (
            <ul className="space-y-1 border-t px-2.5 py-2 text-[11px] text-destructive">
              {[...new Set(view.diagnostics)].slice(0, 20).map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
            </ul>
          ) : null}
          {preview && (
            <pre className="max-h-80 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words border-t px-2.5 py-2 font-mono text-[10px] text-muted-foreground">{preview}</pre>
          )}
          <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1">
            {truncated && (
              <button type="button" className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setFull((value) => !value)}>{full ? "Show less" : `Show all ${view.output.length.toLocaleString()} characters`}</button>
            )}
            {canOpenArtifact && (
              <button type="button" className="rounded px-1.5 py-1 text-[10px] font-medium hover:bg-accent" onClick={() => {
                if (view.path) actions?.openArtifact?.({ path: view.path, line: view.line, page: view.page });
              }}>Open file</button>
            )}
            {canOpenSource && (
              <button type="button" className="rounded px-1.5 py-1 text-[10px] font-medium hover:bg-accent" onClick={() => actions?.openSource?.({ url: view.url, doi: view.doi, page: view.page })}>Open source</button>
            )}
            {canOpenSession && (
              <button type="button" className="rounded px-1.5 py-1 text-[10px] font-medium hover:bg-accent" onClick={() => {
                if (view.threadId) actions?.openSession?.({ threadId: view.threadId });
              }}>Open task</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
