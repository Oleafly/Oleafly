import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalRecord,
  EvidenceReport,
  ResearchTask,
  TaskArtifactPreview,
  TaskFilePreview,
  TaskIsolationSummary,
  TaskProgress,
  TaskRuntimeEvent,
} from "@/lib/research-tasks";
import { formatDateTime } from "@/lib/intl";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { taskFieldsSince047 } from "./tests/task-fixtures";

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
  events: vi.fn(),
  keepRunning: vi.fn(),
  config: vi.fn(),
  plan: vi.fn(),
  progress: vi.fn(),
  runLog: vi.fn(),
  cancelRun: vi.fn(),
  approvals: vi.fn(),
  decide: vi.fn(),
}));

vi.mock("@/lib/research-tasks", () => ({
  previewResearchTaskFile: previewMocks.file,
  previewResearchTaskArtifact: previewMocks.artifact,
  loadResearchTaskEvents: previewMocks.events,
  setResearchTaskKeepRunning: previewMocks.keepRunning,
  loadResearchTaskPlan: previewMocks.plan,
  progressResearchTask: previewMocks.progress,
  researchTaskRunLog: previewMocks.runLog,
  cancelResearchTaskRun: previewMocks.cancelRun,
  listResearchTaskApprovals: previewMocks.approvals,
  decideResearchTaskApproval: previewMocks.decide,
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  getConfig: previewMocks.config,
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
    ...taskFieldsSince047(),
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
    mergesWithShared: false,
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
    previewMocks.events.mockReset();
    previewMocks.keepRunning.mockReset();
    previewMocks.config.mockReset().mockResolvedValue({ research_background_enabled: true });
    previewMocks.plan.mockReset().mockResolvedValue("- [ ] Measure the baseline");
    previewMocks.progress.mockReset();
    previewMocks.runLog.mockReset();
    previewMocks.cancelRun.mockReset();
    previewMocks.approvals.mockReset().mockResolvedValue([]);
    previewMocks.decide.mockReset();
  });

  afterEach(() => cleanup());

  // 0.4.8 L: the background helper.

  it("the detail dialog toggles keep running and loads earlier activity", async () => {
    previewMocks.keepRunning.mockResolvedValue(undefined);
    previewMocks.events.mockImplementation(async (taskId: string, generation: number) => ({
      events: [
        {
          taskId,
          executionGeneration: generation,
          sequence: 1,
          event: { kind: "status", message: `Generation ${generation} notes` },
          createdAt: 1,
        },
      ],
      nextSequence: null,
    }));
    const current: ResearchTask = {
      ...task("resumed"),
      status: "running",
      executionGeneration: 3,
      resumedFrom: 2,
      keepRunningAfterQuit: false,
    };
    render(<TaskDetailDialog {...props(current)} />);

    const keep = page().getByRole("checkbox", { name: enResearchTools.brief.keepRunning });
    expect(keep).toBeEnabled();
    fireEvent.click(keep);
    await waitFor(() => expect(previewMocks.keepRunning).toHaveBeenCalledWith("resumed", true));

    const earlier = enResearchTools.backgroundHelper.earlierActivity;
    fireEvent.click(page().getByRole("button", { name: earlier }));
    expect(await page().findByText("Generation 2 notes")).toBeInTheDocument();
    expect(previewMocks.events).toHaveBeenCalledWith("resumed", 2, undefined, 200);
    // Repeatable down the chain, to the first generation.
    fireEvent.click(page().getByRole("button", { name: earlier }));
    expect(await page().findByText("Generation 1 notes")).toBeInTheDocument();
    expect(page().queryByRole("button", { name: earlier })).not.toBeInTheDocument();
  });

  it("keeps the keep-running choice fixed for finished tasks and while background tasks are off", async () => {
    const finished = render(<TaskDetailDialog {...props(task("finished"))} />);
    expect(page().getByRole("checkbox", { name: enResearchTools.brief.keepRunning })).toBeDisabled();
    finished.unmount();

    previewMocks.config.mockResolvedValue({ research_background_enabled: false });
    render(<TaskDetailDialog {...props({ ...task("waiting"), status: "queued" })} />);
    expect(await page().findByText(enResearchTools.brief.keepRunningHint)).toBeInTheDocument();
    expect(
      page().getByRole("checkbox", { name: new RegExp(enResearchTools.brief.keepRunning) }),
    ).toBeDisabled();
    expect(page().queryByRole("button", { name: enResearchTools.backgroundHelper.earlierActivity })).toBeNull();
  });

  it("shows where a helper task runs beside its status", () => {
    const current: ResearchTask = {
      ...task("helper"),
      status: "running",
      owner: "daemon",
      reclaimRequested: true,
    };
    render(<TaskDetailDialog {...props(current)} />);
    expect(page().getByText(enResearchTools.backgroundHelper.badge.movingBack)).toBeInTheDocument();
  });

  it("renders the task body inside the dialog the review specs scope on", () => {
    const current = task("scoped");
    render(<TaskDetailDialog {...props(current)} />);
    const dialog = page().getByRole("dialog");
    const detail = dialog.querySelector('article[aria-labelledby="research-task-detail-title"]');
    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).getByRole("heading", { name: current.title })).toBeInTheDocument();
    expect(within(detail as HTMLElement).getByText(enResearchTools.tasks.status.awaitingReview)).toBeInTheDocument();
  });

  it("shows a stored read-only folder refusal as its sentence", () => {
    const current = {
      ...task("refused"),
      error: `@oleafly/error:${JSON.stringify({
        code: "project.folder_read_only",
        params: { name: "main.tex" },
        detail: null,
      })}`,
    };
    render(<TaskDetailDialog {...props(current)} />);
    const alert = page().getByText(enResearchTools.tasks.detail.needsAttention).parentElement as HTMLElement;
    expect(
      within(alert).getByText(
        "Oleafly can't make this change because main.tex or its folder is read-only. Copy the folder you opened into your library and edit it there.",
      ),
    ).toBeInTheDocument();
    expect(alert.textContent).not.toContain("@oleafly/error:");
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

    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.discardChanges }));

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

    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.selectAll }));
    expect(page().getByRole("button", { name: "Apply 2 selected" })).toBeDisabled();
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    await page().findByText("before -> references.bib");
    expect(page().getByRole("button", { name: "Apply 2 selected" })).toBeEnabled();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.clearSelection }));
    expect(page().getByRole("button", { name: "Apply 0 selected" })).toBeDisabled();
    expect(previewMocks.file.mock.calls).toEqual([[current.id, "main.tex"], [current.id, "references.bib"]]);
  });

  it("lists the research record on its own and needs a preview only of the project's files", async () => {
    const current = { ...task("record"), recordDir: "research/notes-1a2b" };
    if (!current.result) throw new Error("Missing review fixture");
    current.result.changedFiles.push(
      { ...current.result.changedFiles[0], path: "research/notes-1a2b/ledger.tsv", kind: "added" },
      { ...current.result.changedFiles[0], path: "research/notes-1a2b/handoff.md", kind: "added" },
    );
    previewMocks.file.mockImplementation(async (_id: string, path: string) => ({ ...preview(path), path }));
    const input = props(current);
    render(<TaskDetailDialog {...input} />);

    const record = page().getByRole("region", { name: enResearchTools.tasks.detail.researchRecord });
    expect(within(record).getByText("research/notes-1a2b/ledger.tsv")).toBeInTheDocument();
    expect(within(record).queryByText("main.tex")).not.toBeInTheDocument();
    expect(page().getByRole("button", { name: "Apply 3 selected" })).toBeDisabled();
    fireEvent.click(page().getAllByRole("button", { name: "Preview" })[0]);
    await page().findByText("before -> main.tex");
    fireEvent.click(page().getByRole("button", { name: "Apply 3 selected" }));
    expect(input.onApply).toHaveBeenCalledWith([
      "main.tex",
      "research/notes-1a2b/ledger.tsv",
      "research/notes-1a2b/handoff.md",
    ]);
  });

  it("applies a review of only the research record without previews", () => {
    const current = { ...task("record-only"), recordDir: "research/notes-1a2b" };
    if (!current.result) throw new Error("Missing review fixture");
    current.result.changedFiles = [
      { ...current.result.changedFiles[0], path: "research/notes-1a2b/ledger.tsv", kind: "added" },
    ];
    const input = props(current);
    render(<TaskDetailDialog {...input} />);

    expect(page().queryByText(enResearchTools.tasks.detail.previewBeforeApply)).not.toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Apply 1 selected" }));
    expect(input.onApply).toHaveBeenCalledWith(["research/notes-1a2b/ledger.tsv"]);
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
    expect(page().getByText(enResearchTools.tasks.detail.noFilesChanged)).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.markReviewed }));
    expect(input.onAccept).toHaveBeenCalledOnce();
    expect(input.onApply).not.toHaveBeenCalled();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, status: "completed" }} />);
    expect(page().queryByRole("button", { name: enResearchTools.tasks.detail.markReviewed })).not.toBeInTheDocument();
  });

  it("shows dependency blockers and schedules a queued task without claiming it is running", () => {
    const current = { ...task("dependent"), status: "queued" as const, dependencyIds: ["dependency", "missing"] };
    const dependency = { ...task("dependency"), status: "running" as const };
    const input = { ...props(current), tasks: [current, dependency] };
    const view = render(<TaskDetailDialog {...input} />);

    expect(page().getByText("Task dependency")).toBeInTheDocument();
    expect(page().getByText("Unavailable")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.startWhenReady }));
    fireEvent.click(page().getByRole("button", { name: enCommon.actions.edit }));
    fireEvent.click(page().getByRole("button", { name: enCommon.actions.cancel }));
    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onEdit).toHaveBeenCalledOnce();
    expect(input.onCancel).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, startRequested: true }} />);
    expect(page().getByRole("button", { name: enResearchTools.tasks.detail.waiting })).toBeDisabled();
  });

  it("prevents repeated cancellation and permits retry after a failed run", () => {
    const current = { ...task("running"), status: "running" as const };
    const input = props(current);
    const view = render(<TaskDetailDialog {...input} />);
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.stopTask }));
    expect(input.onCancel).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, cancelRequested: true }} />);
    expect(page().getByRole("button", { name: enResearchTools.tasks.detail.stopping })).toBeDisabled();
    view.rerender(<TaskDetailDialog {...input} task={{ ...current, status: "failed", error: "The agent disconnected" }} />);
    expect(page().getByRole("alert")).toHaveTextContent("The agent disconnected");
    fireEvent.click(page().getByRole("button", { name: enCommon.actions.retry }));
    expect(input.onRetry).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} busy task={{ ...current, status: "cancelled" }} />);
    expect(page().getByRole("button", { name: enCommon.actions.retry })).toBeDisabled();
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
    openTab(enResearchTools.tasks.detail.tabActivity);
    expect(page().getByText(enResearchTools.tasks.timeline.sessionConnected)).toBeInTheDocument();
    expect(page().getByText("Reading sources")).toBeInTheDocument();
    expect(page().getByText("Partial result")).toBeInTheDocument();
    expect(page().queryByText("Compare the source measurements")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.reasoning }));
    expect(page().getByText("Compare the source measurements")).toBeInTheDocument();

    const card = page().getByTestId("research-tool-card");
    expect(card).toHaveTextContent("Read file");
    expect(card).not.toHaveTextContent("call_1");
    expect(page().queryByText(/Usage:/)).toBeNull();
    expect(page().getByText("Input 75k, output 1.7k")).toBeInTheDocument();
    expect(page().getByRole("button", { name: "Saved Evidence report" })).toBeInTheDocument();

    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.openSession }));
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.loadMore }));
    expect(input.onOpenSession).toHaveBeenCalledWith(cliTask);
    expect(input.onLoadMoreEvents).toHaveBeenCalledOnce();
    view.rerender(<TaskDetailDialog {...input} eventsLoading />);
    expect(page().getByRole("button", { name: enResearchTools.tasks.detail.loadMore })).toBeDisabled();
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
    openTab(enResearchTools.tasks.detail.tabActivity);

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
    openTab(enResearchTools.tasks.detail.tabActivity);
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
    openTab(enResearchTools.tasks.detail.tabActivity);
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
    openTab(enResearchTools.tasks.detail.tabOutput);
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

  it("keeps a changed file selected when applying merges it through the shared project", async () => {
    const current = task("merging");
    previewMocks.file.mockResolvedValue({
      ...preview("after"),
      projectSha256: "a-collaborator-edited-it",
      baseIsCurrent: false,
      mergesWithShared: true,
    });
    render(<TaskDetailDialog {...props(current)} />);
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    await page().findByRole("button", { name: enResearchTools.tasks.detail.refreshPreview });

    const checkbox = page().getByRole("checkbox", { name: "Apply main.tex" });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(page().queryByRole("alert")).not.toBeInTheDocument();
    expect(page().queryByText(enResearchTools.tasks.detail.changedSince)).not.toBeInTheDocument();
    expect(page().getByText(enResearchTools.tasks.detail.mergesOnApply)).toBeInTheDocument();
    expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeEnabled();
  });

  it("keeps loaded previews and the reviewer's selection when the same run is refreshed", async () => {
    const current = task("refresh");
    previewMocks.file.mockResolvedValue(preview("after"));
    const input = props(current);
    const view = render(<TaskDetailDialog {...input} />);
    fireEvent.click(page().getByRole("checkbox", { name: "Apply main.tex" }));
    fireEvent.click(page().getByRole("button", { name: "Preview" }));
    await page().findByRole("button", { name: enResearchTools.tasks.detail.refreshPreview });

    const refreshed = JSON.parse(JSON.stringify(current)) as ResearchTask;
    view.rerender(<TaskDetailDialog {...input} task={refreshed} tasks={[refreshed]} />);

    expect(page().getByRole("button", { name: enResearchTools.tasks.detail.refreshPreview })).toBeInTheDocument();
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

  describe("review details", () => {
    const detail = enResearchTools.tasks.detail;

    function binaryPreview(path: string, before: boolean, after: boolean): TaskFilePreview {
      const side = (exists: boolean, size: number) => ({
        exists, text: null, base64: null, mediaType: "application/pdf", binary: true, truncated: false, size, sha256: `${size}`,
      });
      return {
        path,
        change: before ? (after ? "modified" : "deleted") : "added",
        before: side(before, 10),
        after: side(after, 20),
        projectSha256: "10",
        baseIsCurrent: true,
        mergesWithShared: false,
      };
    }

    function withFiles(...files: { path: string; kind: "added" | "modified" | "deleted" }[]) {
      const current = task("files");
      if (!current.result) throw new Error("Missing review fixture");
      current.result.changedFiles = files.map((file) => ({
        ...file, beforeSha256: null, afterSha256: null, beforeSize: null, afterSize: null,
      })) as never;
      return current;
    }

    it("labels added and deleted files and sizes binary previews", async () => {
      const current = withFiles({ path: "fig.pdf", kind: "added" }, { path: "old.pdf", kind: "deleted" });
      previewMocks.file.mockImplementation(async (_id: string, path: string) =>
        path === "fig.pdf" ? binaryPreview(path, false, true) : binaryPreview(path, true, false),
      );
      render(<TaskDetailDialog {...props(current)} />);

      expect(page().getByText(detail.changeAdded)).toBeInTheDocument();
      expect(page().getByText(detail.changeDeleted)).toBeInTheDocument();
      const [first, second] = page().getAllByRole("button", { name: "Preview" });
      fireEvent.click(first);
      await waitFor(() => expect(page().getByText(detail.beforeAbsent)).toBeInTheDocument());
      expect(page().getByText(detail.afterBytes.replace("{{size}}", "20"))).toBeInTheDocument();
      fireEvent.click(second);
      await waitFor(() => expect(page().getByText(detail.afterAbsent)).toBeInTheDocument());
      expect(page().getByText(detail.beforeBytes.replace("{{size}}", "10"))).toBeInTheDocument();
    });

    it("counts several files that changed in the project since the task started", async () => {
      const current = withFiles({ path: "a.tex", kind: "modified" }, { path: "b.tex", kind: "modified" });
      previewMocks.file.mockImplementation(async (_id: string, path: string) => ({
        ...preview("after"),
        path,
        baseIsCurrent: false,
      }));
      render(<TaskDetailDialog {...props(current)} />);

      for (const button of page().getAllByRole("button", { name: "Preview" })) fireEvent.click(button);

      await waitFor(() =>
        expect(page().getByRole("alert")).toHaveTextContent(detail.driftedMany.replace("{{fileCount}}", "2")),
      );
    });

    it("selects files that merge through the shared project but not blocked ones with Select all", async () => {
      const current = withFiles({ path: "a.tex", kind: "modified" }, { path: "b.tex", kind: "modified" });
      previewMocks.file.mockImplementation(async (_id: string, path: string) => ({
        ...preview("after"),
        path,
        baseIsCurrent: false,
        mergesWithShared: path === "a.tex",
      }));
      render(<TaskDetailDialog {...props(current)} />);
      for (const button of page().getAllByRole("button", { name: "Preview" })) fireEvent.click(button);
      await waitFor(() =>
        expect(page().getAllByRole("button", { name: detail.refreshPreview })).toHaveLength(2),
      );
      const merging = page().getByRole("checkbox", { name: "Apply a.tex" });
      const blocked = page().getByRole("checkbox", { name: "Apply b.tex" });

      fireEvent.click(merging);
      expect(merging).not.toBeChecked();
      fireEvent.click(page().getByRole("button", { name: detail.selectAll }));

      expect(merging).toBeChecked();
      expect(blocked).not.toBeChecked();
      expect(blocked).toBeDisabled();
      expect(page().getByRole("alert")).toHaveTextContent(detail.driftedOne.replace("{{path}}", "b.tex"));
    });

    it("shows why a file preview failed", async () => {
      previewMocks.file.mockRejectedValueOnce(new Error("snapshot pruned"));
      render(<TaskDetailDialog {...props(task("broken"))} />);

      fireEvent.click(page().getByRole("button", { name: "Preview" }));

      await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("snapshot pruned"));
    });

    it("shows why an artifact preview failed", async () => {
      const current = task("artifact-failure");
      if (!current.result) throw new Error("Missing review fixture");
      current.result.artifacts = [{ path: "out.csv", label: "Table", mediaType: "text/csv" }];
      previewMocks.artifact.mockRejectedValueOnce("artifact missing");
      render(<TaskDetailDialog {...props(current)} />);
      openTab(detail.tabOutput);

      fireEvent.click(page().getByRole("button", { name: "Tableout.csv" }));

      await waitFor(() => expect(page().getByText("artifact missing")).toBeInTheDocument());
    });

    it("names a Git worktree as the task's isolation", () => {
      render(
        <TaskDetailDialog
          {...props({ ...task("worktree"), isolation: { kind: "git_worktree" } as never })}
        />,
      );

      expect(page().getByText(new RegExp(detail.isolationWorktree))).toBeInTheDocument();
    });

    it("lets the reviewer clear and restore the file selection", () => {
      render(<TaskDetailDialog {...props(task("select"))} />);
      const checkbox = page().getByRole("checkbox", { name: "Apply main.tex" });

      fireEvent.click(page().getByRole("button", { name: detail.clearSelection }));
      expect(checkbox).not.toBeChecked();
      fireEvent.click(page().getByRole("button", { name: detail.selectAll }));
      expect(checkbox).toBeChecked();
      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it("opens on the requested tab and says when a result has no summary", () => {
      const current = { ...task("quiet"), status: "completed" as const };
      if (!current.result) throw new Error("Missing review fixture");
      current.result.summary = "";
      render(<TaskDetailDialog {...props(current)} initialTab="output" />);

      expect(page().getByText(detail.noSummary)).toBeInTheDocument();
    });

    it("opens a finished task without output on its activity", () => {
      render(<TaskDetailDialog {...props({ ...task("bare"), status: "failed", result: null })} />);

      expect(page().getByRole("tab", { name: detail.tabActivity })).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("autoresearch", () => {
    const detail = enResearchTools.tasks.detail;
    const plan = enResearchTools.tasks.plan;
    const squash = (value: string) => value.replace(/\s+/g, " ").trim();
    const workspace: TaskIsolationSummary = {
      kind: "staged_project",
      executionRoot: "/tasks/workspaces/failed/1",
      sourceRevision: "snapshot:base",
      baselineHash: "baseline",
      fileCount: 3,
      createdAt: 1,
    };

    function progressFixture(): TaskProgress {
      return {
        phase: "working",
        plan: [{ text: "Measure the baseline", done: false }],
        todos: [],
        ledger: [],
        best: null,
        runsInFlight: [],
        recentRuns: [],
        budget: { activeMinutes: 3, limitMinutes: 120, spentUsd: null, usdCap: null, runsStarted: 0, maxRuns: null },
        evidence: null,
        recordDir: "research/task-1a2b",
      };
    }

    function approvalRecord(id: string, taskId: string): ApprovalRecord {
      return {
        id,
        taskId,
        executionGeneration: 1,
        kind: "command",
        summary: `Install the packages for ${taskId}`,
        detail: "pip install -r requirements.txt",
        status: "pending",
        createdAt: 1,
        expiresAt: Date.UTC(2026, 9, 20, 9, 30),
        decidedAt: null,
      };
    }

    it("shows the phase of a running task and when a queued task starts", () => {
      const running: ResearchTask = { ...task("live"), status: "running", phase: "waiting_runs", result: null };
      const view = render(<TaskDetailDialog {...props(running)} />);
      expect(page().getByTestId("research-task-phase")).toHaveTextContent("Waiting for runs");

      view.rerender(<TaskDetailDialog {...props({ ...running, phase: null })} />);
      expect(page().queryByTestId("research-task-phase")).toBeNull();

      const runAfter = Date.UTC(2026, 9, 20, 9, 30);
      view.rerender(<TaskDetailDialog {...props({ ...running, status: "queued", runAfter })} />);
      expect(page().queryByTestId("research-task-phase")).toBeNull();
      expect(
        page().getByText(squash(detail.startsAt.replace("{{time}}", formatDateTime(new Date(runAfter))))),
      ).toBeInTheDocument();

      view.rerender(<TaskDetailDialog {...props({ ...running, status: "queued", runAfter: null })} />);
      expect(page().queryByText(/^Starts /)).toBeNull();
    });

    it("says why a task stopped at its budget once it is no longer running", () => {
      const stopped: ResearchTask = { ...task("budget"), stopReason: "budget_time" };
      const view = render(<TaskDetailDialog {...props(stopped)} />);
      expect(page().getByTestId("research-task-stop-reason")).toHaveTextContent(detail.stopReason.budgetTime);

      view.rerender(<TaskDetailDialog {...props({ ...stopped, stopReason: "budget_cost" })} />);
      expect(page().getByTestId("research-task-stop-reason")).toHaveTextContent(detail.stopReason.budgetCost);

      view.rerender(<TaskDetailDialog {...props({ ...stopped, stopReason: "budget_runs" })} />);
      expect(page().getByTestId("research-task-stop-reason")).toHaveTextContent(detail.stopReason.budgetRuns);

      view.rerender(<TaskDetailDialog {...props({ ...stopped, status: "running", result: null })} />);
      expect(page().queryByTestId("research-task-stop-reason")).toBeNull();
    });

    it("offers Resume and Start over for a failed task with a workspace", () => {
      const failed: ResearchTask = {
        ...task("failed"),
        status: "failed",
        isolation: workspace,
        result: null,
        error: "The agent disconnected",
      };
      const input = props(failed);
      const view = render(<TaskDetailDialog {...input} />);

      expect(page().queryByRole("button", { name: enCommon.actions.retry })).toBeNull();
      fireEvent.click(page().getByRole("button", { name: detail.resume }));
      fireEvent.click(page().getByRole("button", { name: detail.startOver }));
      expect(input.onRetry.mock.calls).toEqual([["resume"], ["fresh"]]);

      view.rerender(<TaskDetailDialog {...input} busy task={{ ...failed, status: "cancelled" }} />);
      expect(page().getByRole("button", { name: detail.resume })).toBeDisabled();
      expect(page().getByRole("button", { name: detail.startOver })).toBeDisabled();

      view.rerender(<TaskDetailDialog {...input} task={{ ...failed, isolation: null }} />);
      expect(page().queryByRole("button", { name: detail.resume })).toBeNull();
      fireEvent.click(page().getByRole("button", { name: enCommon.actions.retry }));
      expect(input.onRetry).toHaveBeenLastCalledWith("fresh");
    });

    it("ignores a rejected retry", async () => {
      const failed: ResearchTask = { ...task("rejected"), status: "failed", isolation: workspace, result: null };
      const input = {
        ...props(failed),
        onRetry: vi.fn(async () => {
          throw new Error("The saved workspace is gone. Start over instead.");
        }),
      };
      render(<TaskDetailDialog {...input} />);
      fireEvent.click(page().getByRole("button", { name: detail.resume }));
      fireEvent.click(page().getByRole("button", { name: detail.startOver }));
      await waitFor(() => expect(input.onRetry).toHaveBeenCalledTimes(2));
      expect(page().getByRole("button", { name: detail.resume })).toBeEnabled();
    });

    it("the Progress tab loads the task's progress", async () => {
      previewMocks.progress.mockResolvedValue(progressFixture());
      const running: ResearchTask = { ...task("progress"), status: "running", result: null };
      render(<TaskDetailDialog {...props(running)} />);
      expect(previewMocks.progress).not.toHaveBeenCalled();

      openTab(detail.tabProgress);

      const board = await page().findByTestId("research-task-progress");
      expect(within(board).getByText("Measure the baseline")).toBeInTheDocument();
      expect(previewMocks.progress).toHaveBeenCalledWith("progress");
    });

    it("stops polling progress when the dialog closes", async () => {
      const polls: Array<() => void> = [];
      const cleared: number[] = [];
      const realSet = window.setInterval.bind(window);
      const realClear = window.clearInterval.bind(window);
      const setSpy = vi.spyOn(window, "setInterval").mockImplementation(((
        handler: TimerHandler,
        timeout?: number,
        ...rest: unknown[]
      ) => {
        if (timeout === 3_000 && typeof handler === "function") {
          polls.push(handler as () => void);
          return 4_242;
        }
        return realSet(handler, timeout, ...rest);
      }) as typeof window.setInterval);
      const clearSpy = vi.spyOn(window, "clearInterval").mockImplementation(((handle?: number) => {
        if (handle === 4_242) cleared.push(handle);
        else realClear(handle);
      }) as typeof window.clearInterval);
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      try {
        previewMocks.progress.mockResolvedValue(progressFixture());
        const running: ResearchTask = { ...task("polled"), status: "running", result: null };
        const view = render(<TaskDetailDialog {...props(running)} initialTab="progress" />);
        await page().findByTestId("research-task-progress");
        expect(polls).toHaveLength(1);
        await act(async () => polls[0]());
        expect(previewMocks.progress).toHaveBeenCalledTimes(2);

        view.rerender(<TaskDetailDialog {...props(running)} initialTab="progress" open={false} />);

        await waitFor(() => expect(cleared).toEqual([4_242]));
        expect(page().queryByTestId("research-task-progress")).toBeNull();
        expect(polls).toHaveLength(1);
        expect(previewMocks.progress).toHaveBeenCalledTimes(2);
      } finally {
        setSpy.mockRestore();
        clearSpy.mockRestore();
        Reflect.deleteProperty(document, "visibilityState");
      }
    });

    it("shows the plan with Approve and Approve edited plan on a plan-ready task", async () => {
      const ready: ResearchTask = { ...task("plan"), status: "plan_ready", result: null };
      const input = { ...props(ready), onApprovePlan: vi.fn(async (_edited?: string) => {}) };
      render(<TaskDetailDialog {...input} />);
      expect(page().getByRole("tab", { name: detail.tabReview })).toHaveAttribute("aria-selected", "true");

      const editor = await page().findByRole("textbox", { name: plan.title });
      expect(editor).toHaveValue("- [ ] Measure the baseline");
      expect(previewMocks.plan).toHaveBeenCalledWith("plan");
      fireEvent.click(page().getByRole("button", { name: plan.approve }));
      expect(input.onApprovePlan).toHaveBeenLastCalledWith(undefined);

      fireEvent.change(editor, { target: { value: "- [ ] edited" } });
      fireEvent.click(page().getByRole("button", { name: plan.approveEdited }));
      expect(input.onApprovePlan).toHaveBeenLastCalledWith("- [ ] edited");

      fireEvent.click(page().getByRole("button", { name: plan.discard }));
      expect(input.onCancel).toHaveBeenCalledOnce();
      // A plan waiting for approval has not finished, so it can still be kept running.
      expect(page().getByRole("checkbox", { name: enResearchTools.brief.keepRunning })).toBeEnabled();
    });

    it("keeps the usual review when the plan cannot be approved from here", () => {
      const ready: ResearchTask = { ...task("plan-readonly"), status: "plan_ready", result: null };
      render(<TaskDetailDialog {...props(ready)} />);

      expect(page().queryByTestId("research-task-plan")).toBeNull();
      expect(page().getByText(detail.nothingToReview)).toBeInTheDocument();
      expect(previewMocks.plan).not.toHaveBeenCalled();
    });

    it("shows evidence checks on the Review tab and checks again on request", async () => {
      const evidence: EvidenceReport = {
        checkedAt: 1,
        checks: [
          { id: "build", status: "pass", items: [] },
          {
            id: "numbers",
            status: "warn",
            items: [{ code: "numbers.unknownRun", file: "results.tex", line: 4, params: { run: "r009" } }],
          },
        ],
      };
      const onRefreshEvidence = vi.fn(async () => {});
      render(<TaskDetailDialog {...props({ ...task("evidence"), evidence })} onRefreshEvidence={onRefreshEvidence} />);

      const checklist = await page().findByTestId("research-evidence");
      expect(checklist).toHaveTextContent(enResearchTools.evidence.checks.build);
      expect(checklist).toHaveTextContent("Run r009 doesn't exist.");
      expect(checklist).toHaveTextContent("results.tex:4");
      expect(page().getByRole("button", { name: "Apply 1 selected" })).toBeInTheDocument();
      fireEvent.click(within(checklist).getByRole("button", { name: enResearchTools.evidence.refresh }));
      await waitFor(() => expect(onRefreshEvidence).toHaveBeenCalledOnce());
    });

    it("shows the evidence checks while they run and leaves them out when there is nothing to show", async () => {
      const onRefreshEvidence = vi.fn(async () => {});
      const checking: ResearchTask = { ...task("checking"), status: "completed", phase: "checking_evidence" };
      const view = render(<TaskDetailDialog {...props(checking)} initialTab="review" onRefreshEvidence={onRefreshEvidence} />);
      const checklist = await page().findByTestId("research-evidence");
      expect(within(checklist).getByRole("button", { name: enResearchTools.evidence.running })).toBeDisabled();

      view.rerender(
        <TaskDetailDialog {...props({ ...checking, phase: null })} initialTab="review" onRefreshEvidence={onRefreshEvidence} />,
      );
      expect(page().queryByTestId("research-evidence")).toBeNull();

      view.rerender(<TaskDetailDialog {...props(task("no-handler"))} initialTab="review" />);
      expect(page().queryByTestId("research-evidence")).toBeNull();
    });

    it("shows the task's own pending approvals in a banner", async () => {
      previewMocks.approvals.mockResolvedValue([approvalRecord("a1", "banner"), approvalRecord("a2", "elsewhere")]);
      const waiting: ResearchTask = { ...task("banner"), status: "running", pendingApprovals: 1, result: null };
      const view = render(<TaskDetailDialog {...props(waiting)} />);

      const banner = await page().findByTestId("research-pending-approvals");
      expect(previewMocks.approvals).toHaveBeenCalledWith("paper");
      const rows = within(banner).getAllByRole("listitem");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("Install the packages for banner");

      view.rerender(<TaskDetailDialog {...props({ ...waiting, pendingApprovals: 0 })} />);
      expect(page().queryByTestId("research-pending-approvals")).toBeNull();
    });
  });
});
