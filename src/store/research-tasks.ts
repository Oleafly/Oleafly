import { create } from "zustand";
import {
  acceptResearchTaskResult,
  applyResearchTask,
  cancelResearchTask,
  createResearchTask,
  editResearchTask,
  listResearchTasks,
  listenForResearchTaskChanges,
  listenForResearchTaskEvents,
  loadResearchTaskEvents,
  retryResearchTask,
  startResearchTask,
  type ResearchTask,
  type ResearchTaskDraft,
  type ResearchTaskEdit,
  type TaskTranscriptEvent,
} from "@/lib/research-tasks";
import { useFilesStore } from "@/store/files";

interface ResearchTasksState {
  projectId: string | null;
  tasks: ResearchTask[];
  selectedTaskId: string | null;
  events: TaskTranscriptEvent[];
  eventsNextSequence: number | null;
  loading: boolean;
  eventsLoading: boolean;
  action: string | null;
  error: string | null;
  bindProject: (projectId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  selectTask: (taskId: string | null) => Promise<void>;
  loadMoreEvents: () => Promise<void>;
  createTask: (draft: ResearchTaskDraft) => Promise<ResearchTask>;
  editTask: (taskId: string, edit: ResearchTaskEdit) => Promise<ResearchTask>;
  startTask: (taskId: string) => Promise<ResearchTask>;
  cancelTask: (taskId: string) => Promise<ResearchTask>;
  retryTask: (taskId: string) => Promise<ResearchTask>;
  applyTask: (taskId: string, selectedPaths: string[]) => Promise<ResearchTask>;
  acceptTask: (taskId: string) => Promise<ResearchTask>;
  receiveTask: (task: ResearchTask) => void;
  receiveEvent: (event: TaskTranscriptEvent) => void;
  clearError: () => void;
}

let projectRequest = 0;
let eventRequest = 0;
let projectBinding = 0;
let actionRequest = 0;

function beginTaskAction(): () => boolean {
  const binding = projectBinding;
  const request = ++actionRequest;
  return () => binding === projectBinding && request === actionRequest;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sorted(tasks: ResearchTask[]): ResearchTask[] {
  return [...tasks].sort((left, right) => right.createdAt - left.createdAt);
}

function mergedEvents(events: TaskTranscriptEvent[], task: ResearchTask): TaskTranscriptEvent[] {
  const unique = new Map<number, TaskTranscriptEvent>();
  for (const event of events) {
    if (event.taskId === task.id && event.executionGeneration === task.executionGeneration) {
      unique.set(event.sequence, event);
    }
  }
  return [...unique.values()].sort((left, right) => left.sequence - right.sequence);
}

function receiveTaskList(incoming: ResearchTask[], baseline: ResearchTask[]): void {
  const state = useResearchTasksStore.getState();
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const initial = new Map(baseline.map((task) => [task.id, task]));
  for (const task of incoming) {
    if (task.projectId !== state.projectId) continue;
    const previous = tasks.get(task.id);
    if (!previous || task.executionGeneration > previous.executionGeneration ||
      (task.executionGeneration === previous.executionGeneration &&
        (task.updatedAt > previous.updatedAt ||
          (task.updatedAt === previous.updatedAt && previous === initial.get(task.id))))) {
      tasks.set(task.id, task);
    }
  }
  const previous = state.tasks.find((task) => task.id === state.selectedTaskId);
  const selected = state.selectedTaskId ? tasks.get(state.selectedTaskId) : undefined;
  const runChanged = selected && previous?.executionGeneration !== selected.executionGeneration;
  if (runChanged) eventRequest += 1;
  useResearchTasksStore.setState({
    tasks: sorted([...tasks.values()]),
    loading: false,
    ...(runChanged ? { events: [], eventsNextSequence: null, eventsLoading: false } : {}),
  });
  if (runChanged) void state.selectTask(selected.id);
}

export const useResearchTasksStore = create<ResearchTasksState>((set, get) => ({
  projectId: null,
  tasks: [],
  selectedTaskId: null,
  events: [],
  eventsNextSequence: null,
  loading: false,
  eventsLoading: false,
  action: null,
  error: null,

  bindProject: async (projectId) => {
    projectBinding += 1;
    const request = ++projectRequest;
    eventRequest += 1;
    set({
      projectId,
      tasks: [],
      selectedTaskId: null,
      events: [],
      eventsNextSequence: null,
      loading: Boolean(projectId),
      eventsLoading: false,
      action: null,
      error: null,
    });
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
    set({
      selectedTaskId: taskId,
      events: [],
      eventsNextSequence: null,
      eventsLoading: Boolean(taskId),
    });
    if (!taskId) return;
    const task = get().tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.executionGeneration === 0) {
      set({ eventsLoading: false });
      return;
    }
    try {
      const page = await loadResearchTaskEvents(task.id, task.executionGeneration);
      if (request !== eventRequest || get().selectedTaskId !== taskId) return;
      set((state) => ({
        events: mergedEvents([...page.events, ...state.events], task),
        eventsNextSequence: page.nextSequence,
        eventsLoading: false,
      }));
    } catch (error) {
      if (request !== eventRequest || get().selectedTaskId !== taskId) return;
      set({ eventsLoading: false, error: message(error) });
    }
  },

  loadMoreEvents: async () => {
    const { selectedTaskId, eventsNextSequence, eventsLoading, tasks } = get();
    if (!selectedTaskId || eventsNextSequence === null || eventsLoading) return;
    const task = tasks.find((candidate) => candidate.id === selectedTaskId);
    if (!task) return;
    const request = ++eventRequest;
    set({ eventsLoading: true });
    try {
      const page = await loadResearchTaskEvents(
        task.id,
        task.executionGeneration,
        eventsNextSequence,
      );
      if (request !== eventRequest || get().selectedTaskId !== selectedTaskId) return;
      set((state) => ({
        events: mergedEvents([...page.events, ...state.events], task),
        eventsNextSequence: page.nextSequence,
        eventsLoading: false,
      }));
    } catch (error) {
      if (request !== eventRequest || get().selectedTaskId !== selectedTaskId) return;
      set({ eventsLoading: false, error: message(error) });
    }
  },

  createTask: async (draft) => {
    const isCurrent = beginTaskAction();
    set({ action: "create", error: null });
    try {
      const task = await createResearchTask(draft);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      if (isCurrent()) set({ action: null, error: message(error) });
      throw error;
    }
  },

  editTask: async (taskId, edit) => {
    const isCurrent = beginTaskAction();
    set({ action: taskId, error: null });
    try {
      const task = await editResearchTask(taskId, edit);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      if (isCurrent()) set({ action: null, error: message(error) });
      throw error;
    }
  },

  startTask: async (taskId) => {
    const isCurrent = beginTaskAction();
    set({ action: taskId, error: null });
    try {
      const task = await startResearchTask(taskId);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      if (isCurrent()) set({ action: null, error: message(error) });
      throw error;
    }
  },

  cancelTask: async (taskId) => {
    const isCurrent = beginTaskAction();
    set({ action: taskId, error: null });
    try {
      const task = await cancelResearchTask(taskId);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      if (isCurrent()) set({ action: null, error: message(error) });
      throw error;
    }
  },

  retryTask: async (taskId) => {
    const isCurrent = beginTaskAction();
    set({ action: taskId, error: null });
    try {
      const task = await retryResearchTask(taskId);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      if (isCurrent()) set({ action: null, error: message(error) });
      throw error;
    }
  },

  applyTask: async (taskId, selectedPaths) => {
    const projectId = get().projectId;
    if (!projectId) throw new Error("Open a project before applying task changes.");
    const isCurrent = beginTaskAction();
    set({ action: taskId, error: null });
    try {
      const result = await useFilesStore
        .getState()
        .runExternalProjectMutation(projectId, (generation) =>
          applyResearchTask(taskId, generation, selectedPaths),
        );
      if (!isCurrent()) return result.task;
      set({ action: null });
      get().receiveTask(result.task);
      return result.task;
    } catch (error) {
      if (isCurrent()) set({ action: null, error: message(error) });
      throw error;
    }
  },

  acceptTask: async (taskId) => {
    const isCurrent = beginTaskAction();
    set({ action: taskId, error: null });
    try {
      const task = await acceptResearchTaskResult(taskId);
      if (!isCurrent()) return task;
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      if (isCurrent()) set({ action: null, error: message(error) });
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
    set((state) => {
      const existing = state.tasks.findIndex((candidate) => candidate.id === task.id);
      const tasks = [...state.tasks];
      if (existing >= 0) tasks[existing] = task;
      else tasks.push(task);
      return {
        tasks: sorted(tasks),
        ...(runChanged ? { events: [], eventsNextSequence: null, eventsLoading: false } : {}),
      };
    });
    if (runChanged) void get().selectTask(task.id);
  },

  receiveEvent: (event) => {
    const { selectedTaskId, tasks } = get();
    const task = tasks.find((candidate) => candidate.id === event.taskId);
    if (
      selectedTaskId !== event.taskId ||
      !task ||
      task.executionGeneration !== event.executionGeneration
    ) {
      return;
    }
    set((state) => {
      if (state.events.some((candidate) => candidate.executionGeneration === event.executionGeneration && candidate.sequence === event.sequence)) return state;
      return { events: [...state.events, event].sort((a, b) => a.sequence - b.sequence) };
    });
  },

  clearError: () => set({ error: null }),
}));

export async function mountResearchTaskSubscriptions(): Promise<() => void> {
  const [unlistenTasks, unlistenEvents] = await Promise.all([
    listenForResearchTaskChanges((task) =>
      useResearchTasksStore.getState().receiveTask(task),
    ),
    listenForResearchTaskEvents((event) =>
      useResearchTasksStore.getState().receiveEvent(event),
    ),
  ]);
  return () => {
    unlistenTasks();
    unlistenEvents();
  };
}
