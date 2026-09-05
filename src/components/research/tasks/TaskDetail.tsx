import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileDiff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import {
  previewResearchTaskArtifact,
  previewResearchTaskFile,
} from "@/lib/research-tasks";
import type {
  ResearchTask,
  TaskArtifact,
  TaskArtifactPreview,
  TaskFilePreview,
  TaskRuntimeEvent,
  TaskTranscriptEvent,
} from "@/lib/research-tasks";

interface TaskDetailProps {
  task: ResearchTask;
  tasks: ResearchTask[];
  events: TaskTranscriptEvent[];
  eventsLoading: boolean;
  canLoadMoreEvents: boolean;
  busy: boolean;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
  onEdit: () => void;
  onApply: (paths: string[]) => Promise<void>;
  onAccept: () => Promise<void>;
  onLoadMoreEvents: () => Promise<void>;
  onOpenSession?: (task: ResearchTask) => void;
  onOpenArtifact?: (task: ResearchTask, artifact: TaskArtifact) => void;
}

const STATUS_LABELS: Record<ResearchTask["status"], string> = {
  queued: "Queued",
  running: "Running",
  awaiting_review: "Review needed",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function EventRow({ event }: { event: TaskRuntimeEvent }) {
  switch (event.kind) {
    case "sessionBound":
      return <p>Session connected.</p>;
    case "status":
      return <p>{event.message}</p>;
    case "text":
      return <p className="whitespace-pre-wrap text-foreground">{event.text}</p>;
    case "reasoning":
      return (
        <details>
          <summary className="cursor-pointer text-foreground">Reported reasoning</summary>
          <p className="mt-2 whitespace-pre-wrap">{event.text}</p>
        </details>
      );
    case "tool":
      return (
        <p>
          <span className="font-medium text-foreground">{event.name}</span>
          {event.detail ? `: ${event.detail}` : ""}
        </p>
      );
    case "artifact":
      return <p>Saved {event.artifact.label}.</p>;
    case "usage":
      return (
        <p>
          Usage: {event.inputTokens ?? "unknown"} input, {event.outputTokens ?? "unknown"} output
          tokens.
        </p>
      );
  }
}

export function TaskDetail({
  task,
  tasks,
  events,
  eventsLoading,
  canLoadMoreEvents,
  busy,
  onStart,
  onCancel,
  onRetry,
  onEdit,
  onApply,
  onAccept,
  onLoadMoreEvents,
  onOpenSession,
  onOpenArtifact,
}: TaskDetailProps) {
  const changedFiles = useMemo(() => task.result?.changedFiles ?? [], [task.result?.changedFiles]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [filePreviews, setFilePreviews] = useState<Record<string, TaskFilePreview>>({});
  const [previewingPath, setPreviewingPath] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<TaskArtifactPreview | null>(null);

  useEffect(() => {
    setSelectedPaths(changedFiles.map((change) => change.path));
    setFilePreviews({});
    setPreviewingPath(null);
    setPreviewError(null);
    setArtifactPreview(null);
  }, [changedFiles]);

  const previewFile = async (path: string) => {
    setPreviewingPath(path);
    setPreviewError(null);
    try {
      const preview = await previewResearchTaskFile(task.id, path);
      setFilePreviews((current) => ({ ...current, [path]: preview }));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewingPath(null);
    }
  };

  const previewArtifact = async (artifact: TaskArtifact) => {
    setPreviewingPath(artifact.path);
    setPreviewError(null);
    try {
      setArtifactPreview(await previewResearchTaskArtifact(task.id, artifact.path));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewingPath(null);
    }
  };

  const dependencies = useMemo(
    () =>
      task.dependencyIds.map(
        (id) => tasks.find((candidate) => candidate.id === id) ?? { id, title: id, status: null },
      ),
    [task.dependencyIds, tasks],
  );
  const blocked = dependencies.some((dependency) => dependency.status !== "completed");

  return (
    <article aria-labelledby="research-task-detail-title" className="min-h-0 space-y-5 overflow-auto">
      <header className="space-y-2 border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="research-task-detail-title" className="break-words text-base font-semibold">
              {task.title}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={task.status === "awaiting_review" ? "primaryGhost" : "quiet"}>
                {STATUS_LABELS[task.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {task.agentId}
                {task.modelId ? ` · ${task.modelId}` : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {task.status === "queued" ? (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  disabled={busy || task.startRequested}
                  onClick={() => void onStart().catch(() => {})}
                >
                  {task.startRequested ? "Waiting" : blocked ? "Start when ready" : "Start"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void onCancel().catch(() => {})}
                >
                  Cancel
                </Button>
              </>
            ) : null}
            {task.status === "running" ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || task.cancelRequested}
                onClick={() => void onCancel().catch(() => {})}
              >
                {task.cancelRequested ? "Stopping..." : "Stop task"}
              </Button>
            ) : null}
            {task.status === "failed" || task.status === "cancelled" ? (
              <Button size="sm" disabled={busy} onClick={() => void onRetry().catch(() => {})}>
                Retry
              </Button>
            ) : null}
            {task.sessionId && onOpenSession ? (
              <Button size="sm" variant="outline" onClick={() => onOpenSession(task)}>
                Open session
                <ExternalLink />
              </Button>
            ) : null}
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.prompt}</p>
      </header>

      {task.error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">This task needs attention</p>
          <p className="mt-1 text-sm text-foreground">{task.error}</p>
        </div>
      ) : null}

      {dependencies.length > 0 ? (
        <section aria-labelledby="research-task-dependencies">
          <h4 id="research-task-dependencies" className="text-sm font-medium">
            Dependencies
          </h4>
          <ul className="mt-2 space-y-1 text-sm">
            {dependencies.map((dependency) => (
              <li key={dependency.id} className="flex items-center justify-between gap-3">
                <span className="truncate">{dependency.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dependency.status ? STATUS_LABELS[dependency.status] : "Unavailable"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {task.sourceRevision ? (
        <section className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          <p>
            {task.isolation?.kind === "git_worktree" ? "Git worktree" : "Staged copy"} · source {" "}
            <span className="font-mono">{task.sourceRevision.slice(0, 28)}</span>
          </p>
          <p className="mt-1">The original project stays unchanged until you apply reviewed files.</p>
        </section>
      ) : null}

      {task.result ? (
        <section aria-labelledby="research-task-result" className="space-y-3">
          <div>
            <h4 id="research-task-result" className="text-sm font-medium">
              Result
            </h4>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {task.result.summary || "The task finished without a written summary."}
            </p>
          </div>

          {task.result.artifacts.length > 0 ? (
            <div className="space-y-2">
              <h5 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Artifacts
              </h5>
              {task.result.artifacts.map((artifact) => (
                <button
                  key={`${artifact.path}:${artifact.label}`}
                  type="button"
                  disabled={previewingPath === artifact.path}
                  onClick={() => void previewArtifact(artifact)}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-70"
                >
                  <span>
                    {previewingPath === artifact.path ? "Loading..." : artifact.label}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {artifact.path}
                  </span>
                </button>
              ))}
              {artifactPreview ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{artifactPreview.artifact.label}</p>
                    {onOpenArtifact ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onOpenArtifact(task, artifactPreview.artifact)}
                      >
                        Open elsewhere
                      </Button>
                    ) : null}
                  </div>
                  {artifactPreview.content.text !== null ? (
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                      {artifactPreview.content.text}
                    </pre>
                  ) : artifactPreview.content.base64 && artifactPreview.content.mediaType ? (
                    <img
                      className="mt-2 max-h-72 max-w-full rounded border object-contain"
                      alt={artifactPreview.artifact.label}
                      src={`data:${artifactPreview.content.mediaType};base64,${artifactPreview.content.base64}`}
                    />
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Binary file · {artifactPreview.content.size ?? 0} bytes. Use Open elsewhere to inspect it.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {changedFiles.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h5 className="flex items-center gap-2 text-sm font-medium">
                  <FileDiff className="size-4" />
                  File changes
                </h5>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setSelectedPaths(
                      selectedPaths.length === changedFiles.length
                        ? []
                        : changedFiles.map((change) => change.path),
                    )
                  }
                >
                  {selectedPaths.length === changedFiles.length ? "Clear selection" : "Select all"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Preview every selected file before applying it.
              </p>
              <div className="divide-y rounded-md border">
                {changedFiles.map((change) => {
                  const preview = filePreviews[change.path];
                  return (
                    <div key={change.path} className="p-3">
                      <div className="flex items-center gap-3 text-sm">
                        <Checkbox
                          aria-label={`Apply ${change.path}`}
                          checked={selectedPaths.includes(change.path)}
                          disabled={task.status !== "awaiting_review" || busy}
                          onCheckedChange={(checked) =>
                            setSelectedPaths((current) =>
                              checked === true
                                ? [...current, change.path]
                                : current.filter((path) => path !== change.path),
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {change.path}
                        </span>
                        <span className="text-xs capitalize text-muted-foreground">
                          {change.kind}
                        </span>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={previewingPath === change.path}
                          onClick={() => void previewFile(change.path)}
                        >
                          {previewingPath === change.path
                            ? "Loading..."
                            : preview
                              ? "Refresh preview"
                              : "Preview"}
                        </Button>
                      </div>
                      {preview ? (
                        <div className="mt-3 overflow-hidden rounded-md border">
                          {preview.before.text !== null || preview.after.text !== null ? (
                            <InlineDiffPreview
                              path={preview.path}
                              oldText={preview.before.text ?? ""}
                              newText={preview.after.text ?? ""}
                            />
                          ) : (
                            <div className="grid grid-cols-2 divide-x text-xs text-muted-foreground">
                              <div className="p-3">
                                Before: {preview.before.exists ? `${preview.before.size} bytes` : "absent"}
                              </div>
                              <div className="p-3">
                                After: {preview.after.exists ? `${preview.after.size} bytes` : "absent"}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {previewError ? (
                <p role="alert" className="text-xs text-destructive">
                  {previewError}
                </p>
              ) : null}
              {task.status === "awaiting_review" ? (
                <div className="flex justify-end">
                  <Button
                    disabled={
                      busy ||
                      selectedPaths.length === 0 ||
                      selectedPaths.some((path) => !filePreviews[path])
                    }
                    onClick={() => void onApply(selectedPaths).catch(() => {})}
                  >
                    {busy ? "Applying..." : `Apply ${selectedPaths.length} selected`}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : task.status === "awaiting_review" ? (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <p className="text-sm text-muted-foreground">No project files changed.</p>
              <Button disabled={busy} onClick={() => void onAccept().catch(() => {})}>
                Mark reviewed
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {task.executionGeneration > 0 ? (
        <section aria-labelledby="research-task-activity" className="space-y-2">
          <h4 id="research-task-activity" className="text-sm font-medium">
            Activity
          </h4>
          {events.length === 0 && !eventsLoading ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No activity was recorded for this run.
            </p>
          ) : (
            <ol className="space-y-2">
              {events.map((event) => (
                <li
                  key={`${event.executionGeneration}:${event.sequence}`}
                  className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground"
                >
                  <EventRow event={event.event} />
                </li>
              ))}
            </ol>
          )}
          {eventsLoading ? (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading activity...
            </p>
          ) : null}
          {canLoadMoreEvents ? (
            <Button
              size="sm"
              variant="outline"
              disabled={eventsLoading}
              onClick={() => void onLoadMoreEvents().catch(() => {})}
            >
              Load more
            </Button>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
