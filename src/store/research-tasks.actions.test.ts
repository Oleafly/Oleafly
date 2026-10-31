import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskTranscriptDelta, TaskTranscriptEvent } from "@/lib/research-tasks";

const fileMocks = vi.hoisted(() => ({
  runExternalProjectMutation: vi.fn(),
}));

vi.mock("@/lib/research-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-tasks")>()),
  acceptResearchTaskResult: vi.fn(),
  applyResearchTask: vi.fn(),
  approveResearchTaskPlan: vi.fn(),
  cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(),
  deleteResearchTask: vi.fn(),
  editResearchTask: vi.fn(),
  listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(async () => () => {}),
  listenForResearchTaskDeltas: vi.fn(async () => () => {}),
  listenForResearchTaskEvents: vi.fn(async () => () => {}),
  loadResearchTaskEvents: vi.fn(),
  loadResearchTaskEventsBefore: vi.fn(),
  retryResearchTask: vi.fn(),
  startResearchTask: vi.fn(),
  watchResearchTask: vi.fn(async () => {}),
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
    brief: api.defaultBrief(`Complete ${id}`),
    recordSlug: "",
    recordDir: "",
    runAfter: null,
    keepRunningAfterQuit: false,
    owner: "app",
    phase: null,
    planApproved: false,
    stopReason: null,
    evidence: null,
    pendingApprovals: 0,
    activeMs: 0,
    todos: [],
    reclaimRequested: false,
    resumedFrom: null,
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
    eventsPreviousSequence: null,
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

  it("opens the detail of the task it already shows without reloading it", async () => {
    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({ events: [], nextSequence: null });
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: null });
    useResearchTasksStore.getState().openTaskDetail("a");
    await vi.waitFor(() => expect(useResearchTasksStore.getState().eventsLoading).toBe(false));

    useResearchTasksStore.getState().openTaskDetail("a", "review");

    expect(useResearchTasksStore.getState()).toMatchObject({ detailOpen: true, detailTab: "review" });
    expect(api.loadResearchTaskEventsBefore).toHaveBeenCalledOnce();
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
  beforeEach(() => useResearchTasksStore.setState({ detailOpen: true }));

  it("loads no activity for a task that has not run or is unknown", async () => {
    useResearchTasksStore.setState({ tasks: [task("draft", { executionGeneration: 0 })] });

    await useResearchTasksStore.getState().selectTask("draft");
    expect(useResearchTasksStore.getState()).toMatchObject({ selectedTaskId: "draft", eventsLoading: false });

    await useResearchTasksStore.getState().selectTask("unknown");
    expect(useResearchTasksStore.getState().eventsLoading).toBe(false);

    await useResearchTasksStore.getState().selectTask(null);
    expect(useResearchTasksStore.getState()).toMatchObject({ selectedTaskId: null, eventsLoading: false });
    expect(api.loadResearchTaskEventsBefore).not.toHaveBeenCalled();
  });

  it("shows why the activity could not load", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEventsBefore).mockRejectedValue(new Error("log missing"));

    await useResearchTasksStore.getState().selectTask("a");

    expect(useResearchTasksStore.getState()).toMatchObject({ eventsLoading: false, error: "log missing" });
  });

  it("drops an activity failure for a task that is no longer selected", async () => {
    useResearchTasksStore.setState({ tasks: [task("a"), task("b")] });
    let fail: (error: Error) => void = () => {};
    vi.mocked(api.loadResearchTaskEventsBefore).mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));

    const pending = useResearchTasksStore.getState().selectTask("a");
    useResearchTasksStore.setState({ selectedTaskId: "b" });
    fail(new Error("late"));
    await pending;

    expect(useResearchTasksStore.getState().error).toBeNull();
  });

  it("loads the newest activity first and older pages before it", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEventsBefore)
      .mockResolvedValueOnce({ events: [event("a", 3), event("a", 4)], nextSequence: null, previousSequence: 3 })
      .mockResolvedValueOnce({
        events: [event("a", 1), event("a", 2), event("a", 9, 2)],
        nextSequence: null,
        previousSequence: null,
      });

    await useResearchTasksStore.getState().selectTask("a");
    expect(api.loadResearchTaskEventsBefore).toHaveBeenLastCalledWith("a", 1, api.NEWEST_EVENTS);
    expect(useResearchTasksStore.getState().eventsPreviousSequence).toBe(3);
    await useResearchTasksStore.getState().loadMoreEvents();

    expect(api.loadResearchTaskEventsBefore).toHaveBeenLastCalledWith("a", 1, 3);
    expect(useResearchTasksStore.getState().events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(useResearchTasksStore.getState()).toMatchObject({ eventsPreviousSequence: null, eventsLoading: false });

    await useResearchTasksStore.getState().loadMoreEvents();
    expect(api.loadResearchTaskEventsBefore).toHaveBeenCalledTimes(2);
  });

  it("loads no older pages while loading or without a selected task", async () => {
    await useResearchTasksStore.getState().loadMoreEvents();
    useResearchTasksStore.setState({ selectedTaskId: "gone", eventsPreviousSequence: 2 });
    await useResearchTasksStore.getState().loadMoreEvents();
    useResearchTasksStore.setState({ tasks: [task("gone")], eventsLoading: true });
    await useResearchTasksStore.getState().loadMoreEvents();

    expect(api.loadResearchTaskEventsBefore).not.toHaveBeenCalled();
  });

  it("shows why an older activity page could not load", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", eventsPreviousSequence: 5 });
    vi.mocked(api.loadResearchTaskEventsBefore).mockRejectedValue(new Error("page lost"));

    await useResearchTasksStore.getState().loadMoreEvents();

    expect(useResearchTasksStore.getState()).toMatchObject({ eventsLoading: false, error: "page lost" });
  });

  it("drops an older page that arrives after the selection changed", async () => {
    useResearchTasksStore.setState({ tasks: [task("a"), task("b")], selectedTaskId: "a", eventsPreviousSequence: 5 });
    let resolve: (page: { events: TaskTranscriptEvent[]; nextSequence: number | null }) => void = () => {};
    vi.mocked(api.loadResearchTaskEventsBefore).mockReturnValueOnce(new Promise((done) => (resolve = done)));

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
    ["approvePlan", api.approveResearchTaskPlan],
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
    ["approvePlan", api.approveResearchTaskPlan],
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
    ["approvePlan", api.approveResearchTaskPlan],
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
    ["approvePlan", api.approveResearchTaskPlan],
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
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", detailOpen: true });

    const unmount = await mountResearchTaskSubscriptions();
    onTask(task("b", { createdAt: 2 }));
    onEvent(event("a", 1));

    expect(useResearchTasksStore.getState().tasks.map((t) => t.id)).toEqual(["b", "a"]);
    expect(useResearchTasksStore.getState().events).toHaveLength(1);

    unmount();
    await Promise.resolve();
    expect(unlistenTasks).toHaveBeenCalledTimes(1);
    expect(unlistenEvents).toHaveBeenCalledTimes(1);
  });

  it("routes live text deltas into the selected task's transcript", async () => {
    let onDelta: (value: TaskTranscriptDelta) => void = () => {};
    const unlistenDeltas = vi.fn();
    vi.mocked(api.listenForResearchTaskDeltas).mockImplementation(async (handler) => {
      onDelta = handler;
      return unlistenDeltas;
    });
    useResearchTasksStore.setState({
      tasks: [task("a")],
      selectedTaskId: "a",
      detailOpen: true,
      events: [{ taskId: "a", executionGeneration: 1, sequence: 1, event: { kind: "text", text: "Read" }, createdAt: 1 }],
    });

    const unmount = await mountResearchTaskSubscriptions();
    onDelta({ taskId: "a", executionGeneration: 1, sequence: 1, kind: "text", append: "ing", createdAt: 2 });

    expect(useResearchTasksStore.getState().events.map((e) => e.event)).toEqual([{ kind: "text", text: "Reading" }]);
    unmount();
    await Promise.resolve();
    expect(unlistenDeltas).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("actions on different tasks", () => {
  it("keeps a slow cancel busy while another task's action finishes", async () => {
    const slowCancel = deferred<ResearchTask>();
    const a = task("a", { status: "running" });
    const b = task("b", { status: "queued" });
    vi.mocked(api.cancelResearchTask).mockReturnValue(slowCancel.promise);
    vi.mocked(api.startResearchTask).mockResolvedValue({ ...b, status: "running", updatedAt: 2 });
    useResearchTasksStore.setState({ tasks: [a, b], pendingActions: [] });

    const cancelling = useResearchTasksStore.getState().cancelTask("a");
    await useResearchTasksStore.getState().startTask("b");

    expect(useResearchTasksStore.getState().pendingActions).toEqual(["a"]);
    expect(useResearchTasksStore.getState().action).toBe("a");
    expect(useResearchTasksStore.getState().tasks.find((value) => value.id === "b")?.status).toBe("running");

    slowCancel.resolve({ ...a, status: "cancelled", updatedAt: 3 });
    await cancelling;

    expect(useResearchTasksStore.getState().tasks.find((value) => value.id === "a")?.status).toBe("cancelled");
    expect(useResearchTasksStore.getState()).toMatchObject({ action: null, pendingActions: [] });
  });

  it("lets a newer action on the same task replace the busy state of the older one", async () => {
    const first = deferred<ResearchTask>();
    const second = deferred<ResearchTask>();
    const a = task("a", { status: "failed" });
    vi.mocked(api.retryResearchTask).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    useResearchTasksStore.setState({ tasks: [a], pendingActions: [] });

    const older = useResearchTasksStore.getState().retryTask("a", "resume");
    const newer = useResearchTasksStore.getState().retryTask("a", "fresh");
    first.resolve({ ...a, status: "queued", updatedAt: 2 });
    await older;

    expect(useResearchTasksStore.getState().pendingActions).toEqual(["a"]);
    second.resolve({ ...a, status: "running", updatedAt: 3 });
    await newer;
    expect(useResearchTasksStore.getState().pendingActions).toEqual([]);
  });

  it("clears every busy state when another project opens", async () => {
    const slow = deferred<ResearchTask>();
    vi.mocked(api.cancelResearchTask).mockReturnValue(slow.promise);
    vi.mocked(api.listResearchTasks).mockResolvedValue([]);
    useResearchTasksStore.setState({ tasks: [task("a", { status: "running" })], pendingActions: [] });

    const cancelling = useResearchTasksStore.getState().cancelTask("a");
    await useResearchTasksStore.getState().bindProject("other");

    expect(useResearchTasksStore.getState()).toMatchObject({ action: null, pendingActions: [] });
    slow.resolve({ ...task("a"), status: "cancelled" });
    await cancelling;
    expect(useResearchTasksStore.getState().tasks).toEqual([]);
  });
});

describe("refresh and the open task's dialog", () => {
  beforeEach(async () => {
    await useResearchTasksStore.getState().selectTask(null);
    vi.mocked(api.watchResearchTask).mockClear();
  });

  it("drops a task that was deleted elsewhere and keeps one that changed while loading", async () => {
    const kept = task("kept");
    const gone = task("gone");
    useResearchTasksStore.setState({ tasks: [kept, gone] });
    vi.mocked(api.listResearchTasks).mockResolvedValue([kept]);

    await useResearchTasksStore.getState().refresh();

    expect(useResearchTasksStore.getState().tasks.map((value) => value.id)).toEqual(["kept"]);
  });

  it("keeps a task a live event updated while the list was loading", async () => {
    const pending = deferred<ResearchTask[]>();
    const kept = task("kept");
    const live = { ...task("live", { status: "running" }), updatedAt: 1 };
    useResearchTasksStore.setState({ tasks: [kept, live] });
    vi.mocked(api.listResearchTasks).mockReturnValue(pending.promise);

    const loading = useResearchTasksStore.getState().refresh();
    useResearchTasksStore.getState().receiveTask({ ...live, status: "awaiting_review", updatedAt: 2 });
    pending.resolve([kept]);
    await loading;

    expect(useResearchTasksStore.getState().tasks.map((value) => value.id).sort()).toEqual(["kept", "live"]);
  });

  it("clears the selection and closes the dialog when the selected task vanished", async () => {
    const kept = task("kept");
    const gone = task("gone");
    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({ events: [event("gone", 1)], nextSequence: null });
    useResearchTasksStore.setState({ tasks: [kept, gone] });
    useResearchTasksStore.getState().openTaskDetail("gone", "review");
    await vi.waitFor(() => expect(useResearchTasksStore.getState().events).toHaveLength(1));
    vi.mocked(api.listResearchTasks).mockResolvedValue([kept]);

    await useResearchTasksStore.getState().refresh();

    expect(useResearchTasksStore.getState()).toMatchObject({
      selectedTaskId: null,
      detailOpen: false,
      detailTab: null,
      events: [],
      eventsPreviousSequence: null,
    });
    expect(api.watchResearchTask).toHaveBeenLastCalledWith(null);
  });

  it("stops watching when the dialog closes and loads the task again when it opens", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({ events: [event("a", 1)], nextSequence: null });
    useResearchTasksStore.getState().openTaskDetail("a");
    await vi.waitFor(() => expect(useResearchTasksStore.getState().events).toHaveLength(1));
    expect(api.loadResearchTaskEventsBefore).toHaveBeenCalledTimes(1);

    useResearchTasksStore.getState().setDetailOpen(false);
    expect(api.watchResearchTask).toHaveBeenLastCalledWith(null);

    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({
      events: [event("a", 1), event("a", 2)],
      nextSequence: null,
    });
    useResearchTasksStore.getState().openTaskDetail("a", "activity");
    await vi.waitFor(() => expect(useResearchTasksStore.getState().events).toHaveLength(2));
    expect(api.watchResearchTask).toHaveBeenLastCalledWith("a");
    expect(api.loadResearchTaskEventsBefore).toHaveBeenCalledTimes(2);
  });

  it("stops watching the old project's task when another project opens", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({ events: [], nextSequence: null });
    vi.mocked(api.listResearchTasks).mockResolvedValue([]);
    useResearchTasksStore.getState().openTaskDetail("a");
    expect(api.watchResearchTask).toHaveBeenLastCalledWith("a");

    await useResearchTasksStore.getState().bindProject("other");

    expect(api.watchResearchTask).toHaveBeenLastCalledWith(null);
  });

  it("neither loads nor streams a task selected while no dialog shows it", async () => {
    useResearchTasksStore.setState({ tasks: [task("a", { status: "running" })] });
    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({ events: [event("a", 1)], nextSequence: null });

    await useResearchTasksStore.getState().selectTask("a");
    useResearchTasksStore.getState().receiveEvent(event("a", 2));
    useResearchTasksStore.getState().receiveDelta({
      taskId: "a",
      executionGeneration: 1,
      sequence: 3,
      kind: "text",
      append: "Reading",
      createdAt: 3,
    });

    expect(api.loadResearchTaskEventsBefore).not.toHaveBeenCalled();
    expect(api.watchResearchTask).not.toHaveBeenCalledWith("a");
    expect(useResearchTasksStore.getState()).toMatchObject({ selectedTaskId: "a", events: [], eventsLoading: false });

    useResearchTasksStore.getState().openTaskDetail("a");
    await vi.waitFor(() => expect(useResearchTasksStore.getState().events).toHaveLength(1));
    expect(api.watchResearchTask).toHaveBeenLastCalledWith("a");
  });

  it("doesn't watch the task again when a new run starts while the dialog is closed", async () => {
    const running = task("a", { status: "running" });
    useResearchTasksStore.setState({ tasks: [running] });
    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({ events: [], nextSequence: null });
    useResearchTasksStore.getState().openTaskDetail("a");
    useResearchTasksStore.getState().setDetailOpen(false);
    vi.mocked(api.watchResearchTask).mockClear();
    vi.mocked(api.loadResearchTaskEventsBefore).mockClear();

    useResearchTasksStore.getState().receiveTask({ ...running, executionGeneration: 2, updatedAt: 2 });
    await Promise.resolve();

    expect(api.watchResearchTask).not.toHaveBeenCalledWith("a");
    expect(api.loadResearchTaskEventsBefore).not.toHaveBeenCalled();
  });

  it("loads the newest page first, so the latest activity shows and meets the live rows", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({
      events: [event("a", 3999), event("a", 4000)],
      nextSequence: null,
      previousSequence: 3999,
    });

    useResearchTasksStore.getState().openTaskDetail("a");
    await vi.waitFor(() => expect(useResearchTasksStore.getState().events).toHaveLength(2));

    expect(api.loadResearchTaskEventsBefore).toHaveBeenCalledWith("a", 1, api.NEWEST_EVENTS);
    expect(api.loadResearchTaskEventsBefore).toHaveBeenCalledTimes(1);
    expect(useResearchTasksStore.getState().eventsPreviousSequence).toBe(3999);
  });

  it("keeps where to page back from when an older page fails", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    vi.mocked(api.loadResearchTaskEventsBefore)
      .mockResolvedValueOnce({ events: [event("a", 5)], nextSequence: null, previousSequence: 5 })
      .mockRejectedValue(new Error("page lost"));

    useResearchTasksStore.getState().openTaskDetail("a");
    await vi.waitFor(() => expect(useResearchTasksStore.getState().events).toHaveLength(1));
    await useResearchTasksStore.getState().loadMoreEvents();

    expect(useResearchTasksStore.getState()).toMatchObject({ error: "page lost", eventsPreviousSequence: 5 });
  });
});

describe("a reloaded page", () => {
  it("tells the backend it watches no task, so the task the previous page watched stops streaming", async () => {
    vi.resetModules();
    const freshApi = await import("@/lib/research-tasks");
    const { useResearchTasksStore: fresh } = await import("./research-tasks");

    fresh.getState().setDetailOpen(false);

    expect(freshApi.watchResearchTask).toHaveBeenCalledWith(null);
  });
});
