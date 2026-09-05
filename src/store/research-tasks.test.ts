import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskTranscriptEvent } from "@/lib/research-tasks";

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
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("research task store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it("pins apply to the current project mutation generation", async () => {
    const reviewed = task("reviewed", "paper");
    const completed = { ...reviewed, status: "completed" as const };
    useResearchTasksStore.setState({ projectId: "paper", tasks: [reviewed] });
    vi.mocked(api.readProjectMutationGeneration).mockResolvedValue(17);
    vi.mocked(api.applyResearchTask).mockResolvedValue({
      task: completed,
      projectState: {} as never,
    });

    await useResearchTasksStore.getState().applyTask(reviewed.id, ["main.tex"]);

    expect(api.applyResearchTask).toHaveBeenCalledWith(reviewed.id, 17, ["main.tex"]);
    expect(useResearchTasksStore.getState().tasks[0].status).toBe("completed");
  });
});
