import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskFilePreview } from "@/lib/research-tasks";

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
import { useResearchTasksStore } from "@/store/research-tasks";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

let TaskOutputsSection: typeof import("./TaskOutputsSection").TaskOutputsSection;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://oleafly.test" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "DocumentFragment", "Node", "NodeFilter", "Event", "CustomEvent", "MutationObserver"] as const) {
    vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
  }
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    dom.window.setTimeout(() => callback(Date.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => dom.window.clearTimeout(handle));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
  ({ cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ TaskOutputsSection } = await import("./TaskOutputsSection"));
});

function page() {
  return within(document.body);
}

function task(id: string, status: ResearchTask["status"] = "awaiting_review"): ResearchTask {
  return {
    id,
    projectId: "paper",
    title: `Task ${id}`,
    prompt: `Complete ${id}`,
    runtimeId: "builtin",
    agentId: "openai",
    modelId: "model",
    skillIds: [],
    dependencyIds: [],
    status,
    executionGeneration: 1,
    sessionId: `session-${id}`,
    nativeSessionId: null,
    sourceRevision: "snapshot:base",
    isolation: null,
    error: null,
    result: {
      summary: `Result ${id}`,
      changedFiles: [
        { path: `${id}.tex`, kind: "modified", beforeSha256: "a", afterSha256: "b", beforeSize: 1, afterSize: 2 },
      ],
      artifacts: [{ path: `${id}.md`, label: `Report ${id}`, mediaType: "text/markdown" }],
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

function preview(path: string): TaskFilePreview {
  const content = (text: string) => ({
    exists: true,
    text,
    base64: null,
    mediaType: "text/plain",
    binary: false,
    truncated: false,
    size: text.length,
    sha256: text,
  });
  return {
    path,
    change: "modified",
    before: content("before"),
    after: content(`after ${path}`),
    projectSha256: "before",
    baseIsCurrent: true,
  };
}

function seed(tasks: ResearchTask[]) {
  useResearchTasksStore.setState({
    projectId: "paper",
    tasks,
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
}

beforeEach(() => {
  vi.mocked(api.listenForResearchTaskChanges).mockResolvedValue(vi.fn());
  vi.mocked(api.listenForResearchTaskEvents).mockResolvedValue(vi.fn());
  vi.mocked(api.previewResearchTaskFile).mockImplementation(async (_id, path) => preview(path));
  useFilesStore.setState({ projectId: "paper" });
  seed([]);
});

afterEach(() => cleanup());

describe("TaskOutputsSection", () => {
  it("stays out of the tree when no task has reviewable output", () => {
    seed([
      { ...task("empty"), result: null },
      { ...task("applied", "completed") },
      { ...task("discarded", "cancelled") },
    ]);
    render(<TaskOutputsSection />);
    expect(page().queryByTestId("task-outputs-section")).not.toBeInTheDocument();
  });

  it("groups only the tasks that still hold output", () => {
    seed([
      task("review"),
      { ...task("failed", "failed") },
      { ...task("applied", "completed") },
      { ...task("other"), projectId: "other-project" },
    ]);
    render(<TaskOutputsSection />);

    const section = page().getByTestId("task-outputs-section");
    expect(within(section).getByText(enResearchTools.outputs.title)).toBeInTheDocument();
    expect(within(section).getByText("2")).toBeInTheDocument();
    expect(within(section).getByText("Task review")).toBeInTheDocument();
    expect(within(section).getByText("Task failed")).toBeInTheDocument();
    expect(within(section).queryByText("Task applied")).not.toBeInTheDocument();
    expect(within(section).queryByText("Task other")).not.toBeInTheDocument();
    expect(within(section).getByText("review.tex")).toBeInTheDocument();
    expect(within(section).getByText("Report review")).toBeInTheDocument();
  });

  it("previews a changed file without touching the project tree", async () => {
    seed([task("review")]);
    render(<TaskOutputsSection />);

    fireEvent.click(page().getByRole("button", { name: /review\.tex/ }));
    await waitFor(() =>
      expect(page().getByText("after review.tex")).toBeInTheDocument(),
    );
    expect(api.previewResearchTaskFile).toHaveBeenCalledWith("review", "review.tex");

    fireEvent.click(
      within(page().getByRole("dialog")).getAllByRole("button", { name: enCommon.actions.close })[0],
    );
    await waitFor(() => expect(page().queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the task detail on the review tab", () => {
    seed([task("review")]);
    render(<TaskOutputsSection />);

    fireEvent.click(page().getByRole("button", { name: "Review" }));

    expect(useResearchTasksStore.getState()).toMatchObject({
      detailOpen: true,
      detailTab: "review",
      selectedTaskId: "review",
    });
  });
});
