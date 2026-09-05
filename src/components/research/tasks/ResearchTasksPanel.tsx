import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ResearchTask, TaskArtifact } from "@/lib/research-tasks";
import {
  mountResearchTaskSubscriptions,
  useResearchTasksStore,
} from "@/store/research-tasks";
import { TaskComposer } from "./TaskComposer";
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
  onOpenArtifact?: (task: ResearchTask, artifact: TaskArtifact) => void;
  onApplied?: (task: ResearchTask) => void;
}

const STATUS_LABELS: Record<ResearchTask["status"], string> = {
  queued: "Queued",
  running: "Running",
  awaiting_review: "Review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function ResearchTasksPanel({
  projectId,
  agents,
  onOpenSession,
  onOpenArtifact,
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
  const clearError = useResearchTasksStore((state) => state.clearError);
  const [composerProjectId, setComposerProjectId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const composerOpen = composerProjectId === projectId;

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
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
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
          <Button
            size="sm"
            disabled={agents.length === 0}
            onClick={() => {
              setEditingTaskId(null);
              setComposerProjectId(projectId);
            }}
          >
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

      {composerOpen ? (
        <div className="overflow-auto p-4">
          <TaskComposer
            projectId={projectId}
            agents={agents}
            tasks={tasks}
            editingTask={editingTask}
            busy={action === "create" || action === editingTask?.id}
            onCancel={() => {
              setComposerProjectId(null);
              setEditingTaskId(null);
            }}
            onCreate={async (draft) => {
              const task = await createTask(draft);
              setComposerProjectId(null);
              await selectTask(task.id);
            }}
            onSave={async (taskId, edit) => {
              await editTask(taskId, edit);
              setComposerProjectId(null);
              setEditingTaskId(null);
            }}
          />
        </div>
      ) : loading && tasks.length === 0 ? (
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
            <Button
              className="mt-4"
              disabled={agents.length === 0}
              onClick={() => setComposerProjectId(projectId)}
            >
              Create a task
            </Button>
            {agents.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Configure an agent before creating a task.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,0.36fr)_minmax(0,1fr)]">
          <nav aria-label="Research task list" className="min-h-0 overflow-auto border-r p-2">
            <ul className="space-y-1">
              {tasks.map((task) => {
                const selected = task.id === selectedTaskId;
                const blocked = task.dependencyIds.some(
                  (dependencyId) =>
                    tasks.find((candidate) => candidate.id === dependencyId)?.status !== "completed",
                );
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      onClick={() => void selectTask(task.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-primary/40 bg-primary/10"
                          : "border-transparent hover:bg-accent"
                      }`}
                    >
                      <span className="block truncate text-sm font-medium">{task.title}</span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <Badge variant="quiet">{STATUS_LABELS[task.status]}</Badge>
                        {blocked && task.status === "queued" ? (
                          <span className="text-[11px] text-muted-foreground">Waiting on a task</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <main className="min-h-0 p-4">
            {selectedTask ? (
              <TaskDetail
                key={`${selectedTask.id}:${selectedTask.executionGeneration}`}
                task={selectedTask}
                tasks={tasks}
                events={events}
                eventsLoading={eventsLoading}
                canLoadMoreEvents={eventsNextSequence !== null}
                busy={action === selectedTask.id}
                onEdit={() => {
                  setEditingTaskId(selectedTask.id);
                  setComposerProjectId(projectId);
                }}
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
                  onApplied?.(task);
                }}
                onAccept={async () => {
                  await acceptTask(selectedTask.id);
                }}
                onLoadMoreEvents={loadMoreEvents}
                onOpenSession={onOpenSession}
                onOpenArtifact={onOpenArtifact}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Select a task to see its instructions and result.
              </p>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
