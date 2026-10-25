import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { event: string; id: number; payload: unknown }) => void;

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handlers: new Map<string, Handler>(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

import {
  acceptResearchTaskResult,
  applyResearchTask,
  approveResearchTaskPlan,
  cancelResearchTask,
  cancelResearchTaskRun,
  createResearchTask,
  decideResearchTaskApproval,
  defaultBrief,
  deleteResearchTask,
  editResearchTask,
  listenForResearchAttention,
  listenForResearchTaskChanges,
  listenForResearchTaskDeltas,
  listenForResearchTaskEvents,
  listResearchTaskApprovals,
  listResearchTasks,
  loadResearchAttention,
  loadResearchTaskEvents,
  loadResearchTaskEventsBefore,
  loadResearchTaskPlan,
  NEWEST_EVENTS,
  normalizeTask,
  previewResearchTaskArtifact,
  previewResearchTaskFile,
  progressResearchTask,
  refreshResearchTaskEvidence,
  researchNotificationPermission,
  researchTaskRunLog,
  retryResearchTask,
  setResearchTaskKeepRunning,
  startResearchTask,
  watchResearchTask,
  type ResearchBrief,
  type ResearchTask,
  type ResearchTaskDraft,
  type TaskTranscriptDelta,
  type TaskTranscriptEvent,
} from "./research-tasks";

/** A task as the 0.4.7 backend sent it: none of the 0.4.8 fields. */
const OLD_TASK: Parameters<typeof normalizeTask>[0] = {
  id: "t1",
  projectId: "paper",
  title: "Survey",
  prompt: "Find papers on sparse attention",
  runtimeId: "builtin",
  agentId: "openai",
  modelId: "gpt-test",
  skillIds: ["oleafly-literature-sweep"],
  dependencyIds: [],
  status: "awaiting_review",
  executionGeneration: 1,
  sessionId: "session-t1",
  nativeSessionId: null,
  sourceRevision: "snapshot:base",
  isolation: null,
  error: null,
  result: null,
  review: null,
  startRequested: false,
  cancelRequested: false,
  createdAt: 5,
  updatedAt: 6,
  startedAt: 5,
  finishedAt: 6,
};

/** The 0.4.8 fields a 0.4.7 task gets. */
const NEW_FIELD_DEFAULTS = {
  brief: defaultBrief(),
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
} as const;

function currentTask(overrides: Partial<ResearchTask> = {}): ResearchTask {
  return normalizeTask({
    ...OLD_TASK,
    brief: { ...defaultBrief("Beat the baseline"), reviewPlanFirst: true },
    recordSlug: "survey-ab12",
    recordDir: "research/survey-ab12",
    phase: "working",
    pendingApprovals: 2,
    activeMs: 90_000,
    ...overrides,
  });
}

function emit(name: string, payload: unknown): void {
  const handler = native.handlers.get(name);
  if (!handler) throw new Error(`Nothing listens to ${name}.`);
  handler({ event: name, id: 1, payload });
}

beforeEach(() => {
  native.invoke.mockReset();
  native.listen.mockReset();
  native.unlisten.mockReset();
  native.handlers.clear();
  native.listen.mockImplementation(async (name: string, handler: Handler) => {
    native.handlers.set(name, handler);
    return native.unlisten;
  });
});

describe("the default research brief", () => {
  it("allows commands without network, two hours of work and hour-long runs", () => {
    expect(defaultBrief()).toEqual({
      goal: "",
      successCriteria: [],
      scope: "",
      constraints: "",
      primaryMetric: null,
      reviewPlanFirst: false,
      permissions: { network: false, commands: "allow", desktopApps: false },
      budget: { wallClockMinutes: 120, usdCap: null, maxRuns: null, runTimeoutMinutes: 60 },
      profile: "analysis",
      compute: { executor: "local", target: null, resources: null },
    });
  });

  it("uses the given text as the goal", () => {
    expect(defaultBrief("Find the best learning rate").goal).toBe("Find the best learning rate");
  });

  it("hands out a new brief each time, so editing one leaves the next alone", () => {
    const first = defaultBrief();
    first.permissions.network = true;
    first.budget.wallClockMinutes = 30;
    expect(defaultBrief().permissions.network).toBe(false);
    expect(defaultBrief().budget.wallClockMinutes).toBe(120);
  });
});

describe("tasks from an older backend", () => {
  it("fills the fields a 0.4.7 task lacks with their defaults", () => {
    expect(normalizeTask(OLD_TASK)).toEqual({ ...OLD_TASK, ...NEW_FIELD_DEFAULTS });
  });

  it("fills every field of a task that carries only its id, project and status", () => {
    expect(normalizeTask({ id: "bare", projectId: "paper", status: "queued" })).toEqual({
      id: "bare",
      projectId: "paper",
      status: "queued",
      title: "",
      prompt: "",
      runtimeId: "",
      agentId: "",
      modelId: "",
      skillIds: [],
      dependencyIds: [],
      executionGeneration: 0,
      sessionId: null,
      nativeSessionId: null,
      sourceRevision: null,
      isolation: null,
      error: null,
      result: null,
      review: null,
      startRequested: false,
      cancelRequested: false,
      createdAt: 0,
      updatedAt: 0,
      startedAt: null,
      finishedAt: null,
      ...NEW_FIELD_DEFAULTS,
    });
  });

  it("keeps every field a current task sends", () => {
    const task = currentTask({
      status: "plan_ready",
      runAfter: 1_700_000_000_000,
      keepRunningAfterQuit: true,
      owner: "daemon",
      planApproved: true,
      stopReason: "budget_time",
      todos: [{ id: "1", content: "Measure the baseline", status: "in_progress" }],
      reclaimRequested: true,
      resumedFrom: 3,
    });

    expect(normalizeTask(task)).toEqual(task);
  });

  it("completes a brief that lacks its compute target", () => {
    const partial = {
      goal: "Beat the baseline",
      permissions: { network: true },
      budget: { wallClockMinutes: 30 },
    } as unknown as ResearchBrief;

    expect(normalizeTask({ ...OLD_TASK, brief: partial }).brief).toEqual({
      ...defaultBrief(),
      goal: "Beat the baseline",
      permissions: { network: true, commands: "allow", desktopApps: false },
      budget: { wallClockMinutes: 30, usdCap: null, maxRuns: null, runTimeoutMinutes: 60 },
    });
  });

  it("completes a brief that names only its compute target", () => {
    const partial = { compute: { executor: "slurm", target: "cluster" } } as unknown as ResearchBrief;

    expect(normalizeTask({ ...OLD_TASK, brief: partial }).brief).toEqual({
      ...defaultBrief(),
      compute: { executor: "slurm", target: "cluster", resources: null },
    });
  });
});

describe("research task commands", () => {
  it("lists a project's tasks and fills what older tasks lack", async () => {
    native.invoke.mockResolvedValueOnce([OLD_TASK]);

    await expect(listResearchTasks("paper")).resolves.toEqual([{ ...OLD_TASK, ...NEW_FIELD_DEFAULTS }]);
    expect(native.invoke).toHaveBeenCalledWith("research_task_list", { projectId: "paper" });
  });

  it("creates a task from a draft with its brief", async () => {
    const draft: ResearchTaskDraft = {
      projectId: "paper",
      title: "Survey",
      prompt: "Find papers",
      runtimeId: "builtin",
      agentId: "openai",
      modelId: "gpt-test",
      skillIds: [],
      dependencyIds: [],
      brief: defaultBrief("Find papers"),
      runAfter: 1_700_000_060_000,
      keepRunningAfterQuit: true,
    };
    native.invoke.mockResolvedValueOnce(OLD_TASK);

    await expect(createResearchTask(draft)).resolves.toEqual({ ...OLD_TASK, ...NEW_FIELD_DEFAULTS });
    expect(native.invoke).toHaveBeenCalledWith("research_task_create", { draft });
  });

  it("edits a task", async () => {
    const edit = {
      title: "Survey v2",
      prompt: "Find newer papers",
      runtimeId: "builtin",
      agentId: "openai",
      modelId: "gpt-test",
      skillIds: [],
      dependencyIds: [],
      brief: defaultBrief("Find newer papers"),
    };
    native.invoke.mockResolvedValueOnce({ ...OLD_TASK, title: "Survey v2" });

    await expect(editResearchTask("t1", edit)).resolves.toMatchObject({ title: "Survey v2", owner: "app" });
    expect(native.invoke).toHaveBeenCalledWith("research_task_edit", { taskId: "t1", edit });
  });

  it.each([
    ["starts", startResearchTask, "research_task_start"],
    ["cancels", cancelResearchTask, "research_task_cancel"],
    ["accepts the result of", acceptResearchTaskResult, "research_task_accept_result"],
    ["checks the evidence of", refreshResearchTaskEvidence, "research_task_evidence_refresh"],
  ] as const)("%s a task by id and fills what an older task lacks", async (_verb, command, name) => {
    native.invoke.mockResolvedValueOnce(OLD_TASK);

    await expect(command("t1")).resolves.toEqual({ ...OLD_TASK, ...NEW_FIELD_DEFAULTS });
    expect(native.invoke).toHaveBeenCalledWith(name, { taskId: "t1" });
  });

  it("starts a retry over by default, so 0.4.7 callers keep their behavior", async () => {
    native.invoke.mockResolvedValueOnce(OLD_TASK);

    await retryResearchTask("t1");

    expect(native.invoke).toHaveBeenCalledWith("research_task_retry", { taskId: "t1", mode: "fresh" });
  });

  it.each(["resume", "fresh"] as const)("retries a task in %s mode", async (mode) => {
    native.invoke.mockResolvedValueOnce({ ...OLD_TASK, status: "queued" });

    await expect(retryResearchTask("t1", mode)).resolves.toMatchObject({ status: "queued", brief: defaultBrief() });
    expect(native.invoke).toHaveBeenCalledWith("research_task_retry", { taskId: "t1", mode });
  });

  it("deletes a task", async () => {
    native.invoke.mockResolvedValueOnce(undefined);

    await deleteResearchTask("t1");

    expect(native.invoke).toHaveBeenCalledWith("research_task_delete", { taskId: "t1" });
  });

  it.each([true, false])("sets whether a task keeps running after Oleafly closes: %s", async (keep) => {
    native.invoke.mockResolvedValueOnce({ ...OLD_TASK, keepRunningAfterQuit: keep });

    await expect(setResearchTaskKeepRunning("t1", keep)).resolves.toMatchObject({ keepRunningAfterQuit: keep });
    expect(native.invoke).toHaveBeenCalledWith("research_task_set_keep_running", { taskId: "t1", keep });
  });

  it("applies the chosen files and fills the returned task", async () => {
    const projectState = { generation: 5 } as never;
    native.invoke.mockResolvedValueOnce({ task: { ...OLD_TASK, status: "completed" }, projectState });

    const result = await applyResearchTask("t1", 4, ["main.tex", "refs.bib"]);

    expect(native.invoke).toHaveBeenCalledWith("research_task_apply", {
      request: { taskId: "t1", expectedProjectGeneration: 4, selectedPaths: ["main.tex", "refs.bib"] },
    });
    expect(result).toEqual({
      task: { ...OLD_TASK, ...NEW_FIELD_DEFAULTS, status: "completed" },
      projectState,
    });
  });

  it("loads the first transcript page of a run", async () => {
    const page = { events: [], nextSequence: null };
    native.invoke.mockResolvedValueOnce(page);

    await expect(loadResearchTaskEvents("t1", 2)).resolves.toBe(page);
    expect(native.invoke).toHaveBeenCalledWith("research_task_events", {
      taskId: "t1",
      executionGeneration: 2,
      afterSequence: null,
      limit: 100,
    });
  });

  it("loads a later transcript page with its own size", async () => {
    native.invoke.mockResolvedValueOnce({ events: [], nextSequence: null });

    await loadResearchTaskEvents("t1", 2, 40, 25);

    expect(native.invoke).toHaveBeenCalledWith("research_task_events", {
      taskId: "t1",
      executionGeneration: 2,
      afterSequence: 40,
      limit: 25,
    });
  });

  it("previews a changed file and an artifact", async () => {
    native.invoke.mockResolvedValue({});

    await previewResearchTaskFile("t1", "main.tex");
    await previewResearchTaskArtifact("t1", "figures/loss.png");

    expect(native.invoke).toHaveBeenNthCalledWith(1, "research_task_file_preview", { taskId: "t1", path: "main.tex" });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "research_task_artifact_preview", {
      taskId: "t1",
      path: "figures/loss.png",
    });
  });

  it.each([
    ["the task a window shows", "t1"],
    ["no task", null],
  ] as const)("watches %s", async (_what, taskId) => {
    native.invoke.mockResolvedValueOnce(undefined);

    await watchResearchTask(taskId);

    expect(native.invoke).toHaveBeenCalledWith("research_task_watch", { taskId });
  });

  it("loads a task's plan and whether the review shows all of it", async () => {
    native.invoke.mockResolvedValueOnce({ text: "- [ ] Measure the baseline", truncated: true });

    await expect(loadResearchTaskPlan("t1")).resolves.toEqual({ text: "- [ ] Measure the baseline", truncated: true });
    expect(native.invoke).toHaveBeenCalledWith("research_task_plan", { taskId: "t1" });
  });

  it("reads the plan text an older backend sends alone as the whole plan", async () => {
    native.invoke.mockResolvedValueOnce("- [ ] Measure the baseline");

    await expect(loadResearchTaskPlan("t1")).resolves.toEqual({ text: "- [ ] Measure the baseline", truncated: false });
  });

  it("loads the newest transcript page, or the page before a row", async () => {
    native.invoke.mockResolvedValue({ events: [], nextSequence: null, previousSequence: null, resumedFrom: null });

    await loadResearchTaskEventsBefore("t1", 2, NEWEST_EVENTS);
    await loadResearchTaskEventsBefore("t1", 1, 40, 200);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "research_task_events", {
      taskId: "t1",
      executionGeneration: 2,
      beforeSequence: Number.MAX_SAFE_INTEGER,
      limit: 100,
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "research_task_events", {
      taskId: "t1",
      executionGeneration: 1,
      beforeSequence: 40,
      limit: 200,
    });
  });

  it("approves the plan as written", async () => {
    native.invoke.mockResolvedValueOnce({ ...OLD_TASK, status: "queued", planApproved: true });

    await expect(approveResearchTaskPlan("t1")).resolves.toMatchObject({ status: "queued", planApproved: true });
    expect(native.invoke).toHaveBeenCalledWith("research_task_approve_plan", { taskId: "t1", editedPlan: null });
  });

  it("approves an edited plan", async () => {
    native.invoke.mockResolvedValueOnce({ ...OLD_TASK, status: "queued" });

    await approveResearchTaskPlan("t1", "- [ ] edited");

    expect(native.invoke).toHaveBeenCalledWith("research_task_approve_plan", {
      taskId: "t1",
      editedPlan: "- [ ] edited",
    });
  });

  it("loads a task's progress", async () => {
    const progress = { phase: "working", plan: [], todos: [], ledger: [], best: null };
    native.invoke.mockResolvedValueOnce(progress);

    await expect(progressResearchTask("t1")).resolves.toBe(progress);
    expect(native.invoke).toHaveBeenCalledWith("research_task_progress", { taskId: "t1" });
  });

  it("stops one run of a task", async () => {
    native.invoke.mockResolvedValueOnce(undefined);

    await cancelResearchTaskRun("t1", "r002");

    expect(native.invoke).toHaveBeenCalledWith("research_task_run_cancel", { taskId: "t1", runId: "r002" });
  });

  it("reads the last 200 log lines of a run unless told otherwise", async () => {
    native.invoke.mockResolvedValue("epoch 3 loss 0.41");

    await expect(researchTaskRunLog("t1", "r002")).resolves.toBe("epoch 3 loss 0.41");
    await researchTaskRunLog("t1", "r002", 50);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "research_task_run_log", { taskId: "t1", runId: "r002", tail: 200 });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "research_task_run_log", { taskId: "t1", runId: "r002", tail: 50 });
  });

  it("lists the approvals a project's tasks wait for", async () => {
    const approvals = [{ id: "a1", taskId: "t1", kind: "command", status: "pending" }];
    native.invoke.mockResolvedValueOnce(approvals);

    await expect(listResearchTaskApprovals("paper")).resolves.toBe(approvals);
    expect(native.invoke).toHaveBeenCalledWith("research_task_approvals", { projectId: "paper" });
  });

  it.each([true, false])("answers an approval request: %s", async (approve) => {
    native.invoke.mockResolvedValueOnce({ id: "a1", status: approve ? "approved" : "denied" });

    await decideResearchTaskApproval("a1", approve);

    expect(native.invoke).toHaveBeenCalledWith("research_task_approval_decide", { approvalId: "a1", approve });
  });

  it("loads how many tasks need the user in each project", async () => {
    native.invoke.mockResolvedValueOnce({ byProject: { paper: 2 } });

    await expect(loadResearchAttention()).resolves.toEqual({ byProject: { paper: 2 } });
    expect(native.invoke).toHaveBeenCalledWith("research_task_attention");
  });

  it("reads the notification permission without asking, unless told to ask", async () => {
    native.invoke.mockResolvedValueOnce("prompt").mockResolvedValueOnce("granted");

    await expect(researchNotificationPermission()).resolves.toBe("prompt");
    await expect(researchNotificationPermission(true)).resolves.toBe("granted");

    expect(native.invoke).toHaveBeenNthCalledWith(1, "research_notification_permission", { request: false });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "research_notification_permission", { request: true });
  });
});

describe("research task events", () => {
  it("passes task changes on with the fields older tasks lack", async () => {
    const onTask = vi.fn();

    await expect(listenForResearchTaskChanges(onTask)).resolves.toBe(native.unlisten);
    emit("research-task-changed", OLD_TASK);

    expect(native.listen).toHaveBeenCalledWith("research-task-changed", expect.any(Function));
    expect(onTask).toHaveBeenCalledWith({ ...OLD_TASK, ...NEW_FIELD_DEFAULTS });
  });

  it("passes transcript rows on as they come", async () => {
    const onEvent = vi.fn();
    const row: TaskTranscriptEvent = {
      taskId: "t1",
      executionGeneration: 1,
      sequence: 4,
      event: { kind: "phase", phase: "waiting_runs" },
      createdAt: 9,
    };

    await listenForResearchTaskEvents(onEvent);
    emit("research-task-event", row);

    expect(native.listen).toHaveBeenCalledWith("research-task-event", expect.any(Function));
    expect(onEvent).toHaveBeenCalledWith(row);
  });

  it("passes text deltas on as they come", async () => {
    const onDelta = vi.fn();
    const delta: TaskTranscriptDelta = {
      taskId: "t1",
      executionGeneration: 1,
      sequence: 5,
      kind: "reasoning",
      append: "Checking the ledger",
      createdAt: 10,
    };

    await listenForResearchTaskDeltas(onDelta);
    emit("research-task-delta", delta);

    expect(native.listen).toHaveBeenCalledWith("research-task-delta", expect.any(Function));
    expect(onDelta).toHaveBeenCalledWith(delta);
  });

  it("passes attention summaries on as they come", async () => {
    const onSummary = vi.fn();

    await listenForResearchAttention(onSummary);
    emit("research-attention", { byProject: { paper: 3 } });

    expect(native.listen).toHaveBeenCalledWith("research-attention", expect.any(Function));
    expect(onSummary).toHaveBeenCalledWith({ byProject: { paper: 3 } });
  });
});
