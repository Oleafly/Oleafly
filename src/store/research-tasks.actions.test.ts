import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskTranscriptEvent } from "@/lib/research-tasks";

const fileMocks = vi.hoisted(() => ({
  runExternalProjectMutation: vi.fn(),
}));

vi.mock("@/lib/research-tasks", () => ({
  acceptResearchTaskResult: vi.fn(),
  applyResearchTask: vi.fn(),
  cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(),
  deleteResearchTask: vi.fn(),
  editResearchTask: vi.fn(),
  listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(),
  listenForResearchTaskEvents: vi.fn(),
  loadResearchTaskEvents: vi.fn(),
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

import errors from "@/i18n/locales/en/errors.json" with { type: "json" };
import * as api from "@/lib/research-tasks";
import { mountResearchTaskSubscriptions, useResearchTasksStore } from "./research-tasks";

function task(id: string, overrides: Partial<ResearchTask> = {}): ResearchTask {
  return {
    id,
    projectId: "paper",
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
    createdAt: 1,
    updatedAt: 1,
    startedAt: 1,
    finishedAt: 1,
    ...overrides,
  };
}

function event(taskId: string, sequence: number, executionGeneration = 1): TaskTranscriptEvent {
  return {
    taskId,
    executionGeneration,
    sequence,
    event: { kind: "status", message: `Step ${sequence}` },
    createdAt: sequence,
  };
}

const coded = (code: string) => `@oleafly/error:${JSON.stringify({ code, params: {}, detail: null })}`;

beforeEach(() => {
  vi.resetAllMocks();
  useResearchTasksStore.setState({
    projectId: "paper",
    tasks: [],
    selectedTaskId: null,
    events: [],
    eventsNextSequence: null,
    loading: false,
    eventsLoading: false,
    action: null,
    error: null,
    detailOpen: false,
    detailTab: null,
    composerDrafts: {},
  });
});

describe("research task panel state", () => {
  it("keeps composer drafts per key and forgets a cleared one", () => {
    const draft = {
      starterId: "lit",
      title: "Survey",
      prompt: "Find papers",
      agentKey: "builtin",
      skillIds: [],
      dependencyIds: [],
    };
    const store = useResearchTasksStore.getState();

    store.saveComposerDraft("new", draft);
    store.saveComposerDraft("other", { ...draft, title: "Other" });
    store.clearComposerDraft("new");
    const before = useResearchTasksStore.getState();
    store.clearComposerDraft("missing");

    expect(useResearchTasksStore.getState().composerDrafts).toEqual({ other: { ...draft, title: "Other" } });
    expect(useResearchTasksStore.getState()).toBe(before);
  });

  it("switches the detail tab and reopens the detail", () => {
    useResearchTasksStore.getState().setDetailTab("output");
    useResearchTasksStore.getState().setDetailOpen(true);

    expect(useResearchTasksStore.getState()).toMatchObject({ detailTab: "output", detailOpen: true });
  });

  it("opens the detail of the task that is already selected without reloading it", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a" });

    useResearchTasksStore.getState().openTaskDetail("a");

    expect(useResearchTasksStore.getState()).toMatchObject({ detailOpen: true, detailTab: null });
    expect(api.loadResearchTaskEvents).not.toHaveBeenCalled();
  });

  it("clears an error", () => {
    useResearchTasksStore.setState({ error: "boom" });
    useResearchTasksStore.getState().clearError();
    expect(useResearchTasksStore.getState().error).toBeNull();
  });
});

describe("loading research tasks", () => {
  it("binds no project without listing tasks", async () => {
    await useResearchTasksStore.getState().bindProject(null);

    expect(useResearchTasksStore.getState()).toMatchObject({ projectId: null, loading: false });
    expect(api.listResearchTasks).not.toHaveBeenCalled();
  });

  it("shows why the task list could not load", async () => {
    vi.mocked(api.listResearchTasks).mockRejectedValue(new Error("database locked"));

    await useResearchTasksStore.getState().bindProject("paper");

    expect(useResearchTasksStore.getState()).toMatchObject({ loading: false, error: "database locked" });
  });

  it("refreshes the open project's tasks, newest first, and skips other projects' tasks", async () => {
    vi.mocked(api.listResearchTasks).mockResolvedValue([
      task("old", { createdAt: 1 }),
      task("new", { createdAt: 5 }),
      task("foreign", { projectId: "elsewhere" }),
    ]);

    await useResearchTasksStore.getState().refresh();

    expect(useResearchTasksStore.getState().tasks.map((t) => t.id)).toEqual(["new", "old"]);
    expect(useResearchTasksStore.getState().loading).toBe(false);
  });

  it("shows a translated error when a refresh fails with a coded error", async () => {
    vi.mocked(api.listResearchTasks).mockRejectedValue(coded("project.not_found"));

    await useResearchTasksStore.getState().refresh();

    expect(useResearchTasksStore.getState()).toMatchObject({ loading: false, error: errors.project.not_found });
  });

  it("does not refresh without an open project", async () => {
    useResearchTasksStore.setState({ projectId: null });

    await useResearchTasksStore.getState().refresh();

    expect(api.listResearchTasks).not.toHaveBeenCalled();
  });

  it("drops a refresh failure once another project is open", async () => {
    let fail: (error: Error) => void = () => {};
    vi.mocked(api.listResearchTasks).mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));

    const pending = useResearchTasksStore.getState().refresh();
    useResearchTasksStore.setState({ projectId: "other" });
    fail(new Error("late"));
    await pending;

    expect(useResearchTasksStore.getState().error).toBeNull();
  });
});

describe("research task activity", () => {
  it("loads no activity for a task that has not run or is unknown", async () => {
    useResearchTasksStore.setState({ tasks: [task("draft", { executionGeneration: 0 })] });

    await useResearchTasksStore.getState().selectTask("draft");
    expect(useResearchTasksStore.getState()).toMatchObject({ selectedTaskId: "draft", eventsLoading: false });

    await useResearchTasksStore.getState().selectTask("unknown");
    expect(useResearchTasksStore.getState().eventsLoading).toBe(false);

    await useResearchTasksStore.getState().selectTask(null);
    expect(useResearchTasksStore.getState()).toMatchObject({ selectedTaskId: null, eventsLoading: false });
    expect(api.loadResearchTaskEvents).not.toHaveBeenCalled();
  });

  it("shows why the activity could not load", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEvents).mockRejectedValue(new Error("log missing"));

    await useResearchTasksStore.getState().selectTask("a");

    expect(useResearchTasksStore.getState()).toMatchObject({ eventsLoading: false, error: "log missing" });
  });

  it("drops an activity failure for a task that is no longer selected", async () => {
    useResearchTasksStore.setState({ tasks: [task("a"), task("b")] });
    let fail: (error: Error) => void = () => {};
    vi.mocked(api.loadResearchTaskEvents).mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));

    const pending = useResearchTasksStore.getState().selectTask("a");
    useResearchTasksStore.setState({ selectedTaskId: "b" });
    fail(new Error("late"));
    await pending;

    expect(useResearchTasksStore.getState().error).toBeNull();
  });

  it("loads older activity pages after the first one", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEvents)
      .mockResolvedValueOnce({ events: [event("a", 3), event("a", 4)], nextSequence: 3 })
      .mockResolvedValueOnce({ events: [event("a", 1), event("a", 2), event("a", 9, 2)], nextSequence: null });

    await useResearchTasksStore.getState().selectTask("a");
    await useResearchTasksStore.getState().loadMoreEvents();

    expect(api.loadResearchTaskEvents).toHaveBeenLastCalledWith("a", 1, 3);
    expect(useResearchTasksStore.getState().events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(useResearchTasksStore.getState()).toMatchObject({ eventsNextSequence: null, eventsLoading: false });

    await useResearchTasksStore.getState().loadMoreEvents();
    expect(api.loadResearchTaskEvents).toHaveBeenCalledTimes(2);
  });

  it("loads no older pages while loading or without a selected task", async () => {
    await useResearchTasksStore.getState().loadMoreEvents();
    useResearchTasksStore.setState({ selectedTaskId: "gone", eventsNextSequence: 2 });
    await useResearchTasksStore.getState().loadMoreEvents();
    useResearchTasksStore.setState({ tasks: [task("gone")], eventsLoading: true });
    await useResearchTasksStore.getState().loadMoreEvents();

    expect(api.loadResearchTaskEvents).not.toHaveBeenCalled();
  });

  it("shows why an older activity page could not load", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", eventsNextSequence: 5 });
    vi.mocked(api.loadResearchTaskEvents).mockRejectedValue(new Error("page lost"));

    await useResearchTasksStore.getState().loadMoreEvents();

    expect(useResearchTasksStore.getState()).toMatchObject({ eventsLoading: false, error: "page lost" });
  });

  it("drops an older page that arrives after the selection changed", async () => {
    useResearchTasksStore.setState({ tasks: [task("a"), task("b")], selectedTaskId: "a", eventsNextSequence: 5 });
    let resolve: (page: { events: TaskTranscriptEvent[]; nextSequence: number | null }) => void = () => {};
    vi.mocked(api.loadResearchTaskEvents).mockReturnValueOnce(new Promise((done) => (resolve = done)));

    const pending = useResearchTasksStore.getState().loadMoreEvents();
    useResearchTasksStore.setState({ selectedTaskId: "b" });
    resolve({ events: [event("a", 1)], nextSequence: null });
    await pending;

    expect(useResearchTasksStore.getState().events).toEqual([]);
  });

  it("ignores live activity for a task that is not selected or from another run", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a" });

    useResearchTasksStore.getState().receiveEvent(event("b", 1));
    useResearchTasksStore.getState().receiveEvent(event("a", 1, 7));

    expect(useResearchTasksStore.getState().events).toEqual([]);
  });
});

describe("research task actions", () => {
  it("deletes the selected task and closes its detail", async () => {
    useResearchTasksStore.setState({
      tasks: [task("a"), task("b")],
      selectedTaskId: "a",
      detailOpen: true,
      detailTab: "review",
      events: [event("a", 1)],
    });

    await useResearchTasksStore.getState().deleteTask("a");

    expect(useResearchTasksStore.getState()).toMatchObject({
      action: null,
      selectedTaskId: null,
      events: [],
      detailOpen: false,
      detailTab: null,
    });
    expect(useResearchTasksStore.getState().tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("deletes another task and keeps the selection", async () => {
    useResearchTasksStore.setState({ tasks: [task("a"), task("b")], selectedTaskId: "a", detailOpen: true });

    await useResearchTasksStore.getState().deleteTask("b");

    expect(useResearchTasksStore.getState()).toMatchObject({ selectedTaskId: "a", detailOpen: true });
  });

  it("shows and rethrows a failed delete", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.deleteResearchTask).mockRejectedValue(new Error("in use"));

    await expect(useResearchTasksStore.getState().deleteTask("a")).rejects.toThrow("in use");

    expect(useResearchTasksStore.getState()).toMatchObject({ action: null, error: "in use" });
    expect(useResearchTasksStore.getState().tasks).toHaveLength(1);
  });

  it("leaves the list alone when a delete finishes after the project changed", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    let finish: () => void = () => {};
    vi.mocked(api.deleteResearchTask).mockReturnValue(new Promise<void>((done) => (finish = done)));

    const pending = useResearchTasksStore.getState().deleteTask("a");
    vi.mocked(api.listResearchTasks).mockResolvedValue([task("x", { projectId: "other" })]);
    await useResearchTasksStore.getState().bindProject("other");
    finish();
    await pending;

    expect(useResearchTasksStore.getState().tasks.map((t) => t.id)).toEqual(["x"]);
  });

  it.each([
    ["startTask", api.startResearchTask],
    ["cancelTask", api.cancelResearchTask],
    ["retryTask", api.retryResearchTask],
    ["acceptTask", api.acceptResearchTaskResult],
  ] as const)("%s stores the updated task", async (action, call) => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(call).mockResolvedValue(task("a", { status: "running", updatedAt: 2 }));

    const result = await useResearchTasksStore.getState()[action]("a");

    expect(result.status).toBe("running");
    expect(useResearchTasksStore.getState().tasks[0].status).toBe("running");
    expect(useResearchTasksStore.getState().action).toBeNull();
  });

  it.each([
    ["startTask", api.startResearchTask],
    ["cancelTask", api.cancelResearchTask],
    ["retryTask", api.retryResearchTask],
    ["acceptTask", api.acceptResearchTaskResult],
  ] as const)("%s shows and rethrows a failure", async (action, call) => {
    vi.mocked(call).mockRejectedValue(new Error(`${action} failed`));

    await expect(useResearchTasksStore.getState()[action]("a")).rejects.toThrow(`${action} failed`);

    expect(useResearchTasksStore.getState()).toMatchObject({ action: null, error: `${action} failed` });
  });

  it.each([
    ["startTask", api.startResearchTask],
    ["cancelTask", api.cancelResearchTask],
    ["retryTask", api.retryResearchTask],
    ["acceptTask", api.acceptResearchTaskResult],
  ] as const)("%s returns a late result without storing it after the project changed", async (action, call) => {
    let finish: (value: ResearchTask) => void = () => {};
    vi.mocked(call).mockReturnValue(new Promise((done) => (finish = done)));
    vi.mocked(api.listResearchTasks).mockResolvedValue([]);

    const pending = useResearchTasksStore.getState()[action]("a");
    await useResearchTasksStore.getState().bindProject("other");
    finish(task("a"));

    await expect(pending).resolves.toMatchObject({ id: "a" });
    expect(useResearchTasksStore.getState().tasks).toEqual([]);
  });

  it.each([
    ["startTask", api.startResearchTask],
    ["cancelTask", api.cancelResearchTask],
    ["retryTask", api.retryResearchTask],
    ["acceptTask", api.acceptResearchTaskResult],
  ] as const)("%s keeps quiet about a failure after the project changed", async (action, call) => {
    let fail: (error: Error) => void = () => {};
    vi.mocked(call).mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    vi.mocked(api.listResearchTasks).mockResolvedValue([]);

    const pending = useResearchTasksStore.getState()[action]("a");
    await useResearchTasksStore.getState().bindProject("other");
    fail(new Error("late"));

    await expect(pending).rejects.toThrow("late");
    expect(useResearchTasksStore.getState().error).toBeNull();
  });

  it("refuses to apply changes without an open project", async () => {
    useResearchTasksStore.setState({ projectId: null });

    await expect(useResearchTasksStore.getState().applyTask("a", ["main.tex"])).rejects.toThrow(
      "Open a project before applying task changes.",
    );
    expect(fileMocks.runExternalProjectMutation).not.toHaveBeenCalled();
  });

  it("edits a task and shows a failed edit", async () => {
    vi.mocked(api.editResearchTask).mockResolvedValueOnce(task("a", { title: "Renamed", updatedAt: 3 }));
    await useResearchTasksStore.getState().editTask("a", { title: "Renamed" } as never);
    expect(useResearchTasksStore.getState().tasks[0].title).toBe("Renamed");

    vi.mocked(api.createResearchTask).mockRejectedValueOnce(new Error("invalid draft"));
    await expect(useResearchTasksStore.getState().createTask({} as never)).rejects.toThrow("invalid draft");
    expect(useResearchTasksStore.getState().error).toBe("invalid draft");
  });

  it("ignores updates for other projects and older updates of a task", () => {
    useResearchTasksStore.setState({ tasks: [task("a", { updatedAt: 5 })] });

    useResearchTasksStore.getState().receiveTask(task("x", { projectId: "other" }));
    useResearchTasksStore.getState().receiveTask(task("a", { updatedAt: 4, status: "failed" }));
    useResearchTasksStore.getState().receiveTask(task("a", { executionGeneration: 0, updatedAt: 9 }));

    expect(useResearchTasksStore.getState().tasks).toEqual([task("a", { updatedAt: 5 })]);
  });
});

describe("research task subscriptions", () => {
  it("routes live task and activity updates into the store until unsubscribed", async () => {
    const unlistenTasks = vi.fn();
    const unlistenEvents = vi.fn();
    let onTask: (value: ResearchTask) => void = () => {};
    let onEvent: (value: TaskTranscriptEvent) => void = () => {};
    vi.mocked(api.listenForResearchTaskChanges).mockImplementation(async (handler) => {
      onTask = handler;
      return unlistenTasks;
    });
    vi.mocked(api.listenForResearchTaskEvents).mockImplementation(async (handler) => {
      onEvent = handler;
      return unlistenEvents;
    });
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a" });

    const unmount = await mountResearchTaskSubscriptions();
    onTask(task("b", { createdAt: 2 }));
    onEvent(event("a", 1));

    expect(useResearchTasksStore.getState().tasks.map((t) => t.id)).toEqual(["b", "a"]);
    expect(useResearchTasksStore.getState().events).toHaveLength(1);

    unmount();
    expect(unlistenTasks).toHaveBeenCalledTimes(1);
    expect(unlistenEvents).toHaveBeenCalledTimes(1);
  });
});
