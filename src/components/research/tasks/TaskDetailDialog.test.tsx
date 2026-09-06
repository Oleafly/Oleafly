import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResearchTask,
  TaskArtifactPreview,
  TaskFilePreview,
  TaskRuntimeEvent,
} from "@/lib/research-tasks";

let TaskDetailDialog: typeof import("./TaskDetailDialog").TaskDetailDialog;
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

vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://oleafly.test",
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("HTMLInputElement", dom.window.HTMLInputElement);
  vi.stubGlobal("HTMLTextAreaElement", dom.window.HTMLTextAreaElement);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("DocumentFragment", dom.window.DocumentFragment);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("NodeFilter", dom.window.NodeFilter);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
  vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
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
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ TaskDetailDialog } = await import("./TaskDetailDialog"));
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

function openTab(name: string) {
  fireEvent.mouseDown(page().getByRole("tab", { name }), { button: 0 });
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
    projectSha256: "before",
    baseIsCurrent: true,
  };
}

function props(current: ResearchTask, onCancel = vi.fn(async () => {})) {
  return {
    open: true,
    onOpenChange: vi.fn(),
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
    onDelete: vi.fn(),
    onLoadMoreEvents: vi.fn(async () => {}),
  };
}

describe("TaskDetailDialog", () => {
  beforeEach(() => {
    previewMocks.file.mockReset();
    previewMocks.artifact.mockReset();
  });

  afterEach(() => cleanup());

  it("renders the task body inside the dialog the review specs scope on", () => {
    const current = task("scoped");
    render(<TaskDetailDialog {...props(current)} />);
    const dialog = page().getByRole("dialog");
    const detail = dialog.querySelector('article[aria-labelledby="research-task-detail-title"]');
    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).getByRole("heading", { name: current.title })).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText("Review needed")).toBeInTheDocument();
  });

  it("rejects a file preview that completes after the selected task changes", async () => {
    const pending = deferred<TaskFilePreview>();
    previewMocks.file.mockReturnValue(pending.promise);
    const first = task("first");
    const second = task("second");
    const view = render(<TaskDetailDialog {...props(first)} />);

    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    view.rerender(<TaskDetailDialog {...props(second)} />);
    await act(async () => pending.resolve(preview("first task output")));

    await waitFor(() => {
      expect(page().queryByText(/first task output/)).not.toBeInTheDocument();
      expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeDisabled();
    });
  });

  it("lets the user discard changes while a task is awaiting review", async () => {
    const onCancel = vi.fn(async () => {});
    render(<TaskDetailDialog {...props(task("review"), onCancel)} />);

    fireEvent.click(page().getByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });

  it("applies only selected files after each selected file has been previewed", async () => {
    const current = task("review");
    if (!current.result) throw new Error("Missing review fixture");
    current.result.changedFiles.push({
      ...current.result.changedFiles[0], path: "references.bib", kind: "added",
    });
    previewMocks.file.mockImplementation(async (_id: string, path: string) => ({ ...preview(path), path }));
    const input = props(current);
    render(<TaskDetailDialog {...input} />);

    expect(page().getByRole("button", { name: "Apply 2 selected" })).toBeDisabled();
    fireEvent.click(page().getAllByRole("button", { name: "Preview" })[0]);
    await page().findByText("before -> main.tex");
    expect(page().getByRole("button", { name: "Apply 2 selected" })).toBeDisabled();
    fireEvent.click(page().getByRole("checkbox", { name: "Apply references.bib" }));
    fireEvent.click(page().getByRole("button", { name: "Apply 1 selected" }));
    expect(input.onApply).toHaveBeenCalledWith(["main.tex"]);

    fireEvent.click(page().getByRole("button", { name: "Select all" }));
    expect(page().getByRole("button", { name: "Apply 2 selected" })).toBeDisabled();
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    await page().findByText("before -> references.bib");
    expect(page().getByRole("button", { name: "Apply 2 selected" })).toBeEnabled();
    fireEvent.click(page().getByRole("button", { name: "Clear selection" }));
    expect(page().getByRole("button", { name: "Apply 0 selected" })).toBeDisabled();
    expect(previewMocks.file.mock.calls).toEqual([[current.id, "main.tex"], [current.id, "references.bib"]]);
  });

  it("keeps applying disabled after a failed preview and recovers on retry", async () => {
    previewMocks.file.mockRejectedValueOnce(new Error("Preview no longer matches the saved task"));
    previewMocks.file.mockResolvedValueOnce(preview("recovered output"));
    render(<TaskDetailDialog {...props(task("review"))} />);

    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    expect(await page().findByRole("alert")).toHaveTextContent("Preview no longer matches");
    expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeDisabled();
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    await page().findByText("before -> recovered output");
    expect(page().queryByRole("alert")).not.toBeInTheDocument();
    expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeEnabled();
  });

  it("rejects a pending preview from the previous execution of the same task", async () => {
    const pending = deferred<TaskFilePreview>();
    previewMocks.file.mockReturnValue(pending.promise);
    const current = task("same-task");
    const view = render(<TaskDetailDialog {...props(current)} />);
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    const next = { ...task(current.id), executionGeneration: 2 };
    view.rerender(<TaskDetailDialog {...props(next)} />);
    await act(async () => pending.resolve(preview("previous execution output")));

    expect(page().queryByText(/previous execution output/)).not.toBeInTheDocument();
    expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeDisabled();
  });

  it("lets an unchanged result be reviewed without applying files", () => {
    const current = task("unchanged");
    if (!current.result) throw new Error("Missing review fixture");
    current.result.changedFiles = [];
    const input = props(current);
    const view = render(<TaskDetailDialog {...input} />);
    expect(page().getByText("No project files changed.")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Mark reviewed" }));
    expect(input.onAccept).toHaveBeenCalledOnce();
    expect(input.onApply).not.toHaveBeenCalled();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, status: "completed" }} />);
    expect(page().queryByRole("button", { name: "Mark reviewed" })).not.toBeInTheDocument();
  });

  it("shows dependency blockers and schedules a queued task without claiming it is running", () => {
    const current = { ...task("dependent"), status: "queued" as const, dependencyIds: ["dependency", "missing"] };
    const dependency = { ...task("dependency"), status: "running" as const };
    const input = { ...props(current), tasks: [current, dependency] };
    const view = render(<TaskDetailDialog {...input} />);

    expect(page().getByText("Task dependency")).toBeInTheDocument();
    expect(page().getByText("Unavailable")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Start when ready" }));
    fireEvent.click(page().getByRole("button", { name: "Edit" }));
    fireEvent.click(page().getByRole("button", { name: "Cancel" }));
    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onEdit).toHaveBeenCalledOnce();
    expect(input.onCancel).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, startRequested: true }} />);
    expect(page().getByRole("button", { name: "Waiting" })).toBeDisabled();
  });

  it("prevents repeated cancellation and permits retry after a failed run", () => {
    const current = { ...task("running"), status: "running" as const };
    const input = props(current);
    const view = render(<TaskDetailDialog {...input} />);
    fireEvent.click(page().getByRole("button", { name: "Stop task" }));
    expect(input.onCancel).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, cancelRequested: true }} />);
    expect(page().getByRole("button", { name: "Stopping..." })).toBeDisabled();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, status: "failed", error: "The agent disconnected" }} />);
    expect(page().getByRole("alert")).toHaveTextContent("The agent disconnected");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(input.onRetry).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} busy task={{ ...current, status: "cancelled" }} />);
    expect(page().getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  it("renders the transcript as a timeline with paired tool calls and folded usage", () => {
    const current = task("activity");
    const payloads: TaskRuntimeEvent[] = [
      { kind: "sessionBound", nativeSessionId: "native-session" },
      { kind: "status", message: "Reading sources" },
      { kind: "text", text: "Partial result" },
      { kind: "reasoning", text: "Compare the source measurements" },
      { kind: "tool", callId: "call_1", name: "read_file", phase: "request", detail: '{"path":"main.tex"}', status: "running" },
      { kind: "tool", callId: "call_1", name: "", phase: "result", detail: '{"path":"main.tex","content":"body"}', status: "done" },
      { kind: "artifact", artifact: { path: "report.md", label: "Evidence report", mediaType: "text/markdown" } },
      { kind: "usage", inputTokens: 74833, outputTokens: 1712 },
    ];
    const cliTask = { ...current, runtimeId: "acp", nativeSessionId: "native-session" };
    const input = {
      ...props(current), task: cliTask, tasks: [cliTask], canLoadMoreEvents: true, onOpenSession: vi.fn(),
      events: payloads.map((event, index) => ({ taskId: current.id, executionGeneration: 1, sequence: index + 1, event, createdAt: index })),
    };
    const view = render(<TaskDetailDialog {...input} />);
    openTab("Activity");
    expect(page().getByText("Session connected.")).toBeInTheDocument();
    expect(page().getByText("Reading sources")).toBeInTheDocument();
    expect(page().getByText("Partial result")).toBeInTheDocument();
    expect(page().queryByText("Compare the source measurements")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Reported reasoning" }));
    expect(page().getByText("Compare the source measurements")).toBeInTheDocument();

    const card = page().getByTestId("research-tool-card");
    expect(card).toHaveTextContent("Read file");
    expect(card).not.toHaveTextContent("call_1");
    expect(page().queryByText(/Usage:/)).toBeNull();
    expect(page().getByText("Input 75k, output 1.7k")).toBeInTheDocument();
    expect(page().getByRole("button", { name: "Saved Evidence report" })).toBeInTheDocument();

    fireEvent.click(page().getByRole("button", { name: "Open session" }));
    fireEvent.click(page().getByRole("button", { name: "Load more activity" }));
    expect(input.onOpenSession).toHaveBeenCalledWith(cliTask);
    expect(input.onLoadMoreEvents).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} eventsLoading />);
    expect(page().getByRole("button", { name: "Load more activity" })).toBeDisabled();
    expect(page().getByRole("status")).toHaveTextContent("Loading activity");
  });

  it("marks an unfinished tool as interrupted and flags the failure milestone", () => {
    const current = {
      ...task("stopped"),
      status: "failed" as const,
      error: "The request timed out.",
    };
    const input = {
      ...props(current),
      events: [
        { kind: "status" as const, message: "Reading sources" },
        { kind: "tool" as const, name: "compile", detail: "{}" },
        { kind: "status" as const, message: "The request timed out." },
      ].map((event, index) => ({
        taskId: current.id,
        executionGeneration: 1,
        sequence: index + 1,
        event,
        createdAt: index,
      })),
    };
    render(<TaskDetailDialog {...input} />);
    openTab("Activity");

    const card = page().getByTestId("research-tool-card");
    expect(card).toHaveAttribute("data-research-status", "interrupted");
    expect(card).toHaveTextContent("Interrupted");
    expect(card).toHaveTextContent("Compile document");
    const activity = document.querySelector(
      'section[aria-labelledby="research-task-activity"]',
    ) as HTMLElement;
    expect(within(activity).getByText("The request timed out.")).toHaveClass("text-destructive");
  });

  it("expands a tool card to reveal its output instead of dumping it inline", () => {
    const current = task("tools");
    const input = {
      ...props(current),
      events: [
        { kind: "tool" as const, callId: "call_2", name: "literature_search", phase: "request" as const, detail: '{"query":"edge"}', status: "running" },
        { kind: "tool" as const, callId: "call_2", name: "", phase: "result" as const, detail: '{"results":[{"title":"A paper","publication_year":2024}]}', status: "done" },
      ].map((event, index) => ({ taskId: current.id, executionGeneration: 1, sequence: index + 1, event, createdAt: index })),
    };
    render(<TaskDetailDialog {...input} />);
    openTab("Activity");
    expect(page().queryByText(/A paper/)).toBeNull();
    fireEvent.click(page().getByRole("button", { name: /Search literature/ }));
    expect(page().getByText("A paper")).toBeInTheDocument();
  });

  it("previews a saved artifact from the activity timeline in the output tab", async () => {
    const current = task("timeline-artifact");
    if (!current.result) throw new Error("Missing review fixture");
    const artifact = { path: "report.md", label: "Evidence report", mediaType: "text/markdown" };
    current.result.artifacts = [artifact];
    previewMocks.artifact.mockResolvedValue({
      artifact,
      content: { exists: true, text: "Saved evidence", base64: null, mediaType: "text/markdown", binary: false, truncated: false, size: 14, sha256: "sha" },
    });
    render(
      <TaskDetailDialog
        {...props(current)}
        events={[
          {
            taskId: current.id,
            executionGeneration: 1,
            sequence: 1,
            event: { kind: "artifact", artifact },
            createdAt: 1,
          },
        ]}
      />,
    );
    openTab("Activity");
    fireEvent.click(page().getByRole("button", { name: "Saved Evidence report" }));
    await waitFor(() => expect(page().getByText("Saved evidence")).toBeInTheDocument());
    expect(previewMocks.artifact).toHaveBeenCalledWith(current.id, artifact.path);
  }, 10_000);

  it.each(["text", "image", "binary"] as const)("previews a %s artifact without offering a dead open action", async (kind) => {
    const current = task("artifact");
    if (!current.result) throw new Error("Missing review fixture");
    const artifact = { path: "report.bin", label: "Evidence artifact", mediaType: null };
    current.result.artifacts = [artifact];
    const content: TaskArtifactPreview["content"] = {
      exists: true, text: kind === "text" ? "Evidence from the saved task" : null,
      base64: kind === "image" ? "aW1hZ2U=" : null,
      mediaType: kind === "image" ? "image/png" : null,
      binary: kind !== "text", truncated: false, size: 32, sha256: "artifact-sha",
    };
    previewMocks.artifact.mockResolvedValue({ artifact, content });
    render(<TaskDetailDialog {...props(current)} />);
    openTab("Output");
    fireEvent.click(page().getByRole("button", { name: "Evidence artifactreport.bin" }));
    await waitFor(() => expect(page().getByText("Evidence artifact", { selector: "p" })).toBeInTheDocument());
    if (kind === "text") expect(page().getByText("Evidence from the saved task")).toBeInTheDocument();
    if (kind === "image") expect(page().getByRole("img", { name: artifact.label })).toHaveAttribute("src", "data:image/png;base64,aW1hZ2U=");
    if (kind === "binary") expect(page().getByText(/Binary file · 32 bytes/)).toBeInTheDocument();
    expect(page().queryByRole("button", { name: "Open elsewhere" })).not.toBeInTheDocument();
    expect(previewMocks.artifact).toHaveBeenCalledWith(current.id, artifact.path);
  });

  it("warns and blocks a file that changed in the project after the task started", async () => {
    const current = task("drifted");
    previewMocks.file.mockResolvedValue({
      ...preview("after"),
      projectSha256: "someone-else-edited-it",
      baseIsCurrent: false,
    });
    render(<TaskDetailDialog {...props(current)} />);
    expect(page().getByRole("checkbox", { name: "Apply main.tex" })).toBeChecked();
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(page().getByRole("alert")).toHaveTextContent("changed in your project after this task started"),
    );
    const checkbox = page().getByRole("checkbox", { name: "Apply main.tex" });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(page().getByRole("button", { name: "Apply 0 selected" })).toBeDisabled();
  });

  it("keeps loaded previews and the reviewer's selection when the same run is refreshed", async () => {
    const current = task("refresh");
    previewMocks.file.mockResolvedValue(preview("after"));
    const input = props(current);
    const view = render(<TaskDetailDialog {...input} />);
    fireEvent.click(page().getByRole("checkbox", { name: "Apply main.tex" }));
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    await page().findByRole("button", { name: "Refresh preview" });

    const refreshed = JSON.parse(JSON.stringify(current)) as ResearchTask;
    view.rerender(<TaskDetailDialog {...input} task={refreshed} tasks={[refreshed]} />);

    expect(page().getByRole("button", { name: "Refresh preview" })).toBeInTheDocument();
    expect(page().getByRole("checkbox", { name: "Apply main.tex" })).not.toBeChecked();
  });

  it("offers deletion for a settled task and hides it while the task runs", () => {
    const current = task("removable");
    const input = props(current);
    const view = render(<TaskDetailDialog {...input} />);
    fireEvent.click(page().getByRole("button", { name: `Delete ${current.title}` }));
    expect(input.onDelete).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, status: "running" }} />);
    expect(page().queryByRole("button", { name: `Delete ${current.title}` })).not.toBeInTheDocument();
  });
});
