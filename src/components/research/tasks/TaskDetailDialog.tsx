import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
import { formatDateTime } from "@/lib/intl";
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
import { relativeTime, statusLabel } from "./task-status";
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
  return Number.isNaN(date.getTime()) ? "" : formatDateTime(date);
}

function isErrorMilestone(text: string, error: string | null): boolean {
  const value = text.trim();
  if (!value) return false;
  if (error && value === error.trim()) return true;
  return /^error\b/i.test(value);
}

function ReasoningRow({ text }: { text: string }) {
  const { t } = useTranslation(["common", "researchTools"]);
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
        {t(($) => $.researchTools.tasks.detail.reasoning)}
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
  const { t, i18n: instance } = useTranslation(["common", "researchTools"]);
  const language = instance.language;
  const tokenCount = (value: number | null): string =>
    value === null ? t(($) => $.researchTools.tasks.detail.unknownTokens) : formatCompactCount(value);
  const changeKindLabel = (kind: "added" | "modified" | "deleted"): string =>
    kind === "added"
      ? t(($) => $.researchTools.tasks.detail.changeAdded)
      : kind === "modified"
        ? t(($) => $.researchTools.tasks.detail.changeModified)
        : t(($) => $.researchTools.tasks.detail.changeDeleted);
  const taskRunKey = `${task.id}:${task.executionGeneration}`;
  const activeTaskRun = useRef(taskRunKey);
  activeTaskRun.current = taskRunKey;
  const running = task.status === "running";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the timeline carries translated milestone text, so it is rebuilt on a language switch
  const timeline = useMemo(() => buildTaskTimeline(events, running), [events, running, language]);
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
                  <TaskAgentChip task={task} agentName={agentName} showAgent className="max-w-[22rem]" />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {relativeTime(task.updatedAt)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {task.status === "queued" ? (
                  <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
                      {t(($) => $.common.actions.edit)}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || task.startRequested}
                      onClick={() => void onStart().catch(() => {})}
                    >
                      {task.startRequested
                        ? t(($) => $.researchTools.tasks.detail.waiting)
                        : blocked
                          ? t(($) => $.researchTools.tasks.detail.startWhenReady)
                          : t(($) => $.researchTools.tasks.detail.start)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onCancel().catch(() => {})}
                    >
                      {t(($) => $.common.actions.cancel)}
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
                    {task.cancelRequested
                      ? t(($) => $.researchTools.tasks.detail.stopping)
                      : t(($) => $.researchTools.tasks.detail.stopTask)}
                  </Button>
                ) : null}
                {task.status === "failed" || task.status === "cancelled" ? (
                  <Button size="sm" disabled={busy} onClick={() => void onRetry().catch(() => {})}>
                    {t(($) => $.common.actions.retry)}
                  </Button>
                ) : null}
                {task.runtimeId === "acp" && task.nativeSessionId && onOpenSession ? (
                  <Button size="sm" variant="outline" onClick={() => onOpenSession(task)}>
                    {t(($) => $.researchTools.tasks.detail.openSession)}
                    <ExternalLink />
                  </Button>
                ) : null}
                {!running ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t(($) => $.researchTools.tasks.detail.deleteAria, {
                      title: task.title,
                    })}
                    disabled={busy}
                    onClick={onDelete}
                  >
                    <Trash2 /> {t(($) => $.common.actions.delete)}
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
                <p className="text-sm font-medium text-destructive">
                  {t(($) => $.researchTools.tasks.detail.needsAttention)}
                </p>
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
                    {t(($) => $.researchTools.tasks.detail.dismiss)}
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
                {t(($) => $.researchTools.tasks.detail.tabActivity)}
              </TabsTrigger>
              <TabsTrigger value="review" className="shrink-0">
                {t(($) => $.researchTools.tasks.detail.tabReview)}
              </TabsTrigger>
              <TabsTrigger value="output" className="shrink-0">
                {t(($) => $.researchTools.tasks.detail.tabOutput)}
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
                    {t(($) => $.researchTools.tasks.detail.dependencies)}
                  </h4>
                  <ul className="mt-2 space-y-1 text-sm">
                    {dependencies.map((dependency) => (
                      <li key={dependency.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">{dependency.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {dependency.status
                            ? statusLabel(dependency.status)
                            : t(($) => $.researchTools.tasks.detail.dependencyUnavailable)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section aria-labelledby="research-task-activity" className="min-w-0">
                <h4 id="research-task-activity" className="sr-only">
                  {t(($) => $.researchTools.tasks.detail.tabActivity)}
                </h4>
                {timeline.items.length === 0 && !eventsLoading ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    {task.executionGeneration > 0
                      ? t(($) => $.researchTools.tasks.detail.noActivity)
                      : t(($) => $.researchTools.tasks.detail.startToRecord)}
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
                                      ? t(($) => $.researchTools.tasks.detail.loading)
                                      : t(($) => $.researchTools.tasks.detail.savedArtifact, {
                                          label: item.artifact.label,
                                        })}
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
                    <Loader2 className="size-3 animate-spin" />{" "}
                    {t(($) => $.researchTools.tasks.detail.loadingActivity)}
                  </p>
                ) : null}
              </section>
            </TabsContent>

            <TabsContent value="review" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {task.sourceRevision ? (
                <section className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="break-all">
                    <Trans
                      ns="researchTools"
                      i18nKey={($) => $.researchTools.tasks.detail.sourceRevision}
                      values={{
                        isolation:
                          task.isolation?.kind === "git_worktree"
                            ? t(($) => $.researchTools.tasks.detail.isolationWorktree)
                            : t(($) => $.researchTools.tasks.detail.isolationStaged),
                        revision: task.sourceRevision.slice(0, 28),
                      }}
                      components={{ revision: <span className="font-mono" /> }}
                    />
                  </p>
                  <p className="mt-1">
                    {t(($) => $.researchTools.tasks.detail.originalUnchanged)}
                  </p>
                </section>
              ) : null}

              {changedFiles.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="flex items-center gap-2 text-sm font-medium">
                      <FileDiff className="size-4" />
                      {t(($) => $.researchTools.tasks.detail.fileChanges)}
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
                        ? t(($) => $.researchTools.tasks.detail.clearSelection)
                        : t(($) => $.researchTools.tasks.detail.selectAll)}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(($) => $.researchTools.tasks.detail.previewBeforeApply)}
                  </p>
                  {driftedPaths.length > 0 ? (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                    >
                      <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                      <span className="min-w-0 break-words">
                        {driftedPaths.length === 1
                          ? t(($) => $.researchTools.tasks.detail.driftedOne, {
                              path: driftedPaths[0],
                            })
                          : t(($) => $.researchTools.tasks.detail.driftedMany, {
                              fileCount: driftedPaths.length,
                            })}
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
                              aria-label={t(($) => $.researchTools.tasks.detail.applyAria, {
                                path: change.path,
                              })}
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
                                {t(($) => $.researchTools.tasks.detail.changedSince)}
                              </Badge>
                            ) : null}
                            <span className="text-xs capitalize text-muted-foreground">
                              {changeKindLabel(change.kind)}
                            </span>
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={previewingPath === change.path}
                              onClick={() => void previewFile(change.path)}
                            >
                              {previewingPath === change.path
                                ? t(($) => $.researchTools.tasks.detail.loading)
                                : preview
                                  ? t(($) => $.researchTools.tasks.detail.refreshPreview)
                                  : t(($) => $.researchTools.tasks.detail.preview)}
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
                                    {preview.before.exists
                                      ? t(($) => $.researchTools.tasks.detail.beforeBytes, {
                                          size: preview.before.size,
                                        })
                                      : t(($) => $.researchTools.tasks.detail.beforeAbsent)}
                                  </div>
                                  <div className="p-3">
                                    {preview.after.exists
                                      ? t(($) => $.researchTools.tasks.detail.afterBytes, {
                                          size: preview.after.size,
                                        })
                                      : t(($) => $.researchTools.tasks.detail.afterAbsent)}
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
                        {t(($) => $.researchTools.tasks.detail.discardChanges)}
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          selectedPaths.length === 0 ||
                          selectedPaths.some((path) => !filePreviews[`${taskRunKey}:${path}`])
                        }
                        onClick={() => void onApply(selectedPaths).catch(() => {})}
                      >
                        {busy
                          ? t(($) => $.researchTools.tasks.detail.applying)
                          : t(($) => $.researchTools.tasks.detail.applySelected, {
                              selected: selectedPaths.length,
                            })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : task.status === "awaiting_review" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                  <p className="text-sm text-muted-foreground">
                    {t(($) => $.researchTools.tasks.detail.noFilesChanged)}
                  </p>
                  <Button disabled={busy} onClick={() => void onAccept().catch(() => {})}>
                    {t(($) => $.researchTools.tasks.detail.markReviewed)}
                  </Button>
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  {t(($) => $.researchTools.tasks.detail.nothingToReview)}
                </p>
              )}
            </TabsContent>

            <TabsContent value="output" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {task.result ? (
                <section aria-labelledby="research-task-result" className="space-y-3">
                  <div className="min-w-0">
                    <h4 id="research-task-result" className="text-sm font-medium">
                      {t(($) => $.researchTools.tasks.detail.result)}
                    </h4>
                    <div className="mt-1 min-w-0 break-words text-sm text-muted-foreground">
                      <Markdown className="min-w-0 break-words">
                        {task.result.summary || t(($) => $.researchTools.tasks.detail.noSummary)}
                      </Markdown>
                    </div>
                  </div>
                </section>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  {t(($) => $.researchTools.tasks.detail.noResult)}
                </p>
              )}

              {artifacts.length > 0 ? (
                <div className="space-y-2">
                  <h5 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(($) => $.researchTools.tasks.detail.artifacts)}
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
                        {previewingPath === artifact.path
                          ? t(($) => $.researchTools.tasks.detail.loading)
                          : artifact.label}
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
                          {t(($) => $.researchTools.tasks.detail.binaryArtifact, {
                            size: artifactPreview.content.size ?? 0,
                          })}
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
                ? t(($) => $.researchTools.tasks.detail.noTokenUsage)
                : t(($) => $.researchTools.tasks.detail.tokenUsage, {
                    input: tokenCount(usage.inputTokens),
                    output: tokenCount(usage.outputTokens),
                  })}
            </p>
            {canLoadMoreEvents ? (
              <Button
                size="xs"
                variant="outline"
                disabled={eventsLoading}
                onClick={() => void onLoadMoreEvents().catch(() => {})}
              >
                {t(($) => $.researchTools.tasks.detail.loadMore)}
              </Button>
            ) : null}
          </footer>
        </article>
      </DialogContent>
    </Dialog>
  );
}
