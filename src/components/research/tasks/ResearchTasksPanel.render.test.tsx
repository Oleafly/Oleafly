// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskTranscriptEvent } from "@/lib/research-tasks";

const chipRenders = vi.hoisted(() => new Map<string, number>());

vi.mock("@/lib/research-tasks", () => ({
  acceptResearchTaskResult: vi.fn(), applyResearchTask: vi.fn(), cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(), deleteResearchTask: vi.fn(), editResearchTask: vi.fn(), listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(), listenForResearchTaskEvents: vi.fn(),
  loadResearchTaskEvents: vi.fn(), retryResearchTask: vi.fn(), startResearchTask: vi.fn(),
  previewResearchTaskFile: vi.fn(), previewResearchTaskArtifact: vi.fn(),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ runExternalProjectMutation: vi.fn() }) },
}));

vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: () => <div />,
}));

vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));

vi.mock("./TaskChips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./TaskChips")>();
  return {
    ...actual,
    TaskAgentChip: (props: Parameters<typeof actual.TaskAgentChip>[0] & { task: { id?: string } }) => {
      const id = props.task.id ?? "";
      chipRenders.set(id, (chipRenders.get(id) ?? 0) + 1);
      return actual.TaskAgentChip(props);
    },
  };
});

import * as api from "@/lib/research-tasks";
import { useResearchTasksStore } from "@/store/research-tasks";
import { ResearchTasksPanel } from "./ResearchTasksPanel";

function task(index: number): ResearchTask {
  return {
    id: `t${index}`, projectId: "paper", title: `Task ${index}`, prompt: `Complete ${index}`,
    runtimeId: "builtin", agentId: "provider", modelId: "model", skillIds: [],
    dependencyIds: index > 0 && index % 4 === 0 ? [`t${index - 1}`] : [],
    status: index === 0 ? "running" : "queued",
    executionGeneration: 1, sessionId: `session-${index}`, nativeSessionId: null,
    sourceRevision: "snapshot:base", isolation: null, error: null, result: null,
    review: null, startRequested: false, cancelRequested: false,
    createdAt: 1_000 - index, updatedAt: 1, startedAt: 1, finishedAt: null,
  };
}

const agents = [{ runtimeId: "builtin", agentId: "provider", modelId: "model", label: "Research model" }];
let changedTask: ((task: ResearchTask) => void) | undefined;
let changedEvent: ((event: TaskTranscriptEvent) => void) | undefined;

async function mountList(count: number) {
  const tasks = Array.from({ length: count }, (_, index) => task(index));
  vi.mocked(api.listResearchTasks).mockResolvedValue(tasks);
  render(<ResearchTasksPanel projectId="paper" agents={agents} />);
  await screen.findByRole("button", { name: /Task 0/ });
  await act(async () => {});
  return tasks;
}

describe("ResearchTasksPanel rendering", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    chipRenders.clear();
    await useResearchTasksStore.getState().bindProject(null);
    vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [], nextSequence: null });
    vi.mocked(api.listenForResearchTaskChanges).mockImplementation(async (listener) => {
      changedTask = listener;
      return () => {};
    });
    vi.mocked(api.listenForResearchTaskEvents).mockImplementation(async (listener) => {
      changedEvent = listener;
      return () => {};
    });
  });

  afterEach(() => cleanup());

  it("streams activity for the selected task without rendering the task list again", async () => {
    await mountList(12);
    const before = new Map(chipRenders);

    act(() => {
      for (let sequence = 1; sequence <= 5; sequence++) {
        changedEvent?.({
          taskId: "t0",
          executionGeneration: 1,
          sequence,
          createdAt: sequence,
          event: { kind: "text", text: `progress ${sequence}` },
        });
      }
    });

    expect(useResearchTasksStore.getState().events).toHaveLength(5);
    expect(chipRenders).toEqual(before);
  });

  it("renders only the task that changed", async () => {
    const tasks = await mountList(12);
    const before = new Map(chipRenders);

    act(() => changedTask?.({ ...tasks[7], status: "running", updatedAt: 2 }));

    expect(chipRenders.get("t7")).toBe((before.get("t7") ?? 0) + 1);
    for (const [id, count] of before) {
      if (id !== "t7") expect(chipRenders.get(id)).toBe(count);
    }
  });

  it("names each task title through the list's shared tooltip", async () => {
    await mountList(3);

    expect(screen.getByText("Task 2")).toHaveAttribute("data-tooltip", "Task 2");
  });
});
