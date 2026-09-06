import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  FileDiff,
  Loader2,
  Paperclip,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompactCount } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import { ResearchToolCard } from "@/components/ai/activity/ResearchToolCard";
import {
  previewResearchTaskArtifact,
  previewResearchTaskFile,
} from "@/lib/research-tasks";
import type {
  ResearchTask,
  TaskArtifact,
  TaskArtifactPreview,
  TaskFilePreview,
  TaskTranscriptEvent,
} from "@/lib/research-tasks";
import type { ResearchTaskDetailTab } from "@/store/research-tasks";
import { relativeTime, STATUS_LABELS } from "./task-status";
import { TaskAgentChip, TaskStatusBadge } from "./TaskChips";
import { buildTaskTimeline, type TaskTimelineItem } from "./task-timeline";

export interface TaskDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ResearchTask;
  tasks: ResearchTask[];
  events: TaskTranscriptEvent[];
  eventsLoading: boolean;
  canLoadMoreEvents: boolean;
  busy: boolean;
  agentName?: string;
  initialTab?: ResearchTaskDetailTab | null;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
  onEdit: () => void;
  onApply: (paths: string[]) => Promise<void>;
  onAccept: () => Promise<void>;
  onDelete: () => void;
  onLoadMoreEvents: () => Promise<void>;
  onOpenSession?: (task: ResearchTask) => void;
  error?: string | null;
  onDismissError?: () => void;
}

const EMPTY_CHANGES: NonNullable<ResearchTask["result"]>["changedFiles"] = [];

function timestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function tokenCount(value: number | null): string {
  return value === null ? "unknown" : formatCompactCount(value);
}

function isErrorMilestone(text: string, error: string | null): boolean {
  const value = text.trim();
  if (!value) return false;
  if (error && value === error.trim()) return true;
  return /^error\b/i.test(value);
}

function ReasoningRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 text-xs text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-6 items-center gap-1 text-left hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        Reported reasoning
      </button>
      {open ? (
        <p className="mb-1 whitespace-pre-wrap break-words leading-relaxed">{text}</p>
      ) : null}
    </div>
  );
}

function TimelineDot({
  item,
  live,
  tall,
  failing,
}: {
  item: TaskTimelineItem;
  live: boolean;
  tall: boolean;
  failing: boolean;
}) {
  const label = timestamp(item.createdAt);
  const cell = cn("flex items-center justify-center", tall ? "h-9" : "h-6");
  const dot = failing ? (
    <AlertCircle aria-hidden="true" className="size-3.5 text-destructive" />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 rounded-full",
        live
          ? "animate-pulse bg-primary motion-reduce:animate-none"
          : item.kind === "message"
            ? "bg-primary"
            : item.kind === "tool"
              ? "bg-foreground/40"
              : "bg-muted-foreground/40",
      )}
    />
  );
  if (!label) return <span className={cell}>{dot}</span>;
  return (
    <Tooltip label={label} side="right" className={cell}>
      {dot}
    </Tooltip>
  );
}

export function TaskDetailDialog({
  open,
  onOpenChange,
  task,
  tasks,
  events,
  eventsLoading,
  canLoadMoreEvents,
  busy,
  agentName,
  initialTab,
  onStart,
  onCancel,
  onRetry,
  onEdit,
  onApply,
  onAccept,
  onDelete,
  onLoadMoreEvents,
  onOpenSession,
  error,
  onDismissError,
}: TaskDetailDialogProps) {
  const taskRunKey = `${task.id}:${task.executionGeneration}`;
  const activeTaskRun = useRef(taskRunKey);
  activeTaskRun.current = taskRunKey;
  const running = task.status === "running";
  const timeline = useMemo(() => buildTaskTimeline(events, running), [events, running]);
  const changedFiles = task.result?.changedFiles ?? EMPTY_CHANGES;
  const changedPathsKey = changedFiles.map((change) => change.path).join("\n");
  const [selectedPaths, setSelectedPaths] = useState<string[]>(() =>
    changedFiles.map((change) => change.path),
  );
  const [filePreviews, setFilePreviews] = useState<Record<string, TaskFilePreview>>({});
  const [previewingPath, setPreviewingPath] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<TaskArtifactPreview | null>(null);
  const [chosenTab, setChosenTab] = useState<string | null>(initialTab ?? null);
  const activityRef = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);

  useEffect(() => {
    setSelectedPaths(changedPathsKey ? changedPathsKey.split("\n") : []);
  }, [changedPathsKey]);

  useEffect(() => {
    if (initialTab) setChosenTab(initialTab);
  }, [initialTab]);

  const autoTab =
    task.status === "awaiting_review"
      ? "review"
      : task.status === "queued" || task.status === "running"
        ? "activity"
        : task.result
          ? "output"
          : "activity";
  const tab = chosenTab ?? autoTab;
  const timelineCount = timeline.items.length;

  useEffect(() => {
    void timelineCount;
    if (!open || tab !== "activity" || !running) return;
    const container = activityRef.current;
    if (!container || !nearBottom.current) return;
    container.scrollTop = container.scrollHeight;
  }, [open, tab, running, timelineCount]);

  const previewFile = async (path: string) => {
    const requestRunKey = taskRunKey;
    const previewKey = `${requestRunKey}:${path}`;
    setPreviewingPath(path);
    setPreviewError(null);
    try {
      const preview = await previewResearchTaskFile(task.id, path);
      if (activeTaskRun.current !== requestRunKey) return;
      setFilePreviews((current) => ({ ...current, [previewKey]: preview }));
      if (preview.baseIsCurrent === false) {
        setSelectedPaths((current) => current.filter((candidate) => candidate !== path));
      }
    } catch (failure) {
      if (activeTaskRun.current !== requestRunKey) return;
      setPreviewError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (activeTaskRun.current === requestRunKey) setPreviewingPath(null);
    }
  };

  const previewArtifact = async (artifact: TaskArtifact) => {
    const requestRunKey = taskRunKey;
    setPreviewingPath(artifact.path);
    setPreviewError(null);
    try {
      const preview = await previewResearchTaskArtifact(task.id, artifact.path);
      if (activeTaskRun.current !== requestRunKey) return;
      setArtifactPreview(preview);
    } catch (failure) {
      if (activeTaskRun.current !== requestRunKey) return;
      setPreviewError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (activeTaskRun.current === requestRunKey) setPreviewingPath(null);
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
  const driftedPaths = changedFiles
    .map((change) => change.path)
    .filter((path) => filePreviews[`${taskRunKey}:${path}`]?.baseIsCurrent === false);
  const usage = {
    inputTokens: timeline.usage.inputTokens ?? task.result?.inputTokens ?? null,
    outputTokens: timeline.usage.outputTokens ?? task.result?.outputTokens ?? null,
  };
  const artifacts = task.result?.artifacts ?? [];

  const openArtifact = (artifact: TaskArtifact) => {
    setChosenTab("output");
    void previewArtifact(artifact);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="research-task-detail"
        className="flex h-[min(92vh,980px)] w-[min(96vw,1180px)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <article
          aria-labelledby="research-task-detail-title"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <header className="shrink-0 space-y-3 border-b px-5 py-4 pr-14">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 basis-64">
                <DialogTitle
                  id="research-task-detail-title"
                  className="break-words text-base font-semibold"
                >
                  {task.title}
                </DialogTitle>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                  <TaskStatusBadge status={task.status} />
                  <TaskAgentChip task={task} agentName={agentName} className="max-w-[22rem]" />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {relativeTime(task.updatedAt)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
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
                {running ? (
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
                {task.runtimeId === "acp" && task.nativeSessionId && onOpenSession ? (
                  <Button size="sm" variant="outline" onClick={() => onOpenSession(task)}>
                    Open session
                    <ExternalLink />
                  </Button>
                ) : null}
                {!running ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${task.title}`}
                    disabled={busy}
                    onClick={onDelete}
                  >
                    <Trash2 /> Delete
                  </Button>
                ) : null}
              </div>
            </div>
            <DialogDescription className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {task.prompt}
            </DialogDescription>
            {task.error ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
              >
                <p className="text-sm font-medium text-destructive">This task needs attention</p>
                <p className="mt-1 break-words text-sm text-foreground">{task.error}</p>
              </div>
            ) : null}
            {error ? (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
              >
                <div className="flex min-w-0 items-start gap-2 text-sm">
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <p className="min-w-0 break-words">{error}</p>
                </div>
                {onDismissError ? (
                  <Button size="xs" variant="ghost" onClick={onDismissError}>
                    Dismiss
                  </Button>
                ) : null}
              </div>
            ) : null}
          </header>

          <Tabs
            value={tab}
            onValueChange={setChosenTab}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <TabsList className="mx-5 mt-3 flex h-auto w-fit max-w-full shrink-0 justify-start gap-1 self-start overflow-x-auto no-scrollbar">
              <TabsTrigger value="activity" className="shrink-0">
                Activity
              </TabsTrigger>
              <TabsTrigger value="review" className="shrink-0">
                Review
              </TabsTrigger>
              <TabsTrigger value="output" className="shrink-0">
                Output
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="activity"
              ref={activityRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                nearBottom.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 100;
              }}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
            >
              {dependencies.length > 0 ? (
                <section aria-labelledby="research-task-dependencies" className="mb-4">
                  <h4 id="research-task-dependencies" className="text-sm font-medium">
                    Dependencies
                  </h4>
                  <ul className="mt-2 space-y-1 text-sm">
                    {dependencies.map((dependency) => (
                      <li key={dependency.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">{dependency.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {dependency.status ? STATUS_LABELS[dependency.status] : "Unavailable"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section aria-labelledby="research-task-activity" className="min-w-0">
                <h4 id="research-task-activity" className="sr-only">
                  Activity
                </h4>
                {timeline.items.length === 0 && !eventsLoading ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    {task.executionGeneration > 0
                      ? "No activity was recorded for this run."
                      : "Start this task to record its activity."}
                  </p>
                ) : (
                  <div className="relative min-w-0">
                    <span
                      aria-hidden="true"
                      className="absolute bottom-3 left-[0.625rem] top-3 w-px bg-border"
                    />
                    <ol className="relative min-w-0 space-y-3">
                      {timeline.items.map((item, index) => {
                        const failing =
                          item.kind === "milestone" && isErrorMilestone(item.text, task.error);
                        return (
                          <li
                            key={item.key}
                            className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3"
                          >
                            <TimelineDot
                              item={item}
                              live={running && index === timeline.items.length - 1}
                              tall={item.kind === "tool"}
                              failing={failing}
                            />
                            <div className="min-w-0">
                              {item.kind === "milestone" ? (
                                <p
                                  className={cn(
                                    "break-words text-xs leading-6",
                                    failing ? "text-destructive" : "text-muted-foreground",
                                  )}
                                >
                                  {item.text}
                                </p>
                              ) : null}
                              {item.kind === "message" ? (
                                <Markdown className="min-w-0 break-words text-sm leading-6">
                                  {item.text}
                                </Markdown>
                              ) : null}
                              {item.kind === "reasoning" ? <ReasoningRow text={item.text} /> : null}
                              {item.kind === "tool" ? (
                                <div className="min-w-0 [&>div]:max-w-full">
                                  <ResearchToolCard
                                    tc={item.tool}
                                    expansionKey={`research-task:${taskRunKey}:${item.tool.id}`}
                                  />
                                </div>
                              ) : null}
                              {item.kind === "artifact" ? (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="max-w-full gap-1.5"
                                  disabled={previewingPath === item.artifact.path}
                                  onClick={() => openArtifact(item.artifact)}
                                >
                                  <Paperclip aria-hidden="true" />
                                  <span className="min-w-0 truncate">
                                    {previewingPath === item.artifact.path
                                      ? "Loading..."
                                      : `Saved ${item.artifact.label}`}
                                  </span>
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
                {eventsLoading ? (
                  <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Loading activity...
                  </p>
                ) : null}
              </section>
            </TabsContent>

            <TabsContent value="review" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {task.sourceRevision ? (
                <section className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="break-all">
                    {task.isolation?.kind === "git_worktree" ? "Git worktree" : "Staged copy"} ·
                    source <span className="font-mono">{task.sourceRevision.slice(0, 28)}</span>
                  </p>
                  <p className="mt-1">
                    The original project stays unchanged until you apply reviewed files.
                  </p>
                </section>
              ) : null}

              {changedFiles.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
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
                            : changedFiles
                                .map((change) => change.path)
                                .filter((path) => !driftedPaths.includes(path)),
                        )
                      }
                    >
                      {selectedPaths.length === changedFiles.length
                        ? "Clear selection"
                        : "Select all"}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Preview every selected file before applying it.
                  </p>
                  {driftedPaths.length > 0 ? (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                    >
                      <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                      <span className="min-w-0 break-words">
                        {driftedPaths.length === 1
                          ? `${driftedPaths[0]} changed in your project after this task started. Its diff is against the older version, so it cannot be applied.`
                          : `${driftedPaths.length} files changed in your project after this task started. Their diffs are against the older versions, so they cannot be applied.`}
                      </span>
                    </p>
                  ) : null}
                  <div className="divide-y rounded-md border">
                    {changedFiles.map((change) => {
                      const preview = filePreviews[`${taskRunKey}:${change.path}`];
                      const drifted = preview?.baseIsCurrent === false;
                      return (
                        <div key={change.path} className="p-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                            <Checkbox
                              aria-label={`Apply ${change.path}`}
                              checked={selectedPaths.includes(change.path)}
                              disabled={task.status !== "awaiting_review" || busy || drifted}
                              onCheckedChange={(checked) =>
                                setSelectedPaths((current) =>
                                  checked === true
                                    ? [...current, change.path]
                                    : current.filter((path) => path !== change.path),
                                )
                              }
                            />
                            <Tooltip label={change.path} className="min-w-0 flex-1">
                              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                {change.path}
                              </span>
                            </Tooltip>
                            {drifted ? (
                              <Badge
                                variant="outline"
                                className="shrink-0 gap-1 border-amber-500/50"
                              >
                                <AlertTriangle aria-hidden="true" className="size-3" />
                                Changed since
                              </Badge>
                            ) : null}
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
                                    Before:{" "}
                                    {preview.before.exists
                                      ? `${preview.before.size} bytes`
                                      : "absent"}
                                  </div>
                                  <div className="p-3">
                                    After:{" "}
                                    {preview.after.exists ? `${preview.after.size} bytes` : "absent"}
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
                    <p role="alert" className="break-words text-xs text-destructive">
                      {previewError}
                    </p>
                  ) : null}
                  {task.status === "awaiting_review" ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void onCancel().catch(() => {})}
                      >
                        Discard changes
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          selectedPaths.length === 0 ||
                          selectedPaths.some((path) => !filePreviews[`${taskRunKey}:${path}`])
                        }
                        onClick={() => void onApply(selectedPaths).catch(() => {})}
                      >
                        {busy ? "Applying..." : `Apply ${selectedPaths.length} selected`}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : task.status === "awaiting_review" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                  <p className="text-sm text-muted-foreground">No project files changed.</p>
                  <Button disabled={busy} onClick={() => void onAccept().catch(() => {})}>
                    Mark reviewed
                  </Button>
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  This task has nothing waiting for review.
                </p>
              )}
            </TabsContent>

            <TabsContent value="output" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {task.result ? (
                <section aria-labelledby="research-task-result" className="space-y-3">
                  <div className="min-w-0">
                    <h4 id="research-task-result" className="text-sm font-medium">
                      Result
                    </h4>
                    <div className="mt-1 min-w-0 break-words text-sm text-muted-foreground">
                      <Markdown className="min-w-0 break-words">
                        {task.result.summary || "The task finished without a written summary."}
                      </Markdown>
                    </div>
                  </div>
                </section>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  This task has not produced a result yet.
                </p>
              )}

              {artifacts.length > 0 ? (
                <div className="space-y-2">
                  <h5 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Artifacts
                  </h5>
                  {artifacts.map((artifact) => (
                    <button
                      key={`${artifact.path}:${artifact.label}`}
                      type="button"
                      disabled={previewingPath === artifact.path}
                      onClick={() => void previewArtifact(artifact)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-70"
                    >
                      <span className="min-w-0 truncate">
                        {previewingPath === artifact.path ? "Loading..." : artifact.label}
                      </span>
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                        {artifact.path}
                      </span>
                    </button>
                  ))}
                  {artifactPreview ? (
                    <div className="min-w-0 rounded-md border bg-muted/30 p-3">
                      <p className="truncate text-sm font-medium">
                        {artifactPreview.artifact.label}
                      </p>
                      {artifactPreview.content.text !== null ? (
                        <pre className="mt-2 max-h-80 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all text-xs">
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
                          Binary file · {artifactPreview.content.size ?? 0} bytes. Apply it to your
                          project to open it.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {previewError ? (
                    <p role="alert" className="break-words text-xs text-destructive">
                      {previewError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </TabsContent>
          </Tabs>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-2.5">
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {usage.inputTokens === null && usage.outputTokens === null
                ? "No token usage reported."
                : `Input ${tokenCount(usage.inputTokens)}, output ${tokenCount(usage.outputTokens)}`}
            </p>
            {canLoadMoreEvents ? (
              <Button
                size="xs"
                variant="outline"
                disabled={eventsLoading}
                onClick={() => void onLoadMoreEvents().catch(() => {})}
              >
                Load more activity
              </Button>
            ) : null}
          </footer>
        </article>
      </DialogContent>
    </Dialog>
  );
}
