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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sorted(tasks: ResearchTask[]): ResearchTask[] {
  return [...tasks].sort((left, right) => right.createdAt - left.createdAt);
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
    try {
      const tasks = await listResearchTasks(projectId);
      if (request !== projectRequest || get().projectId !== projectId) return;
      set({ tasks: sorted(tasks), loading: false });
    } catch (error) {
      if (request !== projectRequest || get().projectId !== projectId) return;
      set({ loading: false, error: message(error) });
    }
  },

  refresh: async () => {
    const projectId = get().projectId;
    if (!projectId) return;
    const request = ++projectRequest;
    set({ loading: true, error: null });
    try {
      const tasks = await listResearchTasks(projectId);
      if (request !== projectRequest || get().projectId !== projectId) return;
      set({ tasks: sorted(tasks), loading: false });
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
      set({
        events: page.events,
        eventsNextSequence: page.nextSequence,
        eventsLoading: false,
      });
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
        events: [...state.events, ...page.events],
        eventsNextSequence: page.nextSequence,
        eventsLoading: false,
      }));
    } catch (error) {
      if (request !== eventRequest || get().selectedTaskId !== selectedTaskId) return;
      set({ eventsLoading: false, error: message(error) });
    }
  },

  createTask: async (draft) => {
    set({ action: "create", error: null });
    try {
      const task = await createResearchTask(draft);
      get().receiveTask(task);
      set({ action: null, selectedTaskId: task.id });
      return task;
    } catch (error) {
      set({ action: null, error: message(error) });
      throw error;
    }
  },

  editTask: async (taskId, edit) => {
    set({ action: taskId, error: null });
    try {
      const task = await editResearchTask(taskId, edit);
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      set({ action: null, error: message(error) });
      throw error;
    }
  },

  startTask: async (taskId) => {
    set({ action: taskId, error: null });
    try {
      const task = await startResearchTask(taskId);
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      set({ action: null, error: message(error) });
      throw error;
    }
  },

  cancelTask: async (taskId) => {
    set({ action: taskId, error: null });
    try {
      const task = await cancelResearchTask(taskId);
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      set({ action: null, error: message(error) });
      throw error;
    }
  },

  retryTask: async (taskId) => {
    set({ action: taskId, error: null });
    try {
      const task = await retryResearchTask(taskId);
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      set({ action: null, error: message(error) });
      throw error;
    }
  },

  applyTask: async (taskId, selectedPaths) => {
    const projectId = get().projectId;
    if (!projectId) throw new Error("Open a project before applying task changes.");
    set({ action: taskId, error: null });
    try {
      const result = await useFilesStore
        .getState()
        .runExternalProjectMutation(projectId, (generation) =>
          applyResearchTask(taskId, generation, selectedPaths),
        );
      set({ action: null });
      get().receiveTask(result.task);
      return result.task;
    } catch (error) {
      set({ action: null, error: message(error) });
      throw error;
    }
  },

  acceptTask: async (taskId) => {
    set({ action: taskId, error: null });
    try {
      const task = await acceptResearchTaskResult(taskId);
      get().receiveTask(task);
      set({ action: null });
      return task;
    } catch (error) {
      set({ action: null, error: message(error) });
      throw error;
    }
  },

  receiveTask: (task) => {
    if (task.projectId !== get().projectId) return;
    set((state) => {
      const existing = state.tasks.findIndex((candidate) => candidate.id === task.id);
      const tasks = [...state.tasks];
      if (existing >= 0) tasks[existing] = task;
      else tasks.push(task);
      return { tasks: sorted(tasks) };
    });
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
      if (state.events.some((candidate) => candidate.sequence === event.sequence)) return state;
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
