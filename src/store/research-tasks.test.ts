import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskTranscriptEvent, TaskTranscriptPage } from "@/lib/research-tasks";

const fileMocks = vi.hoisted(() => ({
  runExternalProjectMutation: vi.fn(),
}));

vi.mock("@/lib/research-tasks", () => ({
  acceptResearchTaskResult: vi.fn(),
  applyResearchTask: vi.fn(),
  cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(),
  editResearchTask: vi.fn(),
  listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(),
  listenForResearchTaskEvents: vi.fn(),
  loadResearchTaskEvents: vi.fn(),
  readProjectMutationGeneration: vi.fn(),
  retryResearchTask: vi.fn(),
  startResearchTask: vi.fn(),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({
      runExternalProjectMutation: fileMocks.runExternalProjectMutation,
    }),
  },
}));

import * as api from "@/lib/research-tasks";
import { useResearchTasksStore } from "./research-tasks";

function task(id: string, projectId: string, createdAt = 1): ResearchTask {
  return {
    id,
    projectId,
    title: id,
    prompt: `Complete ${id}`,
    runtimeId: "builtin",
    agentId: "provider",
    modelId: "model",
    skillIds: [],
    dependencyIds: [],
    status: "awaiting_review",
    executionGeneration: 1,
    sessionId: `session-${id}`,
    nativeSessionId: null,
    sourceRevision: "snapshot:base",
    isolation: null,
    error: null,
    result: null,
    review: null,
    startRequested: false,
    cancelRequested: false,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("research task store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fileMocks.runExternalProjectMutation.mockImplementation(
      async (
        _projectId: string,
        action: (generation: number) => Promise<unknown>,
      ) => action(17),
    );
    useResearchTasksStore.setState({
      projectId: null,
      tasks: [],
      selectedTaskId: null,
      events: [],
      eventsNextSequence: null,
      loading: false,
      eventsLoading: false,
      action: null,
      error: null,
    });
  });

  it("ignores a stale task list after the open project changes", async () => {
    const first = deferred<ResearchTask[]>();
    const second = deferred<ResearchTask[]>();
    vi.mocked(api.listResearchTasks).mockImplementation((projectId) =>
      projectId === "first" ? first.promise : second.promise,
    );

    const firstRequest = useResearchTasksStore.getState().bindProject("first");
    const secondRequest = useResearchTasksStore.getState().bindProject("second");
    second.resolve([task("second-task", "second")]);
    await secondRequest;
    first.resolve([task("first-task", "first")]);
    await firstRequest;

    expect(useResearchTasksStore.getState().tasks.map((value) => value.id)).toEqual([
      "second-task",
    ]);
  });

  it("deduplicates and orders transcript events for the selected run", () => {
    const selected = task("selected", "paper");
    useResearchTasksStore.setState({
      projectId: "paper",
      tasks: [selected],
      selectedTaskId: selected.id,
    });
    const event = (sequence: number): TaskTranscriptEvent => ({
      taskId: selected.id,
      executionGeneration: selected.executionGeneration,
      sequence,
      event: { kind: "status", message: `Step ${sequence}` },
      createdAt: sequence,
    });

    useResearchTasksStore.getState().receiveEvent(event(2));
    useResearchTasksStore.getState().receiveEvent(event(1));
    useResearchTasksStore.getState().receiveEvent(event(2));

    expect(useResearchTasksStore.getState().events.map((value) => value.sequence)).toEqual([1, 2]);
  });

  it("runs native apply inside the external project mutation transaction", async () => {
    const reviewed = task("reviewed", "paper");
    const completed = { ...reviewed, status: "completed" as const };
    useResearchTasksStore.setState({ projectId: "paper", tasks: [reviewed] });
    vi.mocked(api.applyResearchTask).mockResolvedValue({
      task: completed,
      projectState: {} as never,
    });

    await useResearchTasksStore.getState().applyTask(reviewed.id, ["main.tex"]);

    expect(fileMocks.runExternalProjectMutation).toHaveBeenCalledWith(
      "paper",
      expect.any(Function),
    );
    expect(api.applyResearchTask).toHaveBeenCalledWith(reviewed.id, 17, ["main.tex"]);
    expect(useResearchTasksStore.getState().tasks[0].status).toBe("completed");
  });

  it("does not invoke native apply when the mutation transaction rejects preflight", async () => {
    const reviewed = task("reviewed", "paper");
    fileMocks.runExternalProjectMutation.mockRejectedValue(new Error("editor flush failed"));
    useResearchTasksStore.setState({ projectId: "paper", tasks: [reviewed] });

    await expect(
      useResearchTasksStore.getState().applyTask(reviewed.id, ["main.tex"]),
    ).rejects.toThrow("editor flush failed");

    expect(api.applyResearchTask).not.toHaveBeenCalled();
    expect(useResearchTasksStore.getState().action).toBeNull();
    expect(useResearchTasksStore.getState().error).toBe("editor flush failed");
  });

  it("keeps the current project selection when an earlier project creation completes", async () => {
    const pending = deferred<ResearchTask>();
    const first = task("created-in-first", "first");
    const second = task("selected-in-second", "second");
    vi.mocked(api.listResearchTasks).mockResolvedValue([second]);
    vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [], nextSequence: null });
    vi.mocked(api.createResearchTask).mockReturnValue(pending.promise);
    useResearchTasksStore.setState({ projectId: "first" });
    const creation = useResearchTasksStore.getState().createTask({
      projectId: "first", title: first.title, prompt: first.prompt,
      runtimeId: first.runtimeId, agentId: first.agentId, modelId: first.modelId,
      skillIds: [], dependencyIds: [],
    });

    await useResearchTasksStore.getState().bindProject("second");
    await useResearchTasksStore.getState().selectTask(second.id);
    pending.resolve(first);
    await creation;

    expect(useResearchTasksStore.getState().selectedTaskId).toBe(second.id);
    expect(useResearchTasksStore.getState().tasks).toEqual([second]);
  });

  it("does not replace a new project action with a stale project failure", async () => {
    const oldRequest = deferred<ResearchTask>();
    const currentRequest = deferred<ResearchTask>();
    const first = task("first-task", "first");
    const second = task("second-task", "second");
    vi.mocked(api.startResearchTask).mockReturnValue(oldRequest.promise);
    vi.mocked(api.retryResearchTask).mockReturnValue(currentRequest.promise);
    vi.mocked(api.listResearchTasks).mockResolvedValue([second]);
    useResearchTasksStore.setState({ projectId: "first", tasks: [first] });
    const oldAction = useResearchTasksStore.getState().startTask(first.id);
    const oldFailure = expect(oldAction).rejects.toThrow("first project failed");
    await useResearchTasksStore.getState().bindProject("second");
    const currentAction = useResearchTasksStore.getState().retryTask(second.id);
    oldRequest.reject(new Error("first project failed"));
    await oldFailure;

    expect(useResearchTasksStore.getState().action).toBe(second.id);
    expect(useResearchTasksStore.getState().error).toBeNull();
    currentRequest.resolve({ ...second, status: "queued" });
    await currentAction;
    expect(useResearchTasksStore.getState().action).toBeNull();
  });

  it("does not show an old project activity page after rebinding", async () => {
    const pending = deferred<TaskTranscriptPage>();
    const first = task("first-task", "first");
    vi.mocked(api.loadResearchTaskEvents).mockReturnValue(pending.promise);
    useResearchTasksStore.setState({ projectId: "first", tasks: [first] });
    const selection = useResearchTasksStore.getState().selectTask(first.id);
    await useResearchTasksStore.getState().bindProject(null);
    pending.resolve({
      events: [{ taskId: first.id, executionGeneration: 1, sequence: 1, event: { kind: "text", text: "old activity" }, createdAt: 1 }],
      nextSequence: 1,
    });
    await selection;

    expect(useResearchTasksStore.getState()).toMatchObject({
      selectedTaskId: null, events: [], eventsNextSequence: null, eventsLoading: false,
    });
  });

  it("rejects an old action result after leaving and returning to the same project", async () => {
    const pending = deferred<ResearchTask>();
    const current = task("current", "paper");
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [], nextSequence: null });
    vi.mocked(api.createResearchTask).mockReturnValue(pending.promise);
    await useResearchTasksStore.getState().bindProject("paper");
    const request = useResearchTasksStore.getState().createTask({
      projectId: "paper", title: "Old creation", prompt: "Old request", runtimeId: "builtin",
      agentId: "provider", modelId: "model", skillIds: [], dependencyIds: [],
    });
    await useResearchTasksStore.getState().bindProject(null);
    await useResearchTasksStore.getState().bindProject("paper");
    await useResearchTasksStore.getState().selectTask(current.id);
    pending.resolve(task("old-creation", "paper"));
    expect((await request).id).toBe("old-creation");

    expect(useResearchTasksStore.getState().selectedTaskId).toBe(current.id);
    expect(useResearchTasksStore.getState().tasks).toEqual([current]);
  });

  it("keeps a newer action busy when an earlier action in the same project succeeds", async () => {
    const first = task("first", "paper");
    const second = task("second", "paper");
    const starting = deferred<ResearchTask>();
    const cancelling = deferred<ResearchTask>();
    vi.mocked(api.startResearchTask).mockReturnValue(starting.promise);
    vi.mocked(api.cancelResearchTask).mockReturnValue(cancelling.promise);
    useResearchTasksStore.setState({ projectId: "paper", tasks: [first, second] });
    const start = useResearchTasksStore.getState().startTask(first.id);
    const cancel = useResearchTasksStore.getState().cancelTask(second.id);
    starting.resolve({ ...first, status: "running" });
    expect((await start).status).toBe("running");

    expect(useResearchTasksStore.getState().action).toBe(second.id);
    cancelling.resolve({ ...second, status: "cancelled" });
    await cancel;
    expect(useResearchTasksStore.getState().action).toBeNull();
    expect(useResearchTasksStore.getState().tasks.find((value) => value.id === second.id)?.status).toBe("cancelled");
  });

  it("preserves live activity that arrives while a transcript page is loading", async () => {
    const selected = task("selected", "paper");
    const pending = deferred<TaskTranscriptPage>();
    const event = (sequence: number): TaskTranscriptEvent => ({ taskId: selected.id, executionGeneration: 1, sequence, createdAt: sequence, event: { kind: "text", text: `Step ${sequence}` } });
    vi.mocked(api.loadResearchTaskEvents).mockReturnValue(pending.promise);
    useResearchTasksStore.setState({ projectId: "paper", tasks: [selected] });
    const selection = useResearchTasksStore.getState().selectTask(selected.id);
    useResearchTasksStore.getState().receiveEvent(event(2));
    pending.resolve({ events: [event(1)], nextSequence: 1 });
    await selection;

    expect(useResearchTasksStore.getState().events.map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  it("deduplicates a paginated transcript when live events overlap the page", async () => {
    const selected = task("selected", "paper");
    const pending = deferred<TaskTranscriptPage>();
    const event = (sequence: number): TaskTranscriptEvent => ({ taskId: selected.id, executionGeneration: 1, sequence, createdAt: sequence, event: { kind: "text", text: `Step ${sequence}` } });
    useResearchTasksStore.setState({ projectId: "paper", tasks: [selected], selectedTaskId: selected.id, events: [event(1)], eventsNextSequence: 1 });
    vi.mocked(api.loadResearchTaskEvents).mockReturnValue(pending.promise);
    const loading = useResearchTasksStore.getState().loadMoreEvents();
    await useResearchTasksStore.getState().loadMoreEvents();
    expect(api.loadResearchTaskEvents).toHaveBeenCalledOnce();
    useResearchTasksStore.getState().receiveEvent(event(2));
    pending.resolve({ events: [event(2), event(3)], nextSequence: null });
    await loading;

    expect(useResearchTasksStore.getState().events.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(useResearchTasksStore.getState().eventsNextSequence).toBeNull();
  });

  it("clears previous-run activity when a retried task starts a new execution", () => {
    const selected = task("selected", "paper");
    useResearchTasksStore.setState({
      projectId: "paper", tasks: [selected], selectedTaskId: selected.id,
      events: [{ taskId: selected.id, executionGeneration: 1, sequence: 1, event: { kind: "text", text: "previous run" }, createdAt: 1 }],
      eventsNextSequence: 1,
    });
    vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [], nextSequence: null });
    useResearchTasksStore.getState().receiveTask({ ...selected, status: "running", executionGeneration: 2, result: null });
    useResearchTasksStore.getState().receiveEvent({ taskId: selected.id, executionGeneration: 2, sequence: 1, event: { kind: "text", text: "new run" }, createdAt: 2 });

    expect(useResearchTasksStore.getState().events).toEqual([
      expect.objectContaining({ executionGeneration: 2, event: { kind: "text", text: "new run" } }),
    ]);
    expect(useResearchTasksStore.getState().eventsNextSequence).toBeNull();
  });

  it("rejects old pages and task updates after a new execution starts", async () => {
    const selected = task("selected", "paper");
    const oldPage = deferred<TaskTranscriptPage>();
    const newPage = deferred<TaskTranscriptPage>();
    vi.mocked(api.loadResearchTaskEvents).mockImplementation((_id, generation) => generation === 1 ? oldPage.promise : newPage.promise);
    useResearchTasksStore.setState({ projectId: "paper", tasks: [selected] });
    const selection = useResearchTasksStore.getState().selectTask(selected.id);
    const next = { ...selected, status: "running" as const, executionGeneration: 2, result: null };
    useResearchTasksStore.getState().receiveTask(next);
    expect(api.loadResearchTaskEvents).toHaveBeenLastCalledWith(selected.id, 2);
    useResearchTasksStore.getState().receiveTask(selected);
    oldPage.resolve({ events: [{ taskId: selected.id, executionGeneration: 1, sequence: 1, event: { kind: "text", text: "old page" }, createdAt: 1 }], nextSequence: 1 });
    await selection;

    expect(useResearchTasksStore.getState().eventsLoading).toBe(true);
    expect(useResearchTasksStore.getState().events).toEqual([]);
    expect(useResearchTasksStore.getState().tasks).toEqual([next]);
    newPage.resolve({ events: [{ taskId: selected.id, executionGeneration: 2, sequence: 1, event: { kind: "text", text: "new page" }, createdAt: 2 }], nextSequence: null });
    await newPage.promise;
    expect(useResearchTasksStore.getState().events).toEqual([expect.objectContaining({ executionGeneration: 2 })]);
    expect(useResearchTasksStore.getState().eventsLoading).toBe(false);
  });

  it("retains the loaded task on a failed edit and clears the error when retrying", async () => {
    const selected = task("selected", "paper");
    const pending = deferred<ResearchTask>();
    const edit = { title: "Updated title", prompt: "Updated instructions", runtimeId: "builtin", agentId: "provider", modelId: "model", skillIds: [], dependencyIds: [] };
    useResearchTasksStore.setState({ projectId: "paper", tasks: [selected], selectedTaskId: selected.id });
    vi.mocked(api.editResearchTask).mockRejectedValueOnce(new Error("This task has already started"));
    await expect(useResearchTasksStore.getState().editTask(selected.id, edit)).rejects.toThrow("already started");
    expect(useResearchTasksStore.getState()).toMatchObject({ tasks: [selected], selectedTaskId: selected.id, action: null, error: "This task has already started" });
    vi.mocked(api.editResearchTask).mockReturnValueOnce(pending.promise);
    const retry = useResearchTasksStore.getState().editTask(selected.id, edit);
    expect(useResearchTasksStore.getState()).toMatchObject({ action: selected.id, error: null });
    pending.resolve({ ...selected, ...edit });
    await retry;
    expect(useResearchTasksStore.getState().tasks[0].title).toBe(edit.title);
    expect(useResearchTasksStore.getState().action).toBeNull();
  });

  it.each(["bind", "refresh"] as const)("preserves a newer live run and new tasks during a pending %s", async (operation) => {
    const selected = task("selected", "paper");
    const pending = deferred<ResearchTask[]>();
    const next = { ...selected, executionGeneration: 2, status: "running" as const, updatedAt: 2 };
    const activity: TaskTranscriptEvent = { taskId: selected.id, executionGeneration: 2, sequence: 1, event: { kind: "text", text: "Current run" }, createdAt: 2 };
    const added = task("new-task", "paper", 3);
    vi.mocked(api.listResearchTasks).mockReturnValue(pending.promise);
    vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [activity], nextSequence: null });
    useResearchTasksStore.setState({ projectId: "paper", tasks: [selected] });

    const loading = operation === "bind"
      ? useResearchTasksStore.getState().bindProject("paper")
      : useResearchTasksStore.getState().refresh();
    useResearchTasksStore.getState().receiveTask(next);
    useResearchTasksStore.getState().receiveTask(added);
    await useResearchTasksStore.getState().selectTask(selected.id);
    pending.resolve([{ ...selected, updatedAt: 50 }]);
    await loading;

    expect(useResearchTasksStore.getState()).toMatchObject({
      tasks: [added, next], selectedTaskId: selected.id,
      events: [activity], eventsLoading: false, loading: false,
    });
    expect(api.loadResearchTaskEvents).toHaveBeenCalledOnce();
  });

  it("reloads a newly discovered run and rejects its previous run's pending activity page", async () => {
    const selected = task("selected", "paper");
    const next = { ...selected, executionGeneration: 2, status: "running" as const, updatedAt: 2 };
    const oldPage = deferred<TaskTranscriptPage>();
    const newPage = deferred<TaskTranscriptPage>();
    const activity = (generation: number): TaskTranscriptEvent => ({ taskId: selected.id, executionGeneration: generation, sequence: 1, event: { kind: "text", text: `Run ${generation}` }, createdAt: generation });
    vi.mocked(api.loadResearchTaskEvents).mockImplementation((_id, generation) => generation === 1 ? oldPage.promise : newPage.promise);
    vi.mocked(api.listResearchTasks).mockResolvedValue([next]);
    useResearchTasksStore.setState({
      projectId: "paper", tasks: [selected], selectedTaskId: selected.id,
      events: [activity(1)], eventsNextSequence: 1,
    });
    const oldLoading = useResearchTasksStore.getState().loadMoreEvents();

    await useResearchTasksStore.getState().refresh();

    expect(api.loadResearchTaskEvents).toHaveBeenLastCalledWith(selected.id, 2);
    expect(useResearchTasksStore.getState()).toMatchObject({
      tasks: [next], selectedTaskId: selected.id,
      events: [], eventsNextSequence: null, eventsLoading: true,
    });
    oldPage.resolve({ events: [activity(1)], nextSequence: 2 });
    await oldLoading;
    expect(useResearchTasksStore.getState()).toMatchObject({ events: [], eventsNextSequence: null, eventsLoading: true });
    newPage.resolve({ events: [activity(2)], nextSequence: null });
    await newPage.promise;
    expect(useResearchTasksStore.getState()).toMatchObject({ events: [activity(2)], eventsLoading: false });
  });

  it("merges task updates by timestamp within a run without reloading its activity", async () => {
    const selected = { ...task("selected", "paper"), status: "running" as const, updatedAt: 1 };
    const review = { ...selected, status: "awaiting_review" as const, updatedAt: 3 };
    const completed = { ...review, status: "completed" as const, updatedAt: 4 };
    const activity: TaskTranscriptEvent = { taskId: selected.id, executionGeneration: 1, sequence: 1, event: { kind: "text", text: "Saved answer" }, createdAt: 2 };
    const pending = deferred<ResearchTask[]>();
    vi.mocked(api.listResearchTasks).mockReturnValueOnce(pending.promise).mockResolvedValueOnce([completed]);
    useResearchTasksStore.setState({ projectId: "paper", tasks: [selected], selectedTaskId: selected.id, events: [activity] });
    const loading = useResearchTasksStore.getState().refresh();
    useResearchTasksStore.getState().receiveTask(review);
    pending.resolve([{ ...selected, updatedAt: 2 }]);
    await loading;

    expect(useResearchTasksStore.getState().tasks).toEqual([review]);
    await useResearchTasksStore.getState().refresh();
    expect(useResearchTasksStore.getState()).toMatchObject({ tasks: [completed], events: [activity] });
    expect(api.loadResearchTaskEvents).not.toHaveBeenCalled();
  });

  it("ignores a pending refresh after leaving and rebinding the same project", async () => {
    const pending = deferred<ResearchTask[]>();
    const first = task("old-task", "paper");
    const current = task("current-task", "paper");
    const activity: TaskTranscriptEvent = { taskId: current.id, executionGeneration: 1, sequence: 1, event: { kind: "text", text: "Current binding" }, createdAt: 1 };
    vi.mocked(api.listResearchTasks).mockReturnValueOnce(pending.promise).mockResolvedValueOnce([current]);
    vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [activity], nextSequence: null });
    useResearchTasksStore.setState({ projectId: "paper", tasks: [first] });
    const loading = useResearchTasksStore.getState().refresh();
    await useResearchTasksStore.getState().bindProject(null);
    await useResearchTasksStore.getState().bindProject("paper");
    await useResearchTasksStore.getState().selectTask(current.id);
    pending.resolve([{ ...first, executionGeneration: 9 }]);
    await loading;

    expect(useResearchTasksStore.getState()).toMatchObject({
      tasks: [current], selectedTaskId: current.id, events: [activity], eventsLoading: false,
    });
  });

  it.each([false, true])("resolves tied timestamps using updates received during refresh: %s", async (liveUpdate) => {
    const running = { ...task("selected", "paper"), status: "running" as const, updatedAt: 2 };
    const review = { ...running, status: "awaiting_review" as const };
    const pending = deferred<ResearchTask[]>();
    vi.mocked(api.listResearchTasks).mockReturnValue(pending.promise);
    useResearchTasksStore.setState({ projectId: "paper", tasks: [running] });
    const loading = useResearchTasksStore.getState().refresh();
    if (liveUpdate) useResearchTasksStore.getState().receiveTask(review);
    pending.resolve([liveUpdate ? running : review]);
    await loading;

    expect(useResearchTasksStore.getState().tasks).toEqual([review]);
  });

  it("retains a task selected while creation is pending and returns the new task to its caller", async () => {
    const current = task("current", "paper");
    const created = task("created", "paper", 2);
    const pending = deferred<ResearchTask>();
    vi.mocked(api.createResearchTask).mockReturnValue(pending.promise);
    vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [], nextSequence: null });
    useResearchTasksStore.setState({ projectId: "paper", tasks: [current] });
    const creation = useResearchTasksStore.getState().createTask({
      projectId: "paper", title: created.title, prompt: created.prompt,
      runtimeId: created.runtimeId, agentId: created.agentId, modelId: created.modelId,
      skillIds: [], dependencyIds: [],
    });
    await useResearchTasksStore.getState().selectTask(current.id);
    pending.resolve(created);

    expect(await creation).toEqual(created);
    expect(useResearchTasksStore.getState()).toMatchObject({
      tasks: [created, current], selectedTaskId: current.id, action: null, error: null,
    });
  });

  it("keeps newer live status when a delayed action returns an older record from the same run", async () => {
    const selected = { ...task("selected", "paper"), status: "queued" as const, updatedAt: 1 };
    const running = { ...selected, status: "running" as const, updatedAt: 2 };
    const review = { ...selected, status: "awaiting_review" as const, updatedAt: 3 };
    const pending = deferred<ResearchTask>();
    vi.mocked(api.startResearchTask).mockReturnValue(pending.promise);
    useResearchTasksStore.setState({ projectId: "paper", tasks: [selected], selectedTaskId: selected.id });
    const starting = useResearchTasksStore.getState().startTask(selected.id);
    useResearchTasksStore.getState().receiveTask(review);
    pending.resolve(running);

    expect(await starting).toEqual(running);
    expect(useResearchTasksStore.getState()).toMatchObject({
      tasks: [review], selectedTaskId: selected.id, action: null, error: null,
    });
    const completed = { ...review, status: "completed" as const };
    useResearchTasksStore.getState().receiveTask(completed);
    expect(useResearchTasksStore.getState().tasks).toEqual([completed]);
  });
});
