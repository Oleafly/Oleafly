import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskFilePreview } from "@/lib/research-tasks";

let TaskDetail: typeof import("./TaskDetail").TaskDetail;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;

const previewMocks = vi.hoisted(() => ({
  file: vi.fn(),
  artifact: vi.fn(),
}));

vi.mock("@/lib/research-tasks", () => ({
  previewResearchTaskFile: previewMocks.file,
  previewResearchTaskArtifact: previewMocks.artifact,
}));

vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: ({ oldText, newText }: { oldText: string; newText: string }) => (
    <div>{`${oldText} -> ${newText}`}</div>
  ),
}));

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://oleafly.test",
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
  vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import(
    "@testing-library/react"
  ));
  ({ TaskDetail } = await import("./TaskDetail"));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function page() {
  return within(document.body);
}

function task(id: string): ResearchTask {
  return {
    id,
    projectId: "paper",
    title: `Task ${id}`,
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
    result: {
      summary: `Result ${id}`,
      changedFiles: [
        {
          path: "main.tex",
          kind: "modified",
          beforeSha256: `before-${id}`,
          afterSha256: `after-${id}`,
          beforeSize: 5,
          afterSize: 5,
        },
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

function preview(after: string): TaskFilePreview {
  const content = (text: string) => ({
    exists: true,
    text,
    base64: null,
    mediaType: "text/x-tex",
    binary: false,
    truncated: false,
    size: text.length,
    sha256: text,
  });
  return {
    path: "main.tex",
    change: "modified",
    before: content("before"),
    after: content(after),
  };
}

function props(current: ResearchTask, onCancel = vi.fn(async () => {})) {
  return {
    task: current,
    tasks: [current],
    events: [],
    eventsLoading: false,
    canLoadMoreEvents: false,
    busy: false,
    onStart: vi.fn(async () => {}),
    onCancel,
    onRetry: vi.fn(async () => {}),
    onEdit: vi.fn(),
    onApply: vi.fn(async () => {}),
    onAccept: vi.fn(async () => {}),
    onLoadMoreEvents: vi.fn(async () => {}),
  };
}

describe("TaskDetail", () => {
  beforeEach(() => {
    previewMocks.file.mockReset();
    previewMocks.artifact.mockReset();
  });

  afterEach(() => cleanup());

  it("rejects a file preview that completes after the selected task changes", async () => {
    const pending = deferred<TaskFilePreview>();
    previewMocks.file.mockReturnValue(pending.promise);
    const first = task("first");
    const second = task("second");
    const view = render(<TaskDetail {...props(first)} />);

    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    view.rerender(<TaskDetail {...props(second)} />);
    await act(async () => pending.resolve(preview("first task output")));

    await waitFor(() => {
      expect(page().queryByText(/first task output/)).not.toBeInTheDocument();
      expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeDisabled();
    });
  });

  it("lets the user discard changes while a task is awaiting review", async () => {
    const onCancel = vi.fn(async () => {});
    render(<TaskDetail {...props(task("review"), onCancel)} />);

    fireEvent.click(page().getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });
});
