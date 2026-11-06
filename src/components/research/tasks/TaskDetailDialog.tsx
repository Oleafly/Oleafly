import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, ChevronRight, ExternalLink } from "lucide-react";
import { FileDiff, GitMerge, Paperclip, Trash2 } from "@/components/icons/pack";
import { cn } from "@/lib/utils";
import { formatCompactCount } from "@/lib/format";
import { formatDateTime, formatNumber } from "@/lib/intl";
import { describeError } from "@/lib/app-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/ui/markdown";
import { SECTION_HEADING_CLASS } from "@/components/ui/section-heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { InlineDiffPreview } from "@/components/editor/diff/InlineDiffPreview";
import { ResearchToolCard } from "@/components/ai/activity/ResearchToolCard";
import {
  loadResearchTaskEventsBefore,
  NEWEST_EVENTS,
  previewResearchTaskArtifact,
  previewResearchTaskFile,
  progressResearchTask,
  setResearchTaskKeepRunning,
} from "@/lib/research-tasks";
import { getConfig } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import type {
  ResearchTask,
  RetryMode,
  RunRecord,
  StopReason,
  TaskArtifact,
  TaskArtifactPreview,
  TaskFileChange,
  TaskFilePreview,
  TaskPreviewContent,
  TaskTranscriptEvent,
} from "@/lib/research-tasks";
import { i18n } from "@/i18n";
import type { ResearchTaskDetailTab } from "@/store/research-tasks";
import { phaseLabel, relativeTime, statusLabel } from "./task-status";
import { TaskAgentChip, TaskOwnerBadge, TaskStatusBadge } from "./TaskChips";
import {
  buildTaskTimeline,
  buildTaskTimelineIncremental,
  latestTimelineUsage,
  type TaskTimeline,
  type TaskTimelineCache,
  type TaskTimelineItem,
} from "./task-timeline";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { PendingApprovals } from "./PendingApprovals";
import { PlanReview } from "./PlanReview";

const TaskProgressTab = lazy(() =>
  import("./progress/TaskProgressTab").then((module) => ({ default: module.TaskProgressTab })),
);
const EvidenceChecklist = lazy(() =>
  import("./evidence/EvidenceChecklist").then((module) => ({ default: module.EvidenceChecklist })),
);

function stopReasonText(reason: StopReason): string {
  switch (reason) {
    case "budget_time":
      return i18n.t(($) => $.researchTools.tasks.detail.stopReason.budgetTime);
    case "budget_cost":
      return i18n.t(($) => $.researchTools.tasks.detail.stopReason.budgetCost);
    case "budget_runs":
      return i18n.t(($) => $.researchTools.tasks.detail.stopReason.budgetRuns);
  }
}

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
  onRetry: (mode?: RetryMode) => Promise<void>;
  onApprovePlan?: (editedPlan?: string) => Promise<void>;
  onRefreshEvidence?: () => Promise<void>;
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

const EARLIER_PAGES = 10;
const EARLIER_PAGE_SIZE = 200;

interface EarlierGeneration {
  generation: number;
  events: TaskTranscriptEvent[];
  truncated: boolean;
  resumedFrom: number | null;
}

const NO_TIMELINE: TaskTimeline = { items: [], usage: { inputTokens: null, outputTokens: null } };

const SHOWN_ITEMS = 200;

function itemSize(item: TaskTimelineItem | undefined): number {
  if (!item) return 0;
  if (item.kind === "tool") return (item.tool.input?.length ?? 0) + (item.tool.output?.length ?? 0);
  return "text" in item ? item.text.length : 0;
}

function undiffable(side: TaskPreviewContent): boolean {
  return side.exists && (side.truncated || side.binary || side.text === null);
}

function waitingDependents(taskId: string, tasks: readonly ResearchTask[]): ResearchTask[] {
  const failing: ResearchTask[] = [];
  const seen = new Set([taskId]);
  const pending = [taskId];
  while (pending.length > 0) {
    const stopped = pending.pop();
    for (const candidate of tasks) {
      if (
        stopped !== undefined &&
        !seen.has(candidate.id) &&
        candidate.status === "queued" &&
        candidate.startRequested &&
        candidate.dependencyIds.includes(stopped)
      ) {
        seen.add(candidate.id);
        failing.push(candidate);
        pending.push(candidate.id);
      }
    }
  }
  return failing;
}

type StopAction = "stop" | "cancel" | "discard";

function timestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : formatDateTime(date);
}

function changedSinceStart(preview: TaskFilePreview | undefined): boolean {
  return preview?.baseIsCurrent === false;
}

function blocksApply(preview: TaskFilePreview | undefined): boolean {
  return changedSinceStart(preview) && preview?.mergesWithShared !== true;
}

function PreviewSizes({ preview }: Readonly<{ preview: TaskFilePreview }>) {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <>
      {preview.before.truncated || preview.after.truncated ? (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground" data-testid="research-task-preview-too-large">
          {t(($) => $.researchTools.tasks.detail.tooLargeToDiff)}
        </p>
      ) : null}
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
    </>
  );
}

function FilePreviewBody({ preview }: Readonly<{ preview: TaskFilePreview }>) {
  return (
    <div className="mt-3 overflow-hidden rounded-md border">
      {(preview.before.text !== null || preview.after.text !== null) &&
      !undiffable(preview.before) &&
      !undiffable(preview.after) ? (
        <InlineDiffPreview
          path={preview.path}
          oldText={preview.before.text ?? ""}
          newText={preview.after.text ?? ""}
        />
      ) : (
        <PreviewSizes preview={preview} />
      )}
    </div>
  );
}

function isErrorMilestone(text: string, error: string | null): boolean {
  const value = text.trim();
  if (!value) return false;
  if (value === error?.trim()) return true;
  return /^error\b/i.test(value);
}

function ReasoningRow({ text }: Readonly<{ text: string }>) {
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
        <p className="mb-1 select-text whitespace-pre-wrap break-words leading-relaxed">{text}</p>
      ) : null}
    </div>
  );
}

function autoTabFor(task: ResearchTask): string {
  if (task.status === "awaiting_review" || task.status === "plan_ready") return "review";
  if (task.status === "queued" || task.status === "running") return "activity";
  if (task.result) return "output";
  return "activity";
}

function timelineDotTone(kind: TaskTimelineItem["kind"]): string {
  if (kind === "message") return "bg-primary";
  if (kind === "tool") return "bg-foreground/40";
  return "bg-muted-foreground/40";
}

function TimelineDot({
  item,
  live,
  tall,
  failing,
}: Readonly<{
  item: TaskTimelineItem;
  live: boolean;
  tall: boolean;
  failing: boolean;
}>) {
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
          : timelineDotTone(item.kind),
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

function shallowEqual(left: object, right: object): boolean {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameTimelineItem(left: TaskTimelineItem, right: TaskTimelineItem): boolean {
  if (left.key !== right.key || left.createdAt !== right.createdAt) return false;
  if (left.kind === "tool") return right.kind === "tool" && shallowEqual(left.tool, right.tool);
  if (left.kind === "artifact") return right.kind === "artifact" && shallowEqual(left.artifact, right.artifact);
  return right.kind === left.kind && "text" in right && left.text === right.text;
}

interface TimelineRowProps {
  item: TaskTimelineItem;
  live: boolean;
  failing: boolean;
  runKey: string;
  loadingArtifact: boolean;
  onOpenArtifact: (artifact: TaskArtifact) => void;
}

const TimelineRow = memo(
  function TimelineRow({ item, live, failing, runKey, loadingArtifact, onOpenArtifact }: Readonly<TimelineRowProps>) {
    const { t } = useTranslation(["common", "researchTools"]);
    return (
      <li className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
        <TimelineDot item={item} live={live} tall={item.kind === "tool"} failing={failing} />
        <div className="min-w-0">
          {item.kind === "milestone" ? (
            <p className={cn("break-words text-xs leading-6", failing ? "text-destructive" : "text-muted-foreground")}>
              {item.text}
            </p>
          ) : null}
          {item.kind === "message" ? (
            <Markdown className="min-w-0 break-words text-sm leading-6" streaming={live}>
              {item.text}
            </Markdown>
          ) : null}
          {item.kind === "reasoning" ? <ReasoningRow text={item.text} /> : null}
          {item.kind === "tool" ? (
            <div className="min-w-0 [&>div]:max-w-full">
              <ResearchToolCard tc={item.tool} expansionKey={`research-task:${runKey}:${item.tool.id}`} />
            </div>
          ) : null}
          {item.kind === "artifact" ? (
            <Button
              size="xs"
              variant="outline"
              className="max-w-full gap-1.5"
              disabled={loadingArtifact}
              onClick={() => onOpenArtifact(item.artifact)}
            >
              <Paperclip aria-hidden="true" />
              <span className="min-w-0 truncate">
                {loadingArtifact
                  ? t(($) => $.researchTools.tasks.detail.loading)
                  : t(($) => $.researchTools.tasks.detail.savedArtifact, { label: item.artifact.label })}
              </span>
            </Button>
          ) : null}
        </div>
      </li>
    );
  },
  (previous, next) =>
    previous.live === next.live &&
    previous.failing === next.failing &&
    previous.runKey === next.runKey &&
    previous.loadingArtifact === next.loadingArtifact &&
    previous.onOpenArtifact === next.onOpenArtifact &&
    sameTimelineItem(previous.item, next.item),
);

interface TimelineListProps {
  items: TaskTimelineItem[];
  live: boolean;
  runKey: string;
  taskError: string | null;
  previewingPath: string | null;
  onOpenArtifact: (artifact: TaskArtifact) => void;
}

type TimelineListShared = Omit<TimelineListProps, "items" | "live">;

function TimelineList({ items, live, runKey, taskError, previewingPath, onOpenArtifact }: Readonly<TimelineListProps>) {
  return (
    <div className="relative min-w-0">
      <span
        aria-hidden="true"
        className="absolute bottom-3 left-[0.625rem] top-3 w-px bg-border"
      />
      <ol className="relative min-w-0 space-y-3">
        {items.map((item, index) => (
          <TimelineRow
            key={item.key}
            item={item}
            live={live && index === items.length - 1}
            failing={item.kind === "milestone" && isErrorMilestone(item.text, taskError)}
            runKey={runKey}
            loadingArtifact={item.kind === "artifact" && previewingPath === item.artifact.path}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
      </ol>
    </div>
  );
}

function TaskStatusNotes({ task, running }: Readonly<{ task: ResearchTask; running: boolean }>) {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <>
      {running && task.phase ? (
        <p className="mt-1.5 text-xs text-muted-foreground" data-testid="research-task-phase">
          {phaseLabel(task.phase)}
        </p>
      ) : null}
      {task.status === "queued" && task.runAfter ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t(($) => $.researchTools.tasks.detail.startsAt, {
            time: formatDateTime(new Date(task.runAfter)),
          })}
        </p>
      ) : null}
      {task.stopReason && !running ? (
        <p className="mt-1.5 text-xs text-muted-foreground" data-testid="research-task-stop-reason">
          {stopReasonText(task.stopReason)}
        </p>
      ) : null}
    </>
  );
}

interface KeepRunningToggleProps {
  task: ResearchTask;
  busy: boolean;
  saving: boolean;
  unfinished: boolean;
  backgroundEnabled: boolean;
  desktopAppsKeepConflict: boolean;
  onToggle: (keep: boolean) => void;
}

function KeepRunningToggle({
  task,
  busy,
  saving,
  unfinished,
  backgroundEnabled,
  desktopAppsKeepConflict,
  onToggle,
}: Readonly<KeepRunningToggleProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const keeps = task.keepRunningAfterQuit === true && backgroundEnabled;
  return (
    <label
      htmlFor={`research-task-keep-running-${task.id}`}
      data-testid="research-task-keep-running"
      className="mt-2 flex items-start gap-2 text-xs"
    >
      <Checkbox
        id={`research-task-keep-running-${task.id}`}
        checked={keeps}
        disabled={busy || saving || !unfinished || !backgroundEnabled || desktopAppsKeepConflict}
        onCheckedChange={(next) => onToggle(next === true)}
      />
      <span>
        <span className="font-medium">{t(($) => $.researchTools.brief.keepRunning)}</span>
        {!backgroundEnabled ? (
          <span className="block text-muted-foreground">
            {t(($) => $.researchTools.brief.keepRunningHint)}
          </span>
        ) : null}
        {backgroundEnabled && unfinished && desktopAppsKeepConflict ? (
          <span className="block text-muted-foreground">
            {t(($) => $.researchTools.tasks.detail.keepRunningDesktopApps)}
          </span>
        ) : null}
      </span>
    </label>
  );
}

interface HeaderAlertsProps {
  task: ResearchTask;
  tasks: ResearchTask[];
  error?: string | null;
  onDismissError?: () => void;
}

function HeaderAlerts({ task, tasks, error, onDismissError }: Readonly<HeaderAlertsProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <>
      {task.pendingApprovals > 0 ? (
        <PendingApprovals projectId={task.projectId} tasks={tasks} taskId={task.id} />
      ) : null}
      {task.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm font-medium text-destructive">
            {t(($) => $.researchTools.tasks.detail.needsAttention)}
          </p>
          <p className="mt-1 select-text break-words text-sm text-foreground">{describeError(task.error)}</p>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <div className="flex min-w-0 items-start gap-2 text-sm">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="min-w-0 select-text break-words">{error}</p>
          </div>
          {onDismissError ? (
            <Button size="xs" variant="ghost" onClick={onDismissError}>
              {t(($) => $.researchTools.tasks.detail.dismiss)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

interface DependencyListProps {
  dependencies: ReadonlyArray<{ id: string; title: string; status: ResearchTask["status"] | null }>;
}

function DependencyList({ dependencies }: Readonly<DependencyListProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  if (dependencies.length === 0) return null;
  return (
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
  );
}

interface EarlierActivityProps {
  canShow: boolean;
  loading: boolean;
  timelines: Array<EarlierGeneration & { timeline: TaskTimeline }>;
  onShow: () => void;
  listProps: TimelineListShared;
}

function EarlierActivity({ canShow, loading, timelines, onShow, listProps }: Readonly<EarlierActivityProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  return (
    <>
      {canShow ? (
        <Button
          size="xs"
          variant="link"
          data-testid="research-task-earlier"
          className="mb-2 px-0"
          disabled={loading}
          onClick={onShow}
        >
          {t(($) => $.researchTools.backgroundHelper.earlierActivity)}
        </Button>
      ) : null}
      {timelines.length > 0 ? (
        <div data-testid="research-task-earlier-activity" className="mb-3 space-y-3 border-b pb-3">
          {timelines.map((entry) => (
            <div key={entry.generation}>
              {entry.timeline.items.length > 0 ? (
                <TimelineList items={entry.timeline.items} live={false} {...listProps} />
              ) : null}
              {entry.truncated ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t(($) => $.researchTools.backgroundHelper.earlierTruncated, {
                    limit: formatNumber(EARLIER_PAGES * EARLIER_PAGE_SIZE),
                  })}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

interface ActivityTimelineProps {
  timeline: TaskTimeline;
  shown: number;
  executionGeneration: number;
  running: boolean;
  loading: boolean;
  canLoadMore: boolean;
  onShowOlder: () => void;
  listProps: TimelineListShared;
}

function ActivityTimeline({
  timeline,
  shown,
  executionGeneration,
  running,
  loading,
  canLoadMore,
  onShowOlder,
  listProps,
}: Readonly<ActivityTimelineProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const items = timeline.items.length > shown ? timeline.items.slice(-shown) : timeline.items;
  const older = canLoadMore || items.length < timeline.items.length;
  const empty = timeline.items.length === 0 && !loading && !canLoadMore;
  return (
    <>
      {empty ? (
        <EmptyState
          size="compact"
          className="rounded-md border border-dashed p-3"
          description={
            executionGeneration > 0
              ? t(($) => $.researchTools.tasks.detail.noActivity)
              : t(($) => $.researchTools.tasks.detail.startToRecord)
          }
        />
      ) : null}
      {older ? (
        <div
          data-testid="research-task-activity-older"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
        >
          <span>{t(($) => $.researchTools.tasks.detail.olderActivity)}</span>
          <Button size="xs" variant="outline" disabled={loading} onClick={onShowOlder}>
            {t(($) => $.researchTools.tasks.detail.loadMore)}
          </Button>
        </div>
      ) : null}
      {items.length > 0 ? <TimelineList items={items} live={running} {...listProps} /> : null}
      {loading ? (
        <LoadingState
          size="compact"
          className="mt-3"
          label={t(($) => $.researchTools.tasks.detail.loadingActivity)}
        />
      ) : null}
    </>
  );
}

function TokenUsage({ usage }: Readonly<{ usage: { inputTokens: number | null; outputTokens: number | null } }>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const tokenCount = (value: number | null): string =>
    value === null ? t(($) => $.researchTools.tasks.detail.unknownTokens) : formatCompactCount(value);
  return (
    <p className="text-[0.6875rem] tabular-nums text-muted-foreground">
      {usage.inputTokens === null && usage.outputTokens === null
        ? t(($) => $.researchTools.tasks.detail.noTokenUsage)
        : t(($) => $.researchTools.tasks.detail.tokenUsage, {
            input: tokenCount(usage.inputTokens),
            output: tokenCount(usage.outputTokens),
          })}
    </p>
  );
}

interface StopConfirmationProps {
  action: StopAction | null;
  title: string;
  dependents: readonly ResearchTask[];
  runs: readonly RunRecord[];
  onConfirm: () => void;
  onCancel: () => void;
}

function StopConfirmation({ action, title, dependents, runs, onConfirm, onCancel }: Readonly<StopConfirmationProps>) {
  const { t } = useTranslation(["common", "researchTools"]);
  let heading = "";
  let description = "";
  let confirmLabel = "";
  let keepLabel = t(($) => $.researchTools.tasks.confirm.keepTask);
  if (action === "stop") {
    heading = t(($) => $.researchTools.tasks.confirm.stopTitle);
    description = t(($) => $.researchTools.tasks.confirm.stopDescription, { title });
    confirmLabel = t(($) => $.researchTools.tasks.detail.stopTask);
  } else if (action === "cancel") {
    heading = t(($) => $.researchTools.tasks.confirm.cancelTitle);
    description = t(($) => $.researchTools.tasks.confirm.cancelDescription, { title });
    confirmLabel = t(($) => $.researchTools.tasks.confirm.cancelTask);
  } else if (action === "discard") {
    heading = t(($) => $.researchTools.tasks.confirm.discardTitle);
    description = t(($) => $.researchTools.tasks.confirm.discardDescription, { title });
    confirmLabel = t(($) => $.researchTools.tasks.detail.discardChanges);
    keepLabel = t(($) => $.researchTools.tasks.confirm.keepChanges);
  }
  return (
    <ConfirmationDialog
      open={action !== null}
      destructive
      title={heading}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={keepLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {dependents.length > 0 ? (
        <div className="mt-3 text-xs" data-testid="research-task-confirm-dependents">
          <p className="font-medium">
            {t(($) => $.researchTools.tasks.confirm.dependents, { count: dependents.length })}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {dependents.map((dependent) => (
              <li key={dependent.id} className="break-words">
                {dependent.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {runs.length > 0 ? (
        <div className="mt-3 text-xs" data-testid="research-task-confirm-runs">
          <p className="font-medium">{t(($) => $.researchTools.tasks.confirm.runs, { count: runs.length })}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {runs.map((run) => (
              <li key={run.runId} className="break-words">
                {run.name} <span className="font-mono">{run.runId}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ConfirmationDialog>
  );
}

function FollowNewestItem({
  open,
  tab,
  running,
  scroller,
  nearBottom,
}: Readonly<{
  open: boolean;
  tab: string;
  running: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  nearBottom: RefObject<boolean>;
}>) {
  useEffect(() => {
    if (!open || tab !== "activity" || !running) return;
    const container = scroller.current;
    if (!container || !nearBottom.current) return;
    container.scrollTop = container.scrollHeight;
  }, [open, tab, running, scroller, nearBottom]);
  return null;
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
  onApprovePlan,
  onRefreshEvidence,
  onEdit,
  onApply,
  onAccept,
  onDelete,
  onLoadMoreEvents,
  onOpenSession,
  error,
  onDismissError,
}: Readonly<TaskDetailDialogProps>) {
  const { t, i18n: instance } = useTranslation(["common", "researchTools"]);
  const language = instance.language;
  const changeKindLabel = (kind: "added" | "modified" | "deleted"): string => {
    if (kind === "added") return t(($) => $.researchTools.tasks.detail.changeAdded);
    if (kind === "modified") return t(($) => $.researchTools.tasks.detail.changeModified);
    return t(($) => $.researchTools.tasks.detail.changeDeleted);
  };
  const taskRunKey = `${task.id}:${task.executionGeneration}`;
  const activeTaskRun = useRef(taskRunKey);
  activeTaskRun.current = taskRunKey;
  const running = task.status === "running";
  const timelineUsage = useMemo(() => latestTimelineUsage(events), [events]);
  const changedFiles = task.result?.changedFiles ?? EMPTY_CHANGES;
  const changedPathsKey = changedFiles.map((change) => change.path).join("\n");
  const recordPrefix = task.recordDir ? `${task.recordDir}/` : null;
  const inRecord = (path: string) => recordPrefix !== null && path.startsWith(recordPrefix);
  const projectChanges = changedFiles.filter((change) => !inRecord(change.path));
  const recordChanges = changedFiles.filter((change) => inRecord(change.path));
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

  const tab = chosenTab ?? autoTabFor(task);
  const activityShown = open && tab === "activity";

  const timelineCache = useRef<{ language: string; cache: TaskTimelineCache | null }>({ language, cache: null });
  const shownTimeline = useRef<TaskTimeline>(NO_TIMELINE);
  const timeline = useMemo(() => {
    if (!activityShown) return shownTimeline.current;
    const reusable = timelineCache.current.language === language ? timelineCache.current.cache : null;
    const built = buildTaskTimelineIncremental(events, running, reusable);
    timelineCache.current = { language, cache: built.cache };
    shownTimeline.current = built.timeline;
    return built.timeline;
  }, [activityShown, events, running, language]);
  const timelineCount = timeline.items.length;
  const lastItemSize = itemSize(timeline.items.at(-1));
  const [shownItems, setShownItems] = useState(SHOWN_ITEMS);

  const showOlderActivity = () => {
    if (timeline.items.length > shownItems) {
      setShownItems((current) => current + SHOWN_ITEMS);
      return;
    }
    setShownItems(timeline.items.length + SHOWN_ITEMS);
    void onLoadMoreEvents().catch(() => {});
  };

  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [savingKeepRunning, setSavingKeepRunning] = useState(false);
  const [earlier, setEarlier] = useState<EarlierGeneration[]>([]);
  const [earlierLoading, setEarlierLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void Promise.resolve()
      .then(() => getConfig())
      .then((config) => {
        if (current) setBackgroundEnabled(config?.research_background_enabled !== false);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [open]);

  const [earlierRunKey, setEarlierRunKey] = useState(taskRunKey);
  if (earlierRunKey !== taskRunKey) {
    setEarlierRunKey(taskRunKey);
    setEarlier([]);
    setEarlierLoading(false);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the timeline carries translated milestone text, so it is rebuilt on a language switch
  const earlierTimelines = useMemo(
    () =>
      earlier
        .map((entry) => ({ ...entry, timeline: buildTaskTimeline(entry.events, false) }))
        .filter((entry) => entry.timeline.items.length > 0 || entry.truncated),
    [earlier, language],
  );
  const oldestShown = earlier.length > 0 ? earlier[0] : null;
  const nextEarlier = oldestShown ? oldestShown.resumedFrom : (task.resumedFrom ?? null);
  const canShowEarlier = nextEarlier !== null && nextEarlier >= 1;
  const unfinished = task.status === "queued" || task.status === "running" || task.status === "plan_ready";
  const desktopAppsKeepConflict = task.brief.permissions.desktopApps && task.keepRunningAfterQuit !== true;

  const toggleKeepRunning = async (keep: boolean) => {
    setSavingKeepRunning(true);
    try {
      await setResearchTaskKeepRunning(task.id, keep);
    } catch (error_) {
      notifyError(
        "research-task-keep-running",
        error_,
        t(($) => $.researchTools.backgroundHelper.keepRunningFailed),
      );
    } finally {
      setSavingKeepRunning(false);
    }
  };

  const [confirming, setConfirming] = useState<StopAction | null>(null);
  const [confirmRuns, setConfirmRuns] = useState<RunRecord[]>([]);
  const [applying, setApplying] = useState(false);
  const applyRunning = useRef(false);
  const dependentsToFail = useMemo(
    () => (confirming ? waitingDependents(task.id, tasks) : []),
    [confirming, task.id, tasks],
  );
  const contentRef = useRef<HTMLDivElement | null>(null);

  const confirmRequest = useRef(0);
  const askToStop = (action: StopAction) => {
    const request = ++confirmRequest.current;
    setConfirming(action);
    setConfirmRuns([]);
    if (task.executionGeneration === 0) return;
    void Promise.resolve()
      .then(() => progressResearchTask(task.id))
      .then((progress) => {
        if (confirmRequest.current === request) setConfirmRuns(progress?.runsInFlight ?? []);
      })
      .catch(() => {});
  };

  const confirmStop = () => {
    confirmRequest.current += 1;
    setConfirming(null);
    void onCancel().catch(() => {});
  };

  const keepGoing = () => {
    confirmRequest.current += 1;
    setConfirming(null);
  };

  const apply = async () => {
    if (applyRunning.current) return;
    applyRunning.current = true;
    setApplying(true);
    try {
      await onApply(selectedPaths);
    } catch {
      // The dialog's error banner says what went wrong.
    } finally {
      applyRunning.current = false;
      setApplying(false);
    }
  };

  const showEarlierActivity = async () => {
    if (nextEarlier === null) return;
    const generation = nextEarlier;
    const requestRunKey = taskRunKey;
    setEarlierLoading(true);
    try {
      const pages: TaskTranscriptEvent[][] = [];
      let before = NEWEST_EVENTS;
      let more = false;
      let resumedFrom: number | null = null;
      for (let page = 0; page < EARLIER_PAGES; page += 1) {
        const result = await loadResearchTaskEventsBefore(task.id, generation, before, EARLIER_PAGE_SIZE);
        if (page === 0) resumedFrom = result.resumedFrom ?? null;
        pages.unshift(result.events);
        const previous = result.previousSequence ?? null;
        more = previous !== null;
        if (previous === null) break;
        before = previous;
      }
      if (activeTaskRun.current !== requestRunKey) return;
      const loaded = pages.flat();
      setEarlier((current) => [{ generation, events: loaded, truncated: more, resumedFrom }, ...current]);
    } catch (error_) {
      if (activeTaskRun.current === requestRunKey) notifyError("research-task-earlier-activity", error_);
    } finally {
      if (activeTaskRun.current === requestRunKey) setEarlierLoading(false);
    }
  };

  const toggleChangedPath = (path: string, checked: boolean) => {
    setSelectedPaths((current) =>
      checked ? [...current, path] : current.filter((candidate) => candidate !== path),
    );
  };

  const previewFile = async (path: string) => {
    const requestRunKey = taskRunKey;
    const previewKey = `${requestRunKey}:${path}`;
    setPreviewingPath(path);
    setPreviewError(null);
    try {
      const preview = await previewResearchTaskFile(task.id, path);
      if (activeTaskRun.current !== requestRunKey) return;
      setFilePreviews((current) => ({ ...current, [previewKey]: preview }));
      if (blocksApply(preview)) {
        setSelectedPaths((current) => current.filter((candidate) => candidate !== path));
      }
    } catch (error_) {
      if (activeTaskRun.current !== requestRunKey) return;
      setPreviewError(describeError(error_));
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
    } catch (error_) {
      if (activeTaskRun.current !== requestRunKey) return;
      setPreviewError(describeError(error_));
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
    .filter((path) => blocksApply(filePreviews[`${taskRunKey}:${path}`]));
  const usage = {
    inputTokens: timelineUsage.inputTokens ?? task.result?.inputTokens ?? null,
    outputTokens: timelineUsage.outputTokens ?? task.result?.outputTokens ?? null,
  };
  const artifacts = task.result?.artifacts ?? [];

  const openArtifact = (artifact: TaskArtifact) => {
    setChosenTab("output");
    void previewArtifact(artifact);
  };
  const openArtifactRef = useRef(openArtifact);
  openArtifactRef.current = openArtifact;
  const openArtifactFromRow = useCallback((artifact: TaskArtifact) => openArtifactRef.current(artifact), []);

  const startButtonLabel = () => {
    if (task.startRequested) return t(($) => $.researchTools.tasks.detail.waiting);
    if (blocked) return t(($) => $.researchTools.tasks.detail.startWhenReady);
    return t(($) => $.researchTools.tasks.detail.start);
  };

  const previewButtonLabel = (path: string, hasPreview: boolean) => {
    if (previewingPath === path) return t(($) => $.researchTools.tasks.detail.loading);
    if (hasPreview) return t(($) => $.researchTools.tasks.detail.refreshPreview);
    return t(($) => $.researchTools.tasks.detail.preview);
  };

  const artifactBinaryPreview = (preview: TaskArtifactPreview) =>
    preview.content.base64 && preview.content.mediaType ? (
      <img
        className="mt-2 max-h-72 max-w-full rounded border object-contain"
        alt={preview.artifact.label}
        src={`data:${preview.content.mediaType};base64,${preview.content.base64}`}
      />
    ) : (
      <p className="mt-2 text-xs text-muted-foreground">
        {t(($) => $.researchTools.tasks.detail.binaryArtifact, {
          size: preview.content.size ?? 0,
        })}
      </p>
    );

  const reviewEmptyState = () =>
    task.status === "awaiting_review" ? (
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
    );

  const headerActions = () => (
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
          {startButtonLabel()}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => askToStop("cancel")}
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
        onClick={() => askToStop("stop")}
      >
        {task.cancelRequested
          ? t(($) => $.researchTools.tasks.detail.stopping)
          : t(($) => $.researchTools.tasks.detail.stopTask)}
      </Button>
    ) : null}
    {(task.status === "failed" || task.status === "cancelled") && task.isolation ? (
      <>
        <Tooltip label={t(($) => $.researchTools.tasks.detail.resumeHint)}>
          <Button size="sm" disabled={busy} onClick={() => void onRetry("resume").catch(() => {})}>
            {t(($) => $.researchTools.tasks.detail.resume)}
          </Button>
        </Tooltip>
        <Tooltip label={t(($) => $.researchTools.tasks.detail.startOverHint)}>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void onRetry("fresh").catch(() => {})}>
            {t(($) => $.researchTools.tasks.detail.startOver)}
          </Button>
        </Tooltip>
      </>
    ) : null}
    {(task.status === "failed" || task.status === "cancelled") && !task.isolation ? (
      <Button size="sm" disabled={busy} onClick={() => void onRetry("fresh").catch(() => {})}>
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
  );

  const sourceRevisionNote = () => (
    <>
  {task.sourceRevision ? (
    <section className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
      <p className="select-text break-all">
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
    </>
  );

  const changeRow = (change: TaskFileChange) => {
    const preview = filePreviews[`${taskRunKey}:${change.path}`];
    const drifted = blocksApply(preview);
    const merging = changedSinceStart(preview) && !drifted;
    return (
      <div key={change.path} className="p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <Checkbox
            aria-label={t(($) => $.researchTools.tasks.detail.applyAria, {
              path: change.path,
            })}
            checked={selectedPaths.includes(change.path)}
            disabled={task.status !== "awaiting_review" || busy || drifted}
            onCheckedChange={(checked) => toggleChangedPath(change.path, checked === true)}
          />
          <Tooltip label={change.path} className="min-w-0 flex-1">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{change.path}</span>
          </Tooltip>
          {drifted ? (
            <Badge variant="warning" className="shrink-0 gap-1">
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
            {previewButtonLabel(change.path, Boolean(preview))}
          </Button>
        </div>
        {merging ? (
          <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
            <GitMerge aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {t(($) => $.researchTools.tasks.detail.mergesOnApply)}
            </span>
          </p>
        ) : null}
        {preview ? <FilePreviewBody preview={preview} /> : null}
      </div>
    );
  };

  const selectablePaths = changedFiles.map((change) => change.path).filter((path) => !driftedPaths.includes(path));
  const allSelected = selectablePaths.length > 0 && selectablePaths.every((path) => selectedPaths.includes(path));

  const changedFilesSection = () => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="flex items-center gap-2 text-sm font-medium">
          <FileDiff className="size-4" />
          {t(($) => $.researchTools.tasks.detail.fileChanges)}
        </h5>
        <Button
          size="xs"
          variant="link"
          disabled={selectablePaths.length === 0}
          onClick={() => setSelectedPaths(allSelected ? [] : selectablePaths)}
        >
          {allSelected
            ? t(($) => $.researchTools.tasks.detail.clearSelection)
            : t(($) => $.researchTools.tasks.detail.selectAll)}
        </Button>
      </div>
      {projectChanges.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.researchTools.tasks.detail.previewBeforeApply)}
        </p>
      ) : null}
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
      {projectChanges.length > 0 ? (
        <div className="divide-y rounded-md border">{projectChanges.map(changeRow)}</div>
      ) : null}
      {recordChanges.length > 0 ? (
        <section aria-labelledby="research-task-record-changes" className="space-y-1.5">
          <h6 id="research-task-record-changes" className="text-xs font-medium">
            {t(($) => $.researchTools.tasks.detail.researchRecord)}
          </h6>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.researchTools.tasks.detail.researchRecordHint)}
          </p>
          <div className="divide-y rounded-md border">{recordChanges.map(changeRow)}</div>
        </section>
      ) : null}
      {previewError ? (
        <p role="alert" className="select-text break-words text-xs text-destructive">
          {previewError}
        </p>
      ) : null}
      {task.status === "awaiting_review" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => askToStop("discard")}
          >
            {t(($) => $.researchTools.tasks.detail.discardChanges)}
          </Button>
          <Button
            disabled={
              busy ||
              applying ||
              selectedPaths.length === 0 ||
              selectedPaths.some(
                (path) => !inRecord(path) && !filePreviews[`${taskRunKey}:${path}`],
              )
            }
            onClick={() => void apply()}
          >
            {applying
              ? t(($) => $.researchTools.tasks.detail.applying)
              : t(($) => $.researchTools.tasks.detail.applySelected, {
                  selected: selectedPaths.length,
                })}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const showEvidence =
    Boolean(task.evidence) || task.phase === "checking_evidence" || task.status === "awaiting_review";

  const reviewTab = () =>
    task.status === "plan_ready" && onApprovePlan ? (
      <PlanReview
        task={task}
        busy={busy}
        onApprove={onApprovePlan}
        onDiscard={() => {
          askToStop("cancel");
          return Promise.resolve();
        }}
      />
    ) : (
      <>
        {sourceRevisionNote()}
        {changedFiles.length > 0 ? changedFilesSection() : reviewEmptyState()}
        {showEvidence && onRefreshEvidence ? (
          <Suspense fallback={null}>
            <EvidenceChecklist
              report={task.evidence}
              checking={task.phase === "checking_evidence"}
              onRefresh={onRefreshEvidence}
            />
          </Suspense>
        ) : null}
      </>
    );

  const outputTab = () => (
    <>
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
          <h5 className={SECTION_HEADING_CLASS}>
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
                <pre data-select-all-scope className="mt-2 max-h-80 select-text overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all text-xs">
                  {artifactPreview.content.text}
                </pre>
              ) : (
                artifactBinaryPreview(artifactPreview)
              )}
            </div>
          ) : null}
          {previewError ? (
            <p role="alert" className="select-text break-words text-xs text-destructive">
              {previewError}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const timelineProps: TimelineListShared = {
    runKey: taskRunKey,
    taskError: task.error,
    previewingPath,
    onOpenArtifact: openArtifactFromRow,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        data-testid="research-task-detail"
        className="flex h-[min(92vh,980px)] w-[min(96vw,1180px)] max-w-none flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (contentRef.current?.querySelector('[role="alertdialog"]')) event.preventDefault();
        }}
      >
        <article
          aria-labelledby="research-task-detail-title"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <header className="max-h-[45vh] shrink-0 space-y-3 overflow-y-auto border-b px-5 py-4 pr-14">
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
                  <TaskOwnerBadge task={task} />
                  <TaskAgentChip task={task} agentName={agentName} showAgent className="max-w-[22rem]" />
                  <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                    {relativeTime(task.updatedAt)}
                  </span>
                </div>
                <TaskStatusNotes task={task} running={running} />
                <KeepRunningToggle
                  task={task}
                  busy={busy}
                  saving={savingKeepRunning}
                  unfinished={unfinished}
                  backgroundEnabled={backgroundEnabled}
                  desktopAppsKeepConflict={desktopAppsKeepConflict}
                  onToggle={(keep) => void toggleKeepRunning(keep)}
                />
              </div>
              {headerActions()}
            </div>
            <DialogDescription className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {task.prompt}
            </DialogDescription>
            <HeaderAlerts task={task} tasks={tasks} error={error} onDismissError={onDismissError} />
          </header>

          <Tabs
            value={tab}
            onValueChange={setChosenTab}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <TabsList scrollable className="mx-5 mt-3 shrink-0 self-start">
              <TabsTrigger value="activity">
                {t(($) => $.researchTools.tasks.detail.tabActivity)}
              </TabsTrigger>
              <TabsTrigger value="progress">
                {t(($) => $.researchTools.tasks.detail.tabProgress)}
              </TabsTrigger>
              <TabsTrigger value="review">
                {t(($) => $.researchTools.tasks.detail.tabReview)}
              </TabsTrigger>
              <TabsTrigger value="output">
                {t(($) => $.researchTools.tasks.detail.tabOutput)}
              </TabsTrigger>
            </TabsList>

            <FollowNewestItem
              key={`${timelineCount}:${lastItemSize}`}
              open={open}
              tab={tab}
              running={running}
              scroller={activityRef}
              nearBottom={nearBottom}
            />
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
              <DependencyList dependencies={dependencies} />

              <section aria-labelledby="research-task-activity" className="min-w-0">
                <h4 id="research-task-activity" className="sr-only">
                  {t(($) => $.researchTools.tasks.detail.tabActivity)}
                </h4>
                <EarlierActivity
                  canShow={canShowEarlier}
                  loading={earlierLoading}
                  timelines={earlierTimelines}
                  onShow={() => void showEarlierActivity()}
                  listProps={timelineProps}
                />
                <ActivityTimeline
                  timeline={timeline}
                  shown={shownItems}
                  executionGeneration={task.executionGeneration}
                  running={running}
                  loading={eventsLoading}
                  canLoadMore={canLoadMoreEvents}
                  onShowOlder={showOlderActivity}
                  listProps={timelineProps}
                />
              </section>
            </TabsContent>

            <TabsContent value="progress" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <Suspense
                fallback={
                  <LoadingState size="compact" label={t(($) => $.researchTools.tasks.progress.loading)} />
                }
              >
                <TaskProgressTab task={task} />
              </Suspense>
            </TabsContent>

            <TabsContent value="review" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {reviewTab()}
            </TabsContent>

            <TabsContent value="output" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {outputTab()}
            </TabsContent>
          </Tabs>

          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-2.5">
            <TokenUsage usage={usage} />
          </footer>
        </article>
        <StopConfirmation
          action={confirming}
          title={task.title}
          dependents={dependentsToFail}
          runs={confirmRuns}
          onConfirm={confirmStop}
          onCancel={keepGoing}
        />
      </DialogContent>
    </Dialog>
  );
}
