import { create } from "zustand";
import {
  acceptResearchTaskResult,
  applyResearchTask,
  approveResearchTaskPlan,
  cancelResearchTask,
  createResearchTask,
  deleteResearchTask,
  editResearchTask,
  listResearchTasks,
  listenForResearchTaskChanges,
  listenForResearchTaskDeltas,
  listenForResearchTaskEvents,
  loadResearchTaskEventsBefore,
  NEWEST_EVENTS,
  retryResearchTask,
  startResearchTask,
  watchResearchTask,
  type ResearchBrief,
  type ResearchTask,
  type ResearchTaskDraft,
  type ResearchTaskEdit,
  type RetryMode,
  type TaskTranscriptDelta,
  type TaskTranscriptEvent,
} from "@/lib/research-tasks";
import { useFilesStore } from "@/store/files";
import { decodeAppError, describeError } from "@/lib/app-error";

export type ResearchTaskDetailTab = "activity" | "progress" | "review" | "output";

export interface ResearchTaskComposerDraft {
  starterId: string;
  title: string;
  prompt: string;
  agentKey: string;
  skillIds: string[];
  dependencyIds: string[];
  brief?: ResearchBrief;
  runAfter?: number | null;
  keepRunning?: boolean;
}

interface ResearchTasksState {
  projectId: string | null;
  tasks: ResearchTask[];
  selectedTaskId: string | null;
  events: TaskTranscriptEvent[];
  /** Older saved rows of the run come before this sequence; Load more reads them. */
  eventsPreviousSequence: number | null;
  loading: boolean;
  eventsLoading: boolean;
  /** The task (or "create") of the latest action still running. */
  action: string | null;
  /** Every task (or "create") with an action running; actions on other tasks don't affect each other. */
  pendingActions: string[];
  error: string | null;
  detailOpen: boolean;
  detailTab: ResearchTaskDetailTab | null;
  composerDrafts: Record<string, ResearchTaskComposerDraft>;
  openTaskDetail: (taskId: string, tab?: ResearchTaskDetailTab) => void;
  setDetailOpen: (open: boolean) => void;
  setDetailTab: (tab: ResearchTaskDetailTab | null) => void;
  saveComposerDraft: (key: string, draft: ResearchTaskComposerDraft) => void;
  clearComposerDraft: (key: string) => void;
  deleteTask: (taskId: string) => Promise<void>;
  bindProject: (projectId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  selectTask: (taskId: string | null) => Promise<void>;
  loadMoreEvents: () => Promise<void>;
  createTask: (draft: ResearchTaskDraft) => Promise<ResearchTask>;
  editTask: (taskId: string, edit: ResearchTaskEdit) => Promise<ResearchTask>;
  startTask: (taskId: string) => Promise<ResearchTask>;
  cancelTask: (taskId: string) => Promise<ResearchTask>;
  retryTask: (taskId: string, mode?: RetryMode) => Promise<ResearchTask>;
  approvePlan: (taskId: string, editedPlan?: string) => Promise<ResearchTask>;
  applyTask: (taskId: string, selectedPaths: string[]) => Promise<ResearchTask>;
  acceptTask: (taskId: string) => Promise<ResearchTask>;
  receiveTask: (task: ResearchTask) => void;
  receiveEvent: (event: TaskTranscriptEvent) => void;
  receiveDelta: (delta: TaskTranscriptDelta) => void;
  clearError: () => void;
}

let projectRequest = 0;
let eventRequest = 0;
let projectBinding = 0;
let actionRequest = 0;

// One entry per task (or "create") with an action running, so a slow cancel on
// one task is not cleared by another task's action finishing.
const runningActions = new Map<string, number>();

function beginTaskAction(key: string): () => boolean {
  const binding = projectBinding;
  const request = ++actionRequest;
  runningActions.set(key, request);
  return () => binding === projectBinding && runningActions.get(key) === request;
}

function busyActions(): Pick<ResearchTasksState, "action" | "pendingActions"> {
  const keys = [...runningActions.keys()];
  return { action: keys.at(-1) ?? null, pendingActions: keys };
}

function endTaskAction(key: string): Pick<ResearchTasksState, "action" | "pendingActions"> {
  runningActions.delete(key);
  return busyActions();
}

function message(error: unknown): string {
  if (decodeAppError(error)) return describeError(error);
  return error instanceof Error ? error.message : String(error);
}

function sorted(tasks: ResearchTask[]): ResearchTask[] {
  return [...tasks].sort((left, right) => right.createdAt - left.createdAt);
}

/** Puts `task` in a list kept newest first, without sorting the list again. */
function upserted(tasks: ResearchTask[], task: ResearchTask): ResearchTask[] {
  const existing = tasks.findIndex((candidate) => candidate.id === task.id);
  const next = tasks.slice();
  if (existing >= 0 && tasks[existing].createdAt === task.createdAt) {
    next[existing] = task;
    return next;
  }
  if (existing >= 0) next.splice(existing, 1);
  let low = 0;
  let high = next.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (next[middle].createdAt >= task.createdAt) low = middle + 1;
    else high = middle;
  }
  next.splice(low, 0, task);
  return next;
}

/** The index of `sequence` in events sorted by sequence, or where it goes. */
function sequenceSlot(events: TaskTranscriptEvent[], sequence: number): { index: number; found: boolean } {
  const last = events.length - 1;
  if (last < 0 || events[last].sequence < sequence) return { index: events.length, found: false };
  if (events[last].sequence === sequence) return { index: last, found: true };
  let low = 0;
  let high = last;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].sequence < sequence) low = middle + 1;
    else high = middle;
  }
  return { index: low, found: events[low]?.sequence === sequence };
}

// `undefined` until this page has told the backend anything: after a reload the
// backend may still send the task the previous page watched, so the first
// `watch(null)` goes out too.
let watchedTask: string | null | undefined;
// The dialog closed and the window stopped listening to its task, so the rows
// this window holds may be behind until it opens again.
let eventsMissed = false;

/** Tells the backend which task this window shows (its live text). */
function watch(taskId: string | null): void {
  if (watchedTask === taskId) return;
  watchedTask = taskId;
  void watchResearchTask(taskId).catch(() => {
    // An older backend has no watch command and sends every event.
  });
}

/** Marks the rows as behind when the window stops listening to a task. */
function unwatch(): void {
  if (typeof watchedTask === "string") eventsMissed = true;
  watch(null);
}

/**
 * Gets the dialog's task ready after it opens: listens to it again and loads
 * its newest rows when the window wasn't listening.
 */
function resumeSelectedTask(): void {
  const state = useResearchTasksStore.getState();
  const taskId = state.selectedTaskId;
  if (!taskId) return;
  if (eventsMissed || watchedTask !== taskId) void state.selectTask(taskId);
}

type TextRow = TaskTranscriptEvent & { event: { kind: "text" | "reasoning"; text: string } };

function isTextRow(row: TaskTranscriptEvent): row is TextRow {
  return row.event.kind === "text" || row.event.kind === "reasoning";
}

/**
 * Joins two copies of one text row, such as a saved row and the live text
 * that arrived while it loaded. Each covers part of the row's text from its
 * `textStart`; the result covers both without repeating any text.
 */
function joinTextRows(saved: TextRow, live: TextRow): TextRow {
  const [head, tail] = (live.textStart ?? 0) < (saved.textStart ?? 0) ? [live, saved] : [saved, live];
  const headStart = head.textStart ?? 0;
  const headEnd = headStart + head.event.text.length;
  const tailStart = tail.textStart ?? 0;
  if (tailStart + tail.event.text.length <= headEnd) return head;
  // Text between the two (lost live text) can't be recovered; the tail follows on.
  const added = tailStart <= headEnd ? tail.event.text.slice(headEnd - tailStart) : tail.event.text;
  return { ...head, event: { ...head.event, text: head.event.text + added } };
}

/** The row to keep when `incoming` arrives for a sequence `current` holds. */
function joinedRow(current: TaskTranscriptEvent, incoming: TaskTranscriptEvent): TaskTranscriptEvent {
  if (isTextRow(current) && isTextRow(incoming) && current.event.kind === incoming.event.kind) {
    return joinTextRows(current, incoming);
  }
  return incoming;
}

function mergedEvents(events: TaskTranscriptEvent[], task: ResearchTask): TaskTranscriptEvent[] {
  const unique = new Map<number, TaskTranscriptEvent>();
  for (const event of events) {
    if (event.taskId === task.id && event.executionGeneration === task.executionGeneration) {
      const current = unique.get(event.sequence);
      unique.set(event.sequence, current ? joinedRow(current, event) : event);
    }
  }
  return [...unique.values()].sort((left, right) => left.sequence - right.sequence);
}

/** Whether a task row from a fetched list replaces the one this window holds. */
function replacesTask(
  task: ResearchTask,
  previous: ResearchTask | undefined,
  initial: ResearchTask | undefined,
): boolean {
  if (!previous) return true;
  if (task.executionGeneration !== previous.executionGeneration) {
    return task.executionGeneration > previous.executionGeneration;
  }
  if (task.updatedAt !== previous.updatedAt) return task.updatedAt > previous.updatedAt;
  return previous === initial;
}

/** The window's tasks with a fetched list folded in: newer rows win. */
function mergeTaskList(
  held: readonly ResearchTask[],
  projectId: string | null,
  incoming: readonly ResearchTask[],
  baseline: readonly ResearchTask[],
): Map<string, ResearchTask> {
  const tasks = new Map(held.map((task) => [task.id, task]));
  const initial = new Map(baseline.map((task) => [task.id, task]));
  for (const task of incoming) {
    if (task.projectId !== projectId) continue;
    if (replacesTask(task, tasks.get(task.id), initial.get(task.id))) tasks.set(task.id, task);
  }
  // A task this window had when the list was asked for, still unchanged, and
  // missing from the list was deleted elsewhere.
  const listed = new Set(incoming.map((task) => task.id));
  for (const [id, current] of tasks) {
    if (!listed.has(id) && initial.get(id) === current) tasks.delete(id);
  }
  return tasks;
}

function receiveTaskList(incoming: ResearchTask[], baseline: ResearchTask[]): void {
  const state = useResearchTasksStore.getState();
  const tasks = mergeTaskList(state.tasks, state.projectId, incoming, baseline);
  const previous = state.tasks.find((task) => task.id === state.selectedTaskId);
  const selected = state.selectedTaskId ? tasks.get(state.selectedTaskId) : undefined;
  const selectionGone = state.selectedTaskId !== null && !selected;
  const runChanged = selected && previous?.executionGeneration !== selected.executionGeneration;
  if (runChanged || selectionGone) eventRequest += 1;
  useResearchTasksStore.setState({
    tasks: sorted([...tasks.values()]),
    loading: false,
    ...(runChanged ? { events: [], eventsPreviousSequence: null, eventsLoading: false } : {}),
    ...(selectionGone
      ? {
          selectedTaskId: null,
          events: [],
          eventsPreviousSequence: null,
          eventsLoading: false,
          detailOpen: false,
          detailTab: null,
        }
      : {}),
  });
  if (selectionGone) watch(null);
  if (runChanged) void state.selectTask(selected.id);
}

export const useResearchTasksStore = create<ResearchTasksState>((set, get) => ({
  projectId: null,
  tasks: [],
  selectedTaskId: null,
  events: [],
  eventsPreviousSequence: null,
  loading: false,
  eventsLoading: false,
  action: null,
  pendingActions: [],
  error: null,
  detailOpen: false,
  detailTab: null,
  composerDrafts: {},

  openTaskDetail: (taskId, tab) => {
    // Open first, so the page selecting the task knows the dialog shows it.
    set({ detailOpen: true, detailTab: tab ?? null });
    if (get().selectedTaskId !== taskId) void get().selectTask(taskId);
    else resumeSelectedTask();
  },

  setDetailOpen: (open) => {
    if (open) {
      set({ detailOpen: true });
      resumeSelectedTask();
      return;
    }
    set({ detailOpen: false, detailTab: null });
    // No dialog shows the task's live text, so the backend can stop sending it.
    unwatch();
  },

  setDetailTab: (tab) => set({ detailTab: tab }),

  saveComposerDraft: (key, draft) =>
    set((state) => ({ composerDrafts: { ...state.composerDrafts, [key]: draft } })),

  clearComposerDraft: (key) =>
    set((state) => {
      if (!(key in state.composerDrafts)) return state;
      const composerDrafts = { ...state.composerDrafts };
      delete composerDrafts[key];
      return { composerDrafts };
    }),

  deleteTask: async (taskId) => {
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      await deleteResearchTask(taskId);
      if (!isCurrent()) return;
      set((state) => {
        const tasks = state.tasks.filter((task) => task.id !== taskId);
        return {
          ...endTaskAction(taskId),
          tasks,
          ...(state.selectedTaskId === taskId
            ? {
                selectedTaskId: null,
                events: [],
                eventsPreviousSequence: null,
                eventsLoading: false,
                detailOpen: false,
                detailTab: null,
              }
            : {}),
        };
      });
      if (get().selectedTaskId === null) watch(null);
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  bindProject: async (projectId) => {
    projectBinding += 1;
    const request = ++projectRequest;
    eventRequest += 1;
    runningActions.clear();
    set({
      projectId,
      tasks: [],
      selectedTaskId: null,
      events: [],
      eventsPreviousSequence: null,
      loading: Boolean(projectId),
      eventsLoading: false,
      ...busyActions(),
      error: null,
      detailOpen: false,
      detailTab: null,
    });
    // The window no longer shows the previous project's task.
    eventsMissed = false;
    watch(null);
    if (!projectId) return;
    const baseline = get().tasks;
    try {
      const tasks = await listResearchTasks(projectId);
      if (request !== projectRequest || get().projectId !== projectId) return;
      receiveTaskList(tasks, baseline);
    } catch (error) {
      if (request !== projectRequest || get().projectId !== projectId) return;
      set({ loading: false, error: message(error) });
    }
  },

  refresh: async () => {
    const projectId = get().projectId;
    if (!projectId) return;
    const request = ++projectRequest;
    const baseline = get().tasks;
    set({ loading: true, error: null });
    try {
      const tasks = await listResearchTasks(projectId);
      if (request !== projectRequest || get().projectId !== projectId) return;
      receiveTaskList(tasks, baseline);
    } catch (error) {
      if (request !== projectRequest || get().projectId !== projectId) return;
      set({ loading: false, error: message(error) });
    }
  },

  selectTask: async (taskId) => {
    const request = ++eventRequest;
    // Nothing shows a task's rows while its dialog is closed, so the window
    // neither loads nor streams them until the dialog opens.
    const shown = get().detailOpen;
    eventsMissed = taskId !== null && !shown;
    set({
      selectedTaskId: taskId,
      events: [],
      eventsPreviousSequence: null,
      eventsLoading: Boolean(taskId) && shown,
    });
    watch(shown ? taskId : null);
    if (!taskId || !shown) return;
    const task = get().tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.executionGeneration === 0) {
      set({ eventsLoading: false });
      return;
    }
    try {
      // The newest rows first, so the latest activity shows at once and meets
      // the live rows; older rows are behind Load more.
      const page = await loadResearchTaskEventsBefore(task.id, task.executionGeneration, NEWEST_EVENTS);
      if (request !== eventRequest || get().selectedTaskId !== taskId) return;
      set((state) => ({
        events: mergedEvents([...page.events, ...state.events], task),
        eventsPreviousSequence: page.previousSequence ?? null,
        eventsLoading: false,
      }));
    } catch (error) {
      if (request !== eventRequest || get().selectedTaskId !== taskId) return;
      set({ eventsLoading: false, error: message(error) });
    }
  },

  loadMoreEvents: async () => {
    const { selectedTaskId, eventsPreviousSequence, eventsLoading, tasks } = get();
    if (!selectedTaskId || eventsPreviousSequence === null || eventsLoading) return;
    const task = tasks.find((candidate) => candidate.id === selectedTaskId);
    if (!task) return;
    const request = ++eventRequest;
    set({ eventsLoading: true });
    try {
      // Pages backwards from the oldest row shown.
      const page = await loadResearchTaskEventsBefore(
        task.id,
        task.executionGeneration,
        eventsPreviousSequence,
      );
      if (request !== eventRequest || get().selectedTaskId !== selectedTaskId) return;
      set((state) => ({
        events: mergedEvents([...page.events, ...state.events], task),
        eventsPreviousSequence: page.previousSequence ?? null,
        eventsLoading: false,
      }));
    } catch (error) {
      if (request !== eventRequest || get().selectedTaskId !== selectedTaskId) return;
      set({ eventsLoading: false, error: message(error) });
    }
  },

  createTask: async (draft) => {
    const isCurrent = beginTaskAction("create");
    set({ ...busyActions(), error: null });
    try {
      const task = await createResearchTask(draft);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set(endTaskAction("create"));
      return task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction("create"), error: message(error) });
      throw error;
    }
  },

  editTask: async (taskId, edit) => {
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      const task = await editResearchTask(taskId, edit);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set(endTaskAction(taskId));
      return task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  startTask: async (taskId) => {
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      const task = await startResearchTask(taskId);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set(endTaskAction(taskId));
      return task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  cancelTask: async (taskId) => {
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      const task = await cancelResearchTask(taskId);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set(endTaskAction(taskId));
      return task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  retryTask: async (taskId, mode) => {
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      const task = await retryResearchTask(taskId, mode);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set(endTaskAction(taskId));
      return task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  approvePlan: async (taskId, editedPlan) => {
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      const task = await approveResearchTaskPlan(taskId, editedPlan);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set(endTaskAction(taskId));
      return task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  applyTask: async (taskId, selectedPaths) => {
    const projectId = get().projectId;
    if (!projectId) throw new Error("Open a project before applying task changes.");
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      const result = await useFilesStore
        .getState()
        .runExternalProjectMutation(projectId, (generation) =>
          applyResearchTask(taskId, generation, selectedPaths),
        );
      if (!isCurrent()) return result.task;
      set(endTaskAction(taskId));
      get().receiveTask(result.task);
      return result.task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  acceptTask: async (taskId) => {
    const isCurrent = beginTaskAction(taskId);
    set({ ...busyActions(), error: null });
    try {
      const task = await acceptResearchTaskResult(taskId);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set(endTaskAction(taskId));
      return task;
    } catch (error) {
      if (isCurrent()) set({ ...endTaskAction(taskId), error: message(error) });
      throw error;
    }
  },

  receiveTask: (task) => {
    if (task.projectId !== get().projectId) return;
    const previous = get().tasks.find((candidate) => candidate.id === task.id);
    if (previous && (previous.executionGeneration > task.executionGeneration ||
      (previous.executionGeneration === task.executionGeneration && previous.updatedAt > task.updatedAt))) return;
    const runChanged = get().selectedTaskId === task.id &&
      previous?.executionGeneration !== task.executionGeneration;
    if (runChanged) eventRequest += 1;
    set((state) => ({
      tasks: upserted(state.tasks, task),
      ...(runChanged ? { events: [], eventsPreviousSequence: null, eventsLoading: false } : {}),
    }));
    if (runChanged) void get().selectTask(task.id);
  },

  receiveEvent: (event) => {
    const { selectedTaskId, tasks, detailOpen } = get();
    if (!detailOpen) {
      // An older backend sends every row; nothing shows them, and the dialog
      // loads the task again when it opens.
      if (selectedTaskId === event.taskId) eventsMissed = true;
      return;
    }
    const task = tasks.find((candidate) => candidate.id === event.taskId);
    if (
      selectedTaskId !== event.taskId ||
      !task ||
      task.executionGeneration !== event.executionGeneration
    ) {
      return;
    }
    set((state) => {
      const slot = sequenceSlot(state.events, event.sequence);
      const events = state.events.slice();
      if (slot.found) events[slot.index] = joinedRow(events[slot.index], event);
      else events.splice(slot.index, 0, event);
      return { events };
    });
  },

  receiveDelta: (delta) => {
    const { selectedTaskId, tasks, detailOpen } = get();
    if (selectedTaskId !== delta.taskId) return;
    if (!detailOpen) {
      eventsMissed = true;
      return;
    }
    const task = tasks.find((candidate) => candidate.id === delta.taskId);
    if (!task || task.executionGeneration !== delta.executionGeneration) return;
    // Where the append starts in its row, when the backend says.
    const start = delta.textLength === undefined ? undefined : Math.max(0, delta.textLength - delta.append.length);
    const live: TextRow = {
      taskId: delta.taskId,
      executionGeneration: delta.executionGeneration,
      sequence: delta.sequence,
      event: { kind: delta.kind, text: delta.append },
      createdAt: delta.createdAt,
      ...(start ? { textStart: start } : {}),
    };
    set((state) => {
      const slot = sequenceSlot(state.events, delta.sequence);
      const events = state.events.slice();
      const existing = slot.found ? events[slot.index] : undefined;
      if (existing && isTextRow(existing)) {
        if (start === undefined) {
          events[slot.index] = {
            ...existing,
            event: { ...existing.event, text: existing.event.text + delta.append },
          };
        } else {
          // Text this window already has (from a saved row) is not added again.
          const joined = existing.event.kind === delta.kind ? joinTextRows(existing, live) : existing;
          if (joined === existing) return state;
          events[slot.index] = joined;
        }
      } else if (!existing) {
        events.splice(slot.index, 0, live);
      } else {
        return state;
      }
      return { events };
    });
  },

  clearError: () => set({ error: null }),
}));

let subscribers = 0;
let listening: Promise<() => void> | null = null;

async function listenOnce(): Promise<() => void> {
  // The window answers PDF text requests from the app shell (research-pdf-bridge),
  // so a task can read papers without a research view open.
  const started = await Promise.allSettled([
    listenForResearchTaskChanges((task) => useResearchTasksStore.getState().receiveTask(task)),
    listenForResearchTaskEvents((event) => useResearchTasksStore.getState().receiveEvent(event)),
    listenForResearchTaskDeltas((delta) => useResearchTasksStore.getState().receiveDelta(delta)),
  ]);
  const unlisten = started.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failed = started.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) {
    // Stop the ones that started, so a retry doesn't listen twice.
    for (const stop of unlisten) stop();
    throw failed.reason;
  }
  return () => {
    for (const stop of unlisten) stop();
  };
}

/** One set of listeners however many views mount it; the last unmount stops them. */
export async function mountResearchTaskSubscriptions(): Promise<() => void> {
  subscribers += 1;
  listening ??= listenOnce();
  const current = listening;
  let stopListening: () => void;
  try {
    stopListening = await current;
  } catch (error) {
    subscribers -= 1;
    if (subscribers === 0 && listening === current) listening = null;
    throw error;
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    subscribers -= 1;
    if (subscribers > 0 || listening !== current) return;
    // A view that replaces this one in the same commit mounts before this
    // microtask runs; the listeners stay on for it, so no event is missed
    // while they would start again.
    queueMicrotask(() => {
      if (subscribers > 0 || listening !== current) return;
      listening = null;
      stopListening();
      unwatch();
    });
  };
}
