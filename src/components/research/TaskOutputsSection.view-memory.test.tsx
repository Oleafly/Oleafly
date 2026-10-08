// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@/lib/research-tasks";

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
  previewResearchTaskFile: vi.fn(),
  previewResearchTaskArtifact: vi.fn(),
}));

vi.mock("@/store/files", () => {
  let state: { projectId: string | null } = { projectId: null };
  const store = (selector: (value: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  store.setState = (next: Partial<typeof state>) => {
    state = { ...state, ...next };
  };
  return { useFilesStore: store };
});

import * as api from "@/lib/research-tasks";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useResearchTasksStore } from "@/store/research-tasks";
import { TaskOutputsSection } from "./TaskOutputsSection";

function task(projectId: string): ResearchTask {
  return {
    id: `${projectId}-review`,
    projectId,
    title: "Task review",
    prompt: "Complete review",
    runtimeId: "builtin",
    agentId: "openai",
    modelId: "model",
    skillIds: [],
    dependencyIds: [],
    status: "awaiting_review",
    executionGeneration: 1,
    sessionId: "session",
    nativeSessionId: null,
    sourceRevision: "snapshot:base",
    isolation: null,
    error: null,
    result: {
      summary: "Result",
      changedFiles: [
        { path: "review.tex", kind: "modified", beforeSha256: "a", afterSha256: "b", beforeSize: 1, afterSize: 2 },
      ],
      artifacts: [],
      nativeSessionId: null,
      inputTokens: null,
      outputTokens: null,
    },
    review: null,
    startRequested: false,
    cancelRequested: false,
    createdAt: 1,
    updatedAt: 1,
    startedAt: 1,
    finishedAt: 1,
  };
}

function seed(projectId: string) {
  act(() => {
    useFilesStore.setState({ projectId } as never);
    useResearchTasksStore.setState({
      projectId,
      tasks: [task("outputs-a"), task("outputs-b")],
      selectedTaskId: null,
      events: [],
      eventsNextSequence: null,
      loading: false,
      eventsLoading: false,
      action: null,
      error: null,
      detailOpen: false,
      detailTab: null,
    });
  });
}

const toggle = () =>
  screen.getByRole("button", { name: new RegExp(enResearchTools.outputs.title) });

beforeEach(() => {
  vi.mocked(api.listenForResearchTaskChanges).mockResolvedValue(vi.fn());
  vi.mocked(api.listenForResearchTaskEvents).mockResolvedValue(vi.fn());
  seed("outputs-a");
});

describe("TaskOutputsSection view memory", () => {
  it("stays collapsed after the panel is closed and reopened", () => {
    const first = render(<TaskOutputsSection />);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    first.unmount();

    render(<TaskOutputsSection />);

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("starts another project open and restores the first project's choice on return", () => {
    const first = render(<TaskOutputsSection />);
    fireEvent.click(toggle());
    first.unmount();

    seed("outputs-b");
    const second = render(<TaskOutputsSection />);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    second.unmount();

    seed("outputs-a");
    render(<TaskOutputsSection />);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });
});
