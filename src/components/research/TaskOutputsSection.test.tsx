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

  it("previews a task artifact and marks a long one as cut short", async () => {
    vi.mocked(api.previewResearchTaskArtifact).mockResolvedValue({
      path: "review.md",
      content: { text: "# Findings", truncated: true },
    } as never);
    seed([task("review")]);
    render(<TaskOutputsSection />);

    fireEvent.click(page().getByRole("button", { name: /Report review/ }));

    await waitFor(() => expect(page().getByText("# Findings")).toBeInTheDocument());
    expect(page().getByText(enResearchTools.outputs.previewTruncated)).toBeInTheDocument();
    expect(api.previewResearchTaskArtifact).toHaveBeenCalledWith("review", "review.md");
  });

  it("explains binary artifacts, binary files and deleted files", async () => {
    vi.mocked(api.previewResearchTaskArtifact).mockResolvedValue({
      path: "review.md",
      content: { text: null, truncated: false },
    } as never);
    seed([task("review")]);
    render(<TaskOutputsSection />);

    fireEvent.click(page().getByRole("button", { name: /Report review/ }));
    await waitFor(() => expect(page().getByText(enResearchTools.outputs.binaryArtifact)).toBeInTheDocument());
    fireEvent.keyDown(page().getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(page().queryByRole("dialog")).not.toBeInTheDocument());

    vi.mocked(api.previewResearchTaskFile).mockImplementationOnce(async (_id, path) => {
      const value = preview(path);
      return { ...value, after: { ...value.after, binary: true } };
    });
    fireEvent.click(page().getByRole("button", { name: /review\.tex/ }));
    await waitFor(() => expect(page().getByText(enResearchTools.outputs.binaryFile)).toBeInTheDocument());
    fireEvent.keyDown(page().getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(page().queryByRole("dialog")).not.toBeInTheDocument());

    vi.mocked(api.previewResearchTaskFile).mockImplementationOnce(async (_id, path) => {
      const value = preview(path);
      return { ...value, after: { ...value.after, exists: false } };
    });
    fireEvent.click(page().getByRole("button", { name: /review\.tex/ }));
    await waitFor(() => expect(page().getByText(enResearchTools.outputs.deleted)).toBeInTheDocument());
  });

  it("shows why a preview failed", async () => {
    vi.mocked(api.previewResearchTaskFile).mockRejectedValueOnce(new Error("snapshot missing"));
    vi.mocked(api.previewResearchTaskArtifact).mockRejectedValueOnce("artifact gone");
    seed([task("review")]);
    render(<TaskOutputsSection />);

    fireEvent.click(page().getByRole("button", { name: /review\.tex/ }));
    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("snapshot missing"));
    fireEvent.click(
      within(page().getByRole("dialog")).getAllByRole("button", { name: enCommon.actions.close })[0],
    );
    await waitFor(() => expect(page().queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(page().getByRole("button", { name: /Report review/ }));
    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("artifact gone"));
  });

  it("drops a preview that arrives after the dialog closed", async () => {
    let finish: (value: TaskFilePreview) => void = () => {};
    vi.mocked(api.previewResearchTaskFile).mockImplementationOnce(
      () => new Promise<TaskFilePreview>((resolve) => (finish = resolve)),
    );
    seed([task("review")]);
    render(<TaskOutputsSection />);

    fireEvent.click(page().getByRole("button", { name: /review\.tex/ }));
    await waitFor(() => expect(page().getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(
      within(page().getByRole("dialog")).getAllByRole("button", { name: enCommon.actions.close })[0],
    );
    await waitFor(() => expect(page().queryByRole("dialog")).not.toBeInTheDocument());
    finish(preview("review.tex"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page().queryByText("after review.tex")).not.toBeInTheDocument();
  });

  it("collapses and expands the output list", () => {
    seed([task("review")]);
    render(<TaskOutputsSection />);
    const header = page().getByRole("button", { name: new RegExp(enResearchTools.outputs.title) });

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(page().queryByText("review.tex")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(page().getByText("review.tex")).toBeInTheDocument();
  });

  it("leaves out tasks that were already reviewed", () => {
    seed([{ ...task("done"), review: { decision: "accepted" } as never }]);
    render(<TaskOutputsSection />);

    expect(page().queryByTestId("task-outputs-section")).not.toBeInTheDocument();
  });
});
