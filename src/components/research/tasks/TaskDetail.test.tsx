import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskArtifactPreview, TaskFilePreview, TaskRuntimeEvent } from "@/lib/research-tasks";

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

  it("applies only selected files after each selected file has been previewed", async () => {
    const current = task("review");
    if (!current.result) throw new Error("Missing review fixture");
    current.result.changedFiles.push({
      ...current.result.changedFiles[0], path: "references.bib", kind: "added",
    });
    previewMocks.file.mockImplementation(async (_id: string, path: string) => ({ ...preview(path), path }));
    const input = props(current);
    render(<TaskDetail {...input} />);

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
    render(<TaskDetail {...props(task("review"))} />);

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
    const view = render(<TaskDetail {...props(current)} />);
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    const next = { ...task(current.id), executionGeneration: 2 };
    view.rerender(<TaskDetail {...props(next)} />);
    await act(async () => pending.resolve(preview("previous execution output")));

    expect(page().queryByText(/previous execution output/)).not.toBeInTheDocument();
    expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeDisabled();
  });

  it("lets an unchanged result be reviewed without applying files", () => {
    const current = task("unchanged");
    if (!current.result) throw new Error("Missing review fixture");
    current.result.changedFiles = [];
    const input = props(current);
    const view = render(<TaskDetail {...input} />);
    expect(page().getByText("No project files changed.")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Mark reviewed" }));
    expect(input.onAccept).toHaveBeenCalledOnce();
    expect(input.onApply).not.toHaveBeenCalled();
    view.rerender(<TaskDetail {...input} task={{ ...current, status: "completed" }} />);
    expect(page().queryByRole("button", { name: "Mark reviewed" })).not.toBeInTheDocument();
  });

  it("shows dependency blockers and schedules a queued task without claiming it is running", () => {
    const current = { ...task("dependent"), status: "queued" as const, dependencyIds: ["dependency", "missing"] };
    const dependency = { ...task("dependency"), status: "running" as const };
    const input = { ...props(current), tasks: [current, dependency] };
    const view = render(<TaskDetail {...input} />);

    expect(page().getByText("Task dependency")).toBeInTheDocument();
    expect(page().getByText("Unavailable")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Start when ready" }));
    fireEvent.click(page().getByRole("button", { name: "Edit" }));
    fireEvent.click(page().getByRole("button", { name: "Cancel" }));
    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onEdit).toHaveBeenCalledOnce();
    expect(input.onCancel).toHaveBeenCalledOnce();
    view.rerender(<TaskDetail {...input} task={{ ...current, startRequested: true }} />);
    expect(page().getByRole("button", { name: "Waiting" })).toBeDisabled();
  });

  it("prevents repeated cancellation and permits retry after a failed run", () => {
    const current = { ...task("running"), status: "running" as const };
    const input = props(current);
    const view = render(<TaskDetail {...input} />);
    fireEvent.click(page().getByRole("button", { name: "Stop task" }));
    expect(input.onCancel).toHaveBeenCalledOnce();
    view.rerender(<TaskDetail {...input} task={{ ...current, cancelRequested: true }} />);
    expect(page().getByRole("button", { name: "Stopping..." })).toBeDisabled();
    view.rerender(<TaskDetail {...input} task={{ ...current, status: "failed", error: "The agent disconnected" }} />);
    expect(page().getByRole("alert")).toHaveTextContent("The agent disconnected");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(input.onRetry).toHaveBeenCalledOnce();
    view.rerender(<TaskDetail {...input} busy task={{ ...current, status: "cancelled" }} />);
    expect(page().getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  it("shows transcript event contents, unknown usage, pagination and the linked session", () => {
    const current = task("activity");
    const payloads: TaskRuntimeEvent[] = [
      { kind: "sessionBound", nativeSessionId: "native-session" },
      { kind: "status", message: "Reading sources" },
      { kind: "text", text: "Partial result" },
      { kind: "reasoning", text: "Compare the source measurements" },
      { kind: "tool", name: "read_file", detail: "main.tex" },
      { kind: "artifact", artifact: { path: "report.md", label: "Evidence report", mediaType: "text/markdown" } },
      { kind: "usage", inputTokens: null, outputTokens: 0 },
    ];
    const input = {
      ...props(current), canLoadMoreEvents: true, onOpenSession: vi.fn(),
      events: payloads.map((event, index) => ({ taskId: current.id, executionGeneration: 1, sequence: index + 1, event, createdAt: index })),
    };
    const view = render(<TaskDetail {...input} />);
    expect(page().getByText("Session connected.")).toBeInTheDocument();
    expect(page().getByText("Reading sources")).toBeInTheDocument();
    expect(page().getByText("Partial result")).toBeInTheDocument();
    expect(page().getByText("Reported reasoning")).toBeInTheDocument();
    expect(page().getByText("read_file").parentElement).toHaveTextContent("main.tex");
    expect(page().getByText("Saved Evidence report.")).toBeInTheDocument();
    expect(page().getByText("Usage: unknown input, 0 output tokens.")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Open session" }));
    fireEvent.click(page().getByRole("button", { name: "Load more" }));
    expect(input.onOpenSession).toHaveBeenCalledWith(current);
    expect(input.onLoadMoreEvents).toHaveBeenCalledOnce();
    view.rerender(<TaskDetail {...input} eventsLoading />);
    expect(page().getByRole("button", { name: "Load more" })).toBeDisabled();
    expect(page().getByRole("status")).toHaveTextContent("Loading activity");
  });

  it.each(["text", "image", "binary"] as const)("previews a %s artifact and opens the selected artifact elsewhere", async (kind) => {
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
    const input = { ...props(current), onOpenArtifact: vi.fn() };
    render(<TaskDetail {...input} />);
    fireEvent.click(page().getByRole("button", { name: "Evidence artifactreport.bin" }));
    await page().findByRole("button", { name: "Open elsewhere" });
    if (kind === "text") expect(page().getByText("Evidence from the saved task")).toBeInTheDocument();
    if (kind === "image") expect(page().getByRole("img", { name: artifact.label })).toHaveAttribute("src", "data:image/png;base64,aW1hZ2U=");
    if (kind === "binary") expect(page().getByText(/Binary file · 32 bytes/)).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Open elsewhere" }));
    expect(previewMocks.artifact).toHaveBeenCalledWith(current.id, artifact.path);
    expect(input.onOpenArtifact).toHaveBeenCalledWith(current, artifact);
  });
});
