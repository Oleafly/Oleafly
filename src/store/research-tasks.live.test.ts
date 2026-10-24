import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handlers: new Map<string, Handler>(),
  unlisteners: new Map<string, () => void>(),
  runExternalProjectMutation: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({ runExternalProjectMutation: native.runExternalProjectMutation }),
  },
}));

import {
  defaultBrief,
  type ResearchTask,
  type TaskTranscriptDelta,
  type TaskTranscriptEvent,
} from "@/lib/research-tasks";
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
    status: "running",
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
    finishedAt: null,
    brief: defaultBrief(`Complete ${id}`),
    recordSlug: `${id}-ab12`,
    recordDir: `research/${id}-ab12`,
    runAfter: null,
    keepRunningAfterQuit: false,
    owner: "app",
    phase: "working",
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

function text(sequence: number, value: string, kind: "text" | "reasoning" = "text"): TaskTranscriptEvent {
  return { taskId: "a", executionGeneration: 1, sequence, event: { kind, text: value }, createdAt: sequence };
}

function status(sequence: number): TaskTranscriptEvent {
  return {
    taskId: "a",
    executionGeneration: 1,
    sequence,
    event: { kind: "status", message: `Step ${sequence}` },
    createdAt: sequence,
  };
}

function delta(sequence: number, append: string, overrides: Partial<TaskTranscriptDelta> = {}): TaskTranscriptDelta {
  return { taskId: "a", executionGeneration: 1, sequence, kind: "text", append, createdAt: 100 + sequence, ...overrides };
}

/** Answers each command with its entry (an Error rejects); an empty page for transcripts. */
function answer(responses: Record<string, unknown> = {}): void {
  native.invoke.mockImplementation(async (command: string) => {
    if (command in responses) {
      const value = responses[command];
      if (value instanceof Error) throw value;
      return value;
    }
    if (command === "research_task_events") return { events: [], nextSequence: null };
    return undefined;
  });
}

function watchCalls(): unknown[] {
  return native.invoke.mock.calls.filter(([command]) => command === "research_task_watch").map(([, args]) => args);
}

function listened(): string[] {
  return native.listen.mock.calls.map(([name]) => String(name)).sort();
}

function emit(name: string, payload: unknown): void {
  const handler = native.handlers.get(name);
  if (!handler) throw new Error(`Nothing listens to ${name}.`);
  handler({ payload });
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

/** Calls of Array.prototype.sort while `work` runs. */
function sortsDuring(work: () => void): number {
  const sort = vi.spyOn(Array.prototype, "sort");
  try {
    work();
    return sort.mock.calls.length;
  } finally {
    sort.mockRestore();
  }
}

const store = () => useResearchTasksStore.getState();

beforeEach(async () => {
  native.invoke.mockReset();
  native.listen.mockReset();
  native.runExternalProjectMutation.mockReset();
  native.handlers.clear();
  native.unlisteners.clear();
  answer();
  native.listen.mockImplementation(async (name: string, handler: Handler) => {
    native.handlers.set(name, handler);
    const stop = vi.fn(() => {
      native.handlers.delete(name);
    });
    native.unlisteners.set(name, stop);
    return stop;
  });
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
  // Forget the task an earlier test left watched.
  await store().selectTask(null);
  native.invoke.mockClear();
});

describe("live transcript text", () => {
  it("applies a delta to an existing row without sorting the list", () => {
    const rows = [text(1, "Reading the"), status(2), text(3, "Plan")];
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: rows });

    const sorts = sortsDuring(() => {
      store().receiveDelta(delta(1, " sources"));
      store().receiveDelta(delta(3, " first"));
    });

    const events = store().events;
    expect(sorts).toBe(0);
    expect(events.map((row) => row.event)).toEqual([
      { kind: "text", text: "Reading the sources" },
      { kind: "status", message: "Step 2" },
      { kind: "text", text: "Plan first" },
    ]);
    expect(events[1]).toBe(rows[1]);
    expect(events[0]).toMatchObject({ sequence: 1, createdAt: 1 });
    expect(rows[0].event).toEqual({ kind: "text", text: "Reading the" });
  });

  it("appends reasoning text to its reasoning row", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [text(4, "Check", "reasoning")] });

    store().receiveDelta(delta(4, "ing the ledger", { kind: "reasoning" }));

    expect(store().events.map((row) => row.event)).toEqual([{ kind: "reasoning", text: "Checking the ledger" }]);
  });

  it("creates a row from a delta for a new sequence", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [status(1)] });

    store().receiveDelta(delta(2, "Found 12 papers", { kind: "reasoning", createdAt: 42 }));

    expect(store().events).toEqual([
      status(1),
      {
        taskId: "a",
        executionGeneration: 1,
        sequence: 2,
        event: { kind: "reasoning", text: "Found 12 papers" },
        createdAt: 42,
      },
    ]);
  });

  it("creates the first row of an empty transcript from a delta", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [] });

    store().receiveDelta(delta(1, "Hello"));

    expect(store().events).toEqual([
      { taskId: "a", executionGeneration: 1, sequence: 1, event: { kind: "text", text: "Hello" }, createdAt: 101 },
    ]);
  });

  it("puts a delta for a missing sequence between the rows around it", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [status(1), status(4)] });

    store().receiveDelta(delta(2, "Between"));

    expect(store().events.map((row) => row.sequence)).toEqual([1, 2, 4]);
    expect(store().events[1].event).toEqual({ kind: "text", text: "Between" });
  });

  it("leaves a row that is not text alone when a delta names its sequence", () => {
    const rows = [status(2)];
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: rows });

    store().receiveDelta(delta(2, "stray text"));

    expect(store().events).toBe(rows);
  });

  it("ignores deltas for another task, a task it doesn't know and an older run", () => {
    const rows = [text(1, "Plan")];
    useResearchTasksStore.setState({ tasks: [task("a", { executionGeneration: 2 })], selectedTaskId: "a", events: rows });

    store().receiveDelta(delta(1, " for b", { taskId: "b" }));
    store().receiveDelta(delta(1, " from run 1", { executionGeneration: 1 }));
    useResearchTasksStore.setState({ tasks: [] });
    store().receiveDelta(delta(1, " for a gone task", { executionGeneration: 2 }));

    expect(store().events).toBe(rows);
  });

  it("keeps live text that arrived while the first page loaded, without repeating any", async () => {
    let page: (value: unknown) => void = () => {};
    native.invoke.mockImplementation((command: string) =>
      command === "research_task_events"
        ? new Promise((resolve) => {
            page = resolve;
          })
        : Promise.resolve(undefined),
    );
    useResearchTasksStore.setState({ tasks: [task("a")] });

    const selecting = store().selectTask("a");
    // "Reading the sources." is 20 long; the window started listening at "the".
    store().receiveDelta(delta(1, "the sources.", { textLength: 20 }));
    expect(store().events[0]).toMatchObject({ textStart: 8, event: { text: "the sources." } });
    page({ events: [text(1, "Reading the sou")], nextSequence: null });
    await selecting;

    expect(store().events.map((row) => row.event)).toEqual([{ kind: "text", text: "Reading the sources." }]);
    expect(store().events[0].textStart).toBeUndefined();
  });

  it("adds only the part of an append the row doesn't have yet", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [text(1, "Reading the sou")] });

    store().receiveDelta(delta(1, "sources.", { textLength: 20 }));
    expect(store().events[0].event).toEqual({ kind: "text", text: "Reading the sources." });

    const rows = store().events;
    store().receiveDelta(delta(1, "sources.", { textLength: 20 }));
    expect(store().events).toBe(rows);
  });
});

describe("transcript rows", () => {
  it("inserts an out-of-order event at its sequence", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [status(1), status(3), status(5)] });

    const sorts = sortsDuring(() => {
      store().receiveEvent(status(4));
      store().receiveEvent(status(2));
      store().receiveEvent(status(0));
      store().receiveEvent(status(6));
    });

    expect(sorts).toBe(0);
    expect(store().events.map((row) => row.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("replaces a row in the middle that arrives again", () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [status(1), text(2, "Dra"), status(3)] });

    store().receiveEvent(text(2, "Draft ready"));

    expect(store().events.map((row) => row.event)).toEqual([
      { kind: "status", message: "Step 1" },
      { kind: "text", text: "Draft ready" },
      { kind: "status", message: "Step 3" },
    ]);
  });
});

describe("task list order", () => {
  it("puts new tasks in their place without sorting the list", () => {
    useResearchTasksStore.setState({ tasks: [task("c", { createdAt: 3 }), task("a", { createdAt: 1 })] });

    const sorts = sortsDuring(() => {
      store().receiveTask(task("b", { createdAt: 2 }));
      store().receiveTask(task("d", { createdAt: 4 }));
      store().receiveTask(task("z", { createdAt: 0 }));
    });

    expect(sorts).toBe(0);
    expect(store().tasks.map((value) => value.id)).toEqual(["d", "c", "b", "a", "z"]);
  });

  it("puts a task created at the same moment as another after it", () => {
    useResearchTasksStore.setState({ tasks: [task("first", { createdAt: 2 })] });

    store().receiveTask(task("second", { createdAt: 2 }));

    expect(store().tasks.map((value) => value.id)).toEqual(["first", "second"]);
  });

  it("updates a task in its place when its creation time is unchanged", () => {
    const tasks = [task("c", { createdAt: 3 }), task("b", { createdAt: 2 }), task("a", { createdAt: 1 })];
    const updated = task("b", { createdAt: 2, status: "awaiting_review", updatedAt: 5 });
    useResearchTasksStore.setState({ tasks });

    store().receiveTask(updated);

    expect(store().tasks).toEqual([tasks[0], updated, tasks[2]]);
    expect(store().tasks[1]).toBe(updated);
  });

  it("moves a task whose creation time changed to its new place", () => {
    useResearchTasksStore.setState({
      tasks: [task("c", { createdAt: 3 }), task("b", { createdAt: 2 }), task("a", { createdAt: 1 })],
    });

    store().receiveTask(task("a", { createdAt: 5, updatedAt: 2 }));

    expect(store().tasks.map((value) => value.id)).toEqual(["a", "c", "b"]);
  });
});

describe("retrying a task", () => {
  it.each([
    ["starts over without a mode", undefined, "fresh"],
    ["starts over when asked", "fresh", "fresh"],
    ["resumes in the same workspace when asked", "resume", "resume"],
  ] as const)("%s", async (_name, mode, sent) => {
    const failed = task("a", { status: "failed", finishedAt: 2, updatedAt: 2 });
    const queued = task("a", { status: "queued", finishedAt: null, updatedAt: 3 });
    useResearchTasksStore.setState({ tasks: [failed] });
    answer({ research_task_retry: queued });

    const pending = store().retryTask("a", mode);
    expect(store().action).toBe("a");
    const result = await pending;

    expect(native.invoke).toHaveBeenCalledWith("research_task_retry", { taskId: "a", mode: sent });
    expect(result).toEqual(queued);
    expect(store()).toMatchObject({ tasks: [queued], action: null, error: null });
  });

  it("shows why a retry failed and rethrows it", async () => {
    useResearchTasksStore.setState({ tasks: [task("a", { status: "failed" })] });
    answer({ research_task_retry: new Error("The saved workspace is gone. Start over instead.") });

    await expect(store().retryTask("a", "resume")).rejects.toThrow("The saved workspace is gone. Start over instead.");

    expect(store()).toMatchObject({ action: null, error: "The saved workspace is gone. Start over instead." });
    expect(store().tasks[0].status).toBe("failed");
  });
});

describe("approving a plan", () => {
  it("approves the plan as written", async () => {
    const ready = task("a", { status: "plan_ready", updatedAt: 2 });
    const approved = task("a", { status: "queued", planApproved: true, startRequested: true, updatedAt: 3 });
    useResearchTasksStore.setState({ tasks: [ready] });
    answer({ research_task_approve_plan: approved });

    const pending = store().approvePlan("a");
    expect(store().action).toBe("a");
    await expect(pending).resolves.toEqual(approved);

    expect(native.invoke).toHaveBeenCalledWith("research_task_approve_plan", { taskId: "a", editedPlan: null });
    expect(store()).toMatchObject({ tasks: [approved], action: null, error: null });
  });

  it("approves an edited plan", async () => {
    useResearchTasksStore.setState({ tasks: [task("a", { status: "plan_ready", updatedAt: 2 })] });
    answer({ research_task_approve_plan: task("a", { status: "queued", planApproved: true, updatedAt: 3 }) });

    await store().approvePlan("a", "- [ ] edited");

    expect(native.invoke).toHaveBeenCalledWith("research_task_approve_plan", {
      taskId: "a",
      editedPlan: "- [ ] edited",
    });
    expect(store().tasks[0]).toMatchObject({ status: "queued", planApproved: true });
  });

  it("shows why a plan approval failed and rethrows it", async () => {
    useResearchTasksStore.setState({ tasks: [task("a", { status: "plan_ready" })] });
    answer({ research_task_approve_plan: new Error("The plan file is missing.") });

    await expect(store().approvePlan("a", "- [ ] edited")).rejects.toThrow("The plan file is missing.");

    expect(store()).toMatchObject({ action: null, error: "The plan file is missing." });
    expect(store().tasks[0].status).toBe("plan_ready");
  });
});

describe("watching the selected task", () => {
  it("watches the selected task and unwatches on deselect", async () => {
    useResearchTasksStore.setState({ tasks: [task("a"), task("b")] });

    await store().selectTask("a");
    await store().selectTask("a");
    await store().selectTask("b");
    await store().selectTask(null);

    expect(watchCalls()).toEqual([{ taskId: "a" }, { taskId: "b" }, { taskId: null }]);
  });

  it("keeps loading the transcript when the backend can't watch tasks", async () => {
    answer({
      research_task_watch: new Error("Command research_task_watch not found"),
      research_task_events: { events: [text(1, "Hello")], nextSequence: null },
    });
    useResearchTasksStore.setState({ tasks: [task("a")] });

    await store().selectTask("a");
    await flush();

    expect(store().events.map((row) => row.event)).toEqual([{ kind: "text", text: "Hello" }]);
    expect(store().error).toBeNull();
  });
});

describe("live subscriptions", () => {
  it("mounts the Tauri listeners once for two subscribers", async () => {
    const [stopFirst, stopSecond] = await Promise.all([
      mountResearchTaskSubscriptions(),
      mountResearchTaskSubscriptions(),
    ]);

    expect(listened()).toEqual(["research-task-changed", "research-task-delta", "research-task-event"]);

    stopFirst();
    stopFirst();
    await flush();
    for (const stop of native.unlisteners.values()) expect(stop).not.toHaveBeenCalled();

    stopSecond();
    await flush();
    expect(native.unlisteners.size).toBe(3);
    for (const stop of native.unlisteners.values()) expect(stop).toHaveBeenCalledTimes(1);
  });

  it("listens again when a view mounts after the last one unmounted", async () => {
    const stop = await mountResearchTaskSubscriptions();
    stop();
    await flush();

    const again = await mountResearchTaskSubscriptions();

    expect(native.listen).toHaveBeenCalledTimes(6);
    again();
    await flush();
  });

  it("stops the listeners that started when one fails, so a retry listens once", async () => {
    const listen = native.listen.getMockImplementation();
    if (!listen) throw new Error("the listen mock has no implementation");
    native.listen.mockImplementation(async (name: string, handler: Handler) => {
      if (name === "research-task-delta") throw new Error("The event system is not ready.");
      return listen(name, handler);
    });

    await expect(mountResearchTaskSubscriptions()).rejects.toThrow("The event system is not ready.");
    expect(native.unlisteners.get("research-task-changed")).toHaveBeenCalledTimes(1);
    expect(native.handlers.size).toBe(0);

    native.listen.mockImplementation(listen);
    const stop = await mountResearchTaskSubscriptions();
    expect([...native.handlers.keys()].sort()).toEqual([
      "research-task-changed",
      "research-task-delta",
      "research-task-event",
    ]);
    stop();
    await flush();
  });

  it("routes live tasks, rows and deltas into the store", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")], selectedTaskId: "a", events: [] });
    const stop = await mountResearchTaskSubscriptions();

    emit("research-task-changed", { id: "b", projectId: "paper", status: "queued", createdAt: 2 });
    emit("research-task-event", text(1, "Read"));
    emit("research-task-delta", delta(1, "ing"));

    expect(store().tasks.map((value) => value.id)).toEqual(["b", "a"]);
    expect(store().tasks[0]).toMatchObject({ owner: "app", pendingApprovals: 0, brief: defaultBrief() });
    expect(store().events.map((row) => row.event)).toEqual([{ kind: "text", text: "Reading" }]);
    stop();
    await flush();
  });

  it("leaves PDF text requests to the app shell, so a research view is not needed to answer them", async () => {
    const stop = await mountResearchTaskSubscriptions();

    expect(native.handlers.has("research-pdf-text-request")).toBe(false);
    expect(native.listen.mock.calls.map(([name]) => name)).not.toContain("research-pdf-text-request");
    stop();
    await flush();
  });

  it("keeps the listeners when a view replaces another in the same commit", async () => {
    const first = await mountResearchTaskSubscriptions();
    native.listen.mockClear();

    // What React does when one rail panel replaces another: clean up, then mount.
    first();
    const second = mountResearchTaskSubscriptions();
    const stopSecond = await second;
    await flush();

    expect(native.listen).not.toHaveBeenCalled();
    for (const stop of native.unlisteners.values()) expect(stop).not.toHaveBeenCalled();
    stopSecond();
    await flush();
    for (const stop of native.unlisteners.values()) expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops watching when the last view unmounts", async () => {
    useResearchTasksStore.setState({ tasks: [task("a")] });
    const stop = await mountResearchTaskSubscriptions();
    await store().selectTask("a");
    native.invoke.mockClear();

    stop();
    await flush();

    expect(watchCalls()).toEqual([{ taskId: null }]);
  });

  it("lets a later view try again after the listeners failed to start", async () => {
    native.listen.mockImplementationOnce(async () => {
      throw new Error("The event system is not ready.");
    });

    await expect(mountResearchTaskSubscriptions()).rejects.toThrow("The event system is not ready.");
    const stop = await mountResearchTaskSubscriptions();

    expect(listened().filter((name) => name === "research-task-changed")).toHaveLength(2);
    stop();
    await flush();
  });

  it("fails every view that mounted while the listeners failed, then starts afresh", async () => {
    native.listen.mockImplementationOnce(async () => {
      throw new Error("The event system is not ready.");
    });

    const results = await Promise.allSettled([mountResearchTaskSubscriptions(), mountResearchTaskSubscriptions()]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    const stop = await mountResearchTaskSubscriptions();
    expect(listened().filter((name) => name === "research-task-changed")).toHaveLength(2);
    stop();
    await flush();
  });
});
