import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  FlaskConical,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ResearchTask } from "@/lib/research-tasks";
import {
  mountResearchTaskSubscriptions,
  useResearchTasksStore,
} from "@/store/research-tasks";
import { composerDraftKey, TaskComposer } from "./TaskComposer";
import { TaskDetail } from "./TaskDetail";

export interface ResearchTaskAgentOption {
  runtimeId: string;
  agentId: string;
  modelId: string;
  label: string;
  modelLabel?: string;
  available?: boolean;
  unavailableReason?: string;
}

export interface ResearchTasksPanelProps {
  projectId: string | null;
  agents: ResearchTaskAgentOption[];
  onOpenSession?: (task: ResearchTask) => void;
  onApplied?: (task: ResearchTask) => void;
}

type TaskFilter = "all" | "running" | "review" | "done";

const STATUS_LABELS: Record<ResearchTask["status"], string> = {
  queued: "Queued",
  running: "Running",
  awaiting_review: "Review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_ICONS: Record<ResearchTask["status"], typeof CircleDashed> = {
  queued: CircleDashed,
  running: Loader2,
  awaiting_review: FlaskConical,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
};

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "review", label: "Needs review" },
  { id: "done", label: "Done" },
];

function matchesFilter(task: ResearchTask, filter: TaskFilter): boolean {
  switch (filter) {
    case "running":
      return task.status === "running" || task.status === "queued";
    case "review":
      return task.status === "awaiting_review";
    case "done":
      return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
    default:
      return true;
  }
}

function relativeTime(value: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ResearchTasksPanel({
  projectId,
  agents,
  onOpenSession,
  onApplied,
}: ResearchTasksPanelProps) {
  const tasks = useResearchTasksStore((state) => state.tasks);
  const selectedTaskId = useResearchTasksStore((state) => state.selectedTaskId);
  const events = useResearchTasksStore((state) => state.events);
  const eventsNextSequence = useResearchTasksStore((state) => state.eventsNextSequence);
  const loading = useResearchTasksStore((state) => state.loading);
  const eventsLoading = useResearchTasksStore((state) => state.eventsLoading);
  const action = useResearchTasksStore((state) => state.action);
  const error = useResearchTasksStore((state) => state.error);
  const bindProject = useResearchTasksStore((state) => state.bindProject);
  const refresh = useResearchTasksStore((state) => state.refresh);
  const selectTask = useResearchTasksStore((state) => state.selectTask);
  const loadMoreEvents = useResearchTasksStore((state) => state.loadMoreEvents);
  const createTask = useResearchTasksStore((state) => state.createTask);
  const editTask = useResearchTasksStore((state) => state.editTask);
  const startTask = useResearchTasksStore((state) => state.startTask);
  const cancelTask = useResearchTasksStore((state) => state.cancelTask);
  const retryTask = useResearchTasksStore((state) => state.retryTask);
  const applyTask = useResearchTasksStore((state) => state.applyTask);
  const acceptTask = useResearchTasksStore((state) => state.acceptTask);
  const deleteTask = useResearchTasksStore((state) => state.deleteTask);
  const clearComposerDraft = useResearchTasksStore((state) => state.clearComposerDraft);
  const clearError = useResearchTasksStore((state) => state.clearError);
  const [composerProjectId, setComposerProjectId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [composerInstance, setComposerInstance] = useState(0);
  const [savingComposerInstance, setSavingComposerInstance] = useState<number | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const composerGeneration = useRef(0);
  const pendingComposerInstance = useRef<number | null>(null);
  const composerOpen = composerProjectId === projectId;
  const projectBinding = useMemo(() => ({ projectId }), [projectId]);
  const activeProjectBinding = useRef<typeof projectBinding | null>(projectBinding);
  activeProjectBinding.current = projectBinding;

  useEffect(() => {
    activeProjectBinding.current = projectBinding;
    return () => {
      if (activeProjectBinding.current === projectBinding) activeProjectBinding.current = null;
    };
  }, [projectBinding]);

  useEffect(() => {
    void bindProject(projectId);
  }, [bindProject, projectId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    void mountResearchTaskSubscriptions().then((cleanup) => {
      if (mounted) unlisten = cleanup;
      else cleanup();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (selectedTaskId || tasks.length === 0) return;
    void selectTask(tasks[0].id);
  }, [selectTask, selectedTaskId, tasks]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) ?? null,
    [editingTaskId, tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((task) => matchesFilter(task, filter)),
    [filter, tasks],
  );
  const pendingDelete = useMemo(
    () => tasks.find((task) => task.id === pendingDeleteId) ?? null,
    [pendingDeleteId, tasks],
  );

  const openComposer = (taskId: string | null = null) => {
    setComposerInstance(++composerGeneration.current);
    setEditingTaskId(taskId);
    setComposerProjectId(projectId);
  };

  const closeComposer = () => {
    composerGeneration.current += 1;
    setComposerProjectId(null);
    setEditingTaskId(null);
  };

  const saveComposer = async (save: () => Promise<ResearchTask>, selectCreated = false) => {
    if (composerGeneration.current !== composerInstance || pendingComposerInstance.current === composerInstance) return;
    pendingComposerInstance.current = composerInstance;
    setSavingComposerInstance(composerInstance);
    try {
      const task = await save();
      if (activeProjectBinding.current !== projectBinding || composerGeneration.current !== composerInstance) return;
      closeComposer();
      if (selectCreated) await selectTask(task.id);
    } finally {
      if (pendingComposerInstance.current === composerInstance) pendingComposerInstance.current = null;
      setSavingComposerInstance((current) => current === composerInstance ? null : current);
    }
  };

  const confirmDelete = async () => {
    const taskId = pendingDeleteId;
    setPendingDeleteId(null);
    if (!taskId || !projectId) return;
    clearComposerDraft(composerDraftKey(projectId, taskId));
    await deleteTask(taskId).catch(() => {});
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <h2 className="text-base font-semibold">Open a project to use research tasks</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Tasks belong to a project and keep their own sessions, dependencies, and review state.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="research-tasks-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Research tasks</h2>
          <p className="text-xs text-muted-foreground">
            Run longer work separately, inspect the result, then choose what reaches your project.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label="Refresh research tasks"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button size="sm" disabled={agents.length === 0} onClick={() => openComposer()}>
            <Plus /> New task
          </Button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <div className="flex min-w-0 items-start gap-2 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p>{error}</p>
          </div>
          <Button size="xs" variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {loading && tasks.length === 0 ? (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading research tasks...
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <h3 className="text-sm font-semibold">No research tasks yet</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Start with a literature review, an evidence audit, an analysis, or a manuscript revision.
            </p>
            <Button className="mt-4" disabled={agents.length === 0} onClick={() => openComposer()}>
              <Plus /> Create a task
            </Button>
            {agents.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Configure an agent before creating a task.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
          <nav aria-label="Research task list" className="flex min-h-0 flex-col border-r">
            <div className="shrink-0 px-2 pt-2">
              <Tabs value={filter} onValueChange={(next) => setFilter(next as TaskFilter)}>
                <TabsList size="sm" className="grid w-full grid-cols-4">
                  {FILTERS.map((entry) => (
                    <TabsTrigger key={entry.id} value={entry.id} size="sm">
                      {entry.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
              {visibleTasks.length === 0 ? (
                <li className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No tasks in this view.
                </li>
              ) : null}
              {visibleTasks.map((task) => {
                const selected = task.id === selectedTaskId;
                const blocked = task.dependencyIds.some(
                  (dependencyId) =>
                    tasks.find((candidate) => candidate.id === dependencyId)?.status !== "completed",
                );
                const StatusIcon = STATUS_ICONS[task.status];
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      onClick={() => void selectTask(task.id)}
                      className={`w-full rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-colors ${
                        selected ? "border-primary/40 bg-primary/5" : "hover:bg-accent"
                      }`}
                    >
                      <span className="block truncate text-sm font-medium">{task.title}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={task.status === "awaiting_review" ? "primaryGhost" : "quiet"}
                          className="gap-1"
                        >
                          <StatusIcon
                            aria-hidden="true"
                            className={`size-3 ${task.status === "running" ? "animate-spin" : ""}`}
                          />
                          {STATUS_LABELS[task.status]}
                        </Badge>
                        <Badge variant="outline" className="max-w-[9rem] truncate">
                          {task.agentId}
                        </Badge>
                        {task.dependencyIds.length > 0 ? (
                          <Badge variant="outline" className="gap-1">
                            <Link2 aria-hidden="true" className="size-3" />
                            {task.dependencyIds.length}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">{relativeTime(task.updatedAt)}</span>
                        {blocked && task.status === "queued" ? <span>Waiting on a task</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <main className="min-h-0 overflow-auto p-4">
            {selectedTask ? (
              <TaskDetail
                key={`${selectedTask.id}:${selectedTask.executionGeneration}`}
                task={selectedTask}
                tasks={tasks}
                events={events}
                eventsLoading={eventsLoading}
                canLoadMoreEvents={eventsNextSequence !== null}
                busy={action === selectedTask.id}
                onEdit={() => openComposer(selectedTask.id)}
                onStart={async () => {
                  await startTask(selectedTask.id);
                }}
                onCancel={async () => {
                  await cancelTask(selectedTask.id);
                }}
                onRetry={async () => {
                  await retryTask(selectedTask.id);
                }}
                onApply={async (paths) => {
                  const task = await applyTask(selectedTask.id, paths);
                  if (activeProjectBinding.current !== projectBinding) return;
                  onApplied?.(task);
                }}
                onAccept={async () => {
                  await acceptTask(selectedTask.id);
                }}
                onDelete={() => setPendingDeleteId(selectedTask.id)}
                onLoadMoreEvents={loadMoreEvents}
                onOpenSession={onOpenSession}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Select a task to see its instructions and result.
              </p>
            )}
          </main>
        </div>
      )}

      {composerOpen ? (
        <TaskComposer
          key={composerInstance}
          projectId={projectId}
          agents={agents}
          tasks={tasks}
          editingTask={editingTask}
          busy={savingComposerInstance === composerInstance}
          onCancel={closeComposer}
          onDismiss={closeComposer}
          onCreate={(draft) => saveComposer(() => createTask(draft), true)}
          onSave={(taskId, edit) => saveComposer(() => editTask(taskId, edit))}
        />
      ) : null}

      <ConfirmationDialog
        open={pendingDelete !== null}
        destructive
        title="Delete this task?"
        description={`"${pendingDelete?.title ?? ""}" and its isolated workspace are removed. Files already applied to your project stay.`}
        confirmLabel="Delete task"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
