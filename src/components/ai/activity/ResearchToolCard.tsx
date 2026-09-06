import { useId, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
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
  type ResearchArtifactPreview,
  type ResearchChatActions,
  type ResearchToolStatus,
  type ResearchToolView,
} from "@/lib/chat-activity";
import { cn } from "@/lib/utils";
import { usePersistentExpansion } from "./expansion-state";
import { ToolPicture } from "./ToolPicture";

const PREVIEW_LIMIT = 4_000;

function ToolIcon({ view, className }: { view: ResearchToolView; className?: string }) {
  const classes = cn("size-3.5 shrink-0 text-muted-foreground", className);
  if (view.kind === "command") return <Terminal className={classes} />;
  if (view.kind === "literature") return <BookOpen className={classes} />;
  if (view.kind === "citation") return <ScrollText className={classes} />;
  if (view.kind === "source") return <FileSearch className={classes} />;
  if (view.kind === "compile" || view.kind === "artifact") return <FileText className={classes} />;
  return <Wrench className={classes} />;
}

function LeadingIcon({ view, expandable, expanded }: { view: ResearchToolView; expandable: boolean; expanded: boolean }) {
  if (!expandable) return <ToolIcon view={view} />;
  if (expanded) return <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />;
  return (
    <span className="relative flex size-3.5 shrink-0 items-center justify-center">
      <ToolIcon view={view} className="transition-opacity group-hover:opacity-0" />
      <ChevronRight className="absolute inset-0 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </span>
  );
}

function StatusIcon({ status }: { status: ResearchToolStatus }) {
  if (status === "running") return <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />;
  if (status === "completed") return <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />;
  if (status === "cancelled" || status === "interrupted")
    return <CircleStop className="size-3 shrink-0 text-muted-foreground" />;
  return <XCircle className="size-3 shrink-0 text-destructive" />;
}

function LiteratureResults({ view, actions }: { view: ResearchToolView; actions?: ResearchChatActions }) {
  if (!view.results?.length) return null;
  return (
    <ol className="space-y-2 py-1">
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

function toolResult(tc: ToolEntry): "success" | "error" | undefined {
  if (tc.output?.includes('"success": true')) return "success";
  if (tc.output?.includes('"error"')) return "error";
  return undefined;
}

export function ResearchToolCard({
  tc,
  actions,
  expansionKey,
  live = false,
}: {
  tc: ToolEntry & { interrupted?: boolean };
  actions?: ResearchChatActions;
  expansionKey?: string;
  live?: boolean;
}) {
  const view = projectToolEntry(tc);
  const [expanded, setExpanded] = usePersistentExpansion(expansionKey, false);
  const [full, setFull] = usePersistentExpansion(expansionKey ? `${expansionKey}:full` : undefined, false);
  const [artifactPreview, setArtifactPreview] = useState<ResearchArtifactPreview>();
  const [artifactError, setArtifactError] = useState(false);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const regionId = useId();
  const hasStructuredResults = Boolean(view.results?.length);
  const hasOutput = Boolean(view.output);
  const hasPicture = Boolean(tc.image);
  const expandable = hasOutput || hasStructuredResults || hasPicture || Boolean(view.diagnostics?.length);
  const preview = full ? view.output : view.output.slice(0, PREVIEW_LIMIT);
  const truncated = view.output.length > PREVIEW_LIMIT;
  const canOpenArtifact = Boolean(actions?.openArtifact && view.artifactTarget);
  const canOpenSource = Boolean(actions?.openSource && (view.url || view.doi));
  const canOpenSession = Boolean(actions?.openSession && view.threadId);
  return (
    <div
      data-tool-name={tc.name}
      data-tool-status={tc.status}
      data-tool-result={toolResult(tc)}
      data-research-status={view.status}
      data-testid={view.kind === "command" ? "exec-card" : "research-tool-card"}
      data-exec-status={view.kind === "command" ? (view.status === "completed" ? view.statusLabel : view.statusLabel.toLowerCase()) : undefined}
      className="max-w-[85%] text-xs"
    >
      <button
        type="button"
        aria-controls={expandable ? regionId : undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={() => expandable && setExpanded((value) => !value)}
        className={cn("group flex w-full items-center gap-2 py-1 text-left", expandable && "cursor-pointer")}
      >
        <LeadingIcon view={view} expandable={expandable} expanded={expanded} />
        <span className={cn("min-w-0 truncate text-sm text-foreground/90", view.kind === "command" && "font-mono text-[12px]")}>{view.kind === "command" ? `$ ${view.command || tc.name}` : view.label}</span>
        <StatusIcon status={view.status} />
        <span className="sr-only">{view.statusLabel}</span>
        {tc.approval && (
          <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", tc.approval === "approved" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-destructive/15 text-destructive")}>{tc.approval === "approved" ? "Approved" : "Rejected"}</span>
        )}
        {view.summary && (
          <span className={cn("min-w-0 truncate text-[11px] text-muted-foreground", view.verified === false && "text-destructive")}>{view.summary}</span>
        )}
      </button>
      {hasPicture && (live || expanded) && (
        <div className="ml-[0.4375rem] border-l pl-3">
          <ToolPicture tc={tc} />
        </div>
      )}
      {expanded && (
        <div id={regionId} className="ml-[0.4375rem] space-y-2 border-l pl-3 pb-1">
          <LiteratureResults view={view} actions={actions} />
          {view.diagnostics?.length ? (
            <ul className="space-y-1 py-1 text-[11px] text-destructive">
              {[...new Set(view.diagnostics)].slice(0, 20).map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
            </ul>
          ) : null}
          {preview && (
            <pre className="max-h-80 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[10px] text-muted-foreground">{preview}</pre>
          )}
          {artifactPreview && (
            <div className="py-1">
              <p className="mb-1 truncate text-[10px] font-medium">{artifactPreview.relativePath}</p>
              {artifactPreview.isBinary ? (
                <p className="text-[10px] text-muted-foreground">This linked file is binary, so it cannot be previewed here.</p>
              ) : (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">{artifactPreview.content}</pre>
              )}
              {artifactPreview.truncated && <p className="mt-1 text-[10px] text-muted-foreground">Preview stopped at 256 KiB.</p>}
            </div>
          )}
          {artifactError && <p className="py-1 text-[10px] text-destructive">This linked source could not be previewed.</p>}
          <div className="flex flex-wrap items-center gap-1">
            {truncated && (
              <button type="button" className="rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setFull((value) => !value)}>{full ? "Show less" : `Show all ${view.output.length.toLocaleString()} characters`}</button>
            )}
            {canOpenArtifact && (
              <button type="button" disabled={artifactLoading} className="rounded px-1.5 py-1 text-[10px] font-medium hover:bg-accent disabled:opacity-50" onClick={() => {
                if (!view.artifactTarget || !actions?.openArtifact) return;
                setArtifactLoading(true);
                setArtifactError(false);
                Promise.resolve(actions.openArtifact(view.artifactTarget)).then((result) => {
                  if (result) setArtifactPreview(result);
                }).catch(() => setArtifactError(true)).finally(() => setArtifactLoading(false));
              }}>{view.artifactTarget?.scope === "linked" ? (artifactLoading ? "Loading source" : "Inspect source") : "Open file"}</button>
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
