import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, TaskFilePreview, TaskTranscriptEvent } from "@/lib/research-tasks";

const fileMocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("@/lib/research-tasks", () => ({
  acceptResearchTaskResult: vi.fn(), applyResearchTask: vi.fn(), cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(), editResearchTask: vi.fn(), listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(), listenForResearchTaskEvents: vi.fn(),
  loadResearchTaskEvents: vi.fn(), retryResearchTask: vi.fn(), startResearchTask: vi.fn(),
  previewResearchTaskFile: vi.fn(), previewResearchTaskArtifact: vi.fn(),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ runExternalProjectMutation: fileMocks.transaction }) },
}));

vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: ({ oldText, newText }: { oldText: string; newText: string }) => <div>{`${oldText} -> ${newText}`}</div>,
}));

import * as api from "@/lib/research-tasks";
import { useResearchTasksStore } from "@/store/research-tasks";

let ResearchTasksPanel: typeof import("./ResearchTasksPanel").ResearchTasksPanel;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;
let userEvent: typeof import("@testing-library/user-event").default;
let changedTask: ((task: ResearchTask) => void) | undefined;
let changedEvent: ((event: TaskTranscriptEvent) => void) | undefined;
const unlistenTasks = vi.fn();
const unlistenEvents = vi.fn();

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://oleafly.test" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver"] as const) {
    vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
  }
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
  });
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ ResearchTasksPanel } = await import("./ResearchTasksPanel"));
});

function page() {
  return within(document.body);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

function task(id: string, projectId = "paper", status: ResearchTask["status"] = "awaiting_review"): ResearchTask {
  return {
    id, projectId, title: `Task ${id}`, prompt: `Complete ${id}`, runtimeId: "builtin",
    agentId: "provider", modelId: "model", skillIds: [], dependencyIds: [], status,
    executionGeneration: 1, sessionId: `session-${id}`, nativeSessionId: null,
    sourceRevision: "snapshot:base", isolation: null, error: null,
    result: {
      summary: `Result ${id}`,
      changedFiles: ["main.tex", "references.bib"].map((path) => ({ path, kind: "modified", beforeSha256: "before", afterSha256: "after", beforeSize: 5, afterSize: 6 })),
      artifacts: [], nativeSessionId: null, inputTokens: null, outputTokens: null,
    },
    review: null, startRequested: false, cancelRequested: false,
    createdAt: 1, updatedAt: 1, startedAt: 1, finishedAt: 1,
  };
}

function preview(path: string): TaskFilePreview {
  const content = (text: string) => ({ exists: true, text, base64: null, mediaType: "text/plain", binary: false, truncated: false, size: text.length, sha256: text });
  return { path, change: "modified", before: content("before"), after: content(path) };
}

const agents = [{ runtimeId: "builtin", agentId: "provider", modelId: "model", label: "Research model" }];

beforeEach(async () => {
  vi.resetAllMocks();
  changedTask = undefined;
  changedEvent = undefined;
  await useResearchTasksStore.getState().bindProject(null);
  vi.mocked(api.listResearchTasks).mockResolvedValue([]);
  vi.mocked(api.loadResearchTaskEvents).mockResolvedValue({ events: [], nextSequence: null });
  vi.mocked(api.listenForResearchTaskChanges).mockImplementation(async (listener) => { changedTask = listener; return unlistenTasks; });
  vi.mocked(api.listenForResearchTaskEvents).mockImplementation(async (listener) => { changedEvent = listener; return unlistenEvents; });
  vi.mocked(api.previewResearchTaskFile).mockImplementation(async (_id, path) => preview(path));
  fileMocks.transaction.mockImplementation(async (_projectId: string, action: (generation: number) => Promise<unknown>) => action(17));
});

afterEach(() => cleanup());

describe("ResearchTasksPanel lifecycle", () => {
  it("requires a project and disables task creation without a configured agent", async () => {
    const view = render(<ResearchTasksPanel projectId={null} agents={[]} />);
    expect(page().getByRole("heading", { name: "Open a project to use research tasks" })).toBeInTheDocument();
    expect(api.listResearchTasks).not.toHaveBeenCalled();
    view.rerender(<ResearchTasksPanel projectId="paper" agents={[]} />);
    await page().findByRole("heading", { name: "No research tasks yet" });
    expect(page().getByRole("button", { name: "New task" })).toBeDisabled();
    expect(page().getByRole("button", { name: "Create a task" })).toBeDisabled();
  });

  it("loads tasks, selects the newest task and switches to another task's activity", async () => {
    const pending = deferred<ResearchTask[]>();
    const older = task("older");
    const newer = { ...task("newer"), createdAt: 2 };
    vi.mocked(api.listResearchTasks).mockReturnValue(pending.promise);
    vi.mocked(api.loadResearchTaskEvents).mockImplementation(async (id) => ({ events: [{ taskId: id, executionGeneration: 1, sequence: 1, event: { kind: "text", text: `${id} activity` }, createdAt: 1 }], nextSequence: null }));
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    expect(page().getByRole("status")).toHaveTextContent("Loading research tasks");
    await act(async () => pending.resolve([older, newer]));
    await page().findByRole("heading", { name: "Task newer" });
    await page().findByText("newer activity");
    fireEvent.click(page().getByRole("button", { name: /Task older/ }));
    await page().findByText("older activity");
    expect(page().queryByText("newer activity")).not.toBeInTheDocument();
    expect(api.loadResearchTaskEvents).toHaveBeenLastCalledWith(older.id, 1);
  });

  it("passes only previewed selections through the project mutation boundary and reports completion", async () => {
    const current = task("review");
    const completed = { ...current, status: "completed" as const };
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.applyResearchTask).mockResolvedValue({ task: completed, projectState: {} as never });
    const onApplied = vi.fn();
    render(<ResearchTasksPanel projectId="paper" agents={agents} onApplied={onApplied} />);
    await page().findByRole("heading", { name: current.title });
    fireEvent.click(page().getByRole("checkbox", { name: "Apply references.bib" }));
    fireEvent.click(page().getAllByRole("button", { name: "Preview" })[0]);
    await page().findByText("before -> main.tex");
    fireEvent.click(page().getByRole("button", { name: "Apply 1 selected" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(completed));
    expect(api.applyResearchTask).toHaveBeenCalledWith(current.id, 17, ["main.tex"]);
    expect(fileMocks.transaction).toHaveBeenCalledWith("paper", expect.any(Function));
    expect(page().queryByRole("button", { name: /Apply \d selected/ })).not.toBeInTheDocument();
    expect(page().getByRole("heading", { name: current.title })).toBeInTheDocument();
  });

  it("recovers from an apply conflict by discarding and retrying the task", async () => {
    const current = task("conflict");
    const cancelled = { ...current, status: "cancelled" as const };
    const queued = { ...cancelled, status: "queued" as const };
    const running = { ...queued, status: "running" as const, executionGeneration: 2, result: null };
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.applyResearchTask).mockRejectedValue(new Error("The project changed since this task started"));
    vi.mocked(api.cancelResearchTask).mockResolvedValue(cancelled);
    vi.mocked(api.retryResearchTask).mockResolvedValue(queued);
    vi.mocked(api.startResearchTask).mockResolvedValue(running);
    const onApplied = vi.fn();
    render(<ResearchTasksPanel projectId="paper" agents={agents} onApplied={onApplied} />);
    await page().findByRole("heading", { name: current.title });
    fireEvent.click(page().getByRole("checkbox", { name: "Apply references.bib" }));
    fireEvent.click(page().getAllByRole("button", { name: "Preview" })[0]);
    await page().findByText("before -> main.tex");
    fireEvent.click(page().getByRole("button", { name: "Apply 1 selected" }));
    expect(await page().findByRole("alert")).toHaveTextContent("The project changed since this task started");
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(page().getByRole("button", { name: "Dismiss" }));
    fireEvent.click(page().getByRole("button", { name: "Discard changes" }));
    fireEvent.click(await page().findByRole("button", { name: "Retry" }));
    fireEvent.click(await page().findByRole("button", { name: "Start" }));
    await page().findByRole("button", { name: "Stop task" });
    expect(page().queryByText(`Result ${current.id}`)).not.toBeInTheDocument();
    expect(page().queryByText("before -> main.tex")).not.toBeInTheDocument();
    expect(api.cancelResearchTask).toHaveBeenCalledWith(current.id);
    expect(api.retryResearchTask).toHaveBeenCalledWith(current.id);
    expect(api.startResearchTask).toHaveBeenCalledWith(current.id);
  });

  it("queues a blocked task and reflects native task and transcript updates", async () => {
    const current = { ...task("dependent", "paper", "queued"), dependencyIds: ["dependency"], result: null, executionGeneration: 0 };
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.startResearchTask).mockResolvedValue({ ...current, startRequested: true });
    const view = render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: current.title });
    expect(page().getByText("Waiting on a task")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Start when ready" }));
    expect(await page().findByRole("button", { name: "Waiting" })).toBeDisabled();
    const running = { ...current, status: "running" as const, executionGeneration: 1 };
    act(() => changedTask?.(running));
    await page().findByRole("button", { name: "Stop task" });
    act(() => changedEvent?.({ taskId: current.id, executionGeneration: 1, sequence: 1, createdAt: 1, event: { kind: "text", text: "Native task progress" } }));
    expect(page().getByText("Native task progress")).toBeInTheDocument();
    act(() => changedTask?.({ ...running, cancelRequested: true }));
    expect(page().getByRole("button", { name: "Stopping..." })).toBeDisabled();
    view.unmount();
    expect(unlistenTasks).toHaveBeenCalledOnce();
    expect(unlistenEvents).toHaveBeenCalledOnce();
  });

  it("keeps a load error visible until refresh succeeds", async () => {
    vi.mocked(api.listResearchTasks).mockRejectedValueOnce(new Error("Task storage could not be read"));
    vi.mocked(api.listResearchTasks).mockResolvedValueOnce([task("recovered")]);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    expect(await page().findByRole("alert")).toHaveTextContent("Task storage could not be read");
    fireEvent.click(page().getByRole("button", { name: "Refresh research tasks" }));
    await page().findByRole("heading", { name: "Task recovered" });
    expect(page().queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps the current project selected when an old submission finishes (return to original: %s)", async (returnToOriginal) => {
    const pending = deferred<ResearchTask>();
    const first = task("first", "first");
    const second = task("second", "second");
    vi.mocked(api.listResearchTasks).mockImplementation(async (id) => id === "first" ? [first] : [second]);
    vi.mocked(api.createResearchTask).mockReturnValue(pending.promise);
    const view = render(<ResearchTasksPanel projectId="first" agents={agents} />);
    await page().findByRole("heading", { name: first.title });
    fireEvent.click(page().getByRole("button", { name: "New task" }));
    fireEvent.change(page().getByLabelText("Start from"), { target: { value: "analysis" } });
    fireEvent.click(page().getByRole("button", { name: "Create task" }));
    expect(api.createResearchTask).toHaveBeenCalledOnce();
    view.rerender(<ResearchTasksPanel projectId="second" agents={agents} />);
    await page().findByRole("heading", { name: second.title });
    if (returnToOriginal) {
      view.rerender(<ResearchTasksPanel projectId="first" agents={agents} />);
      await page().findByRole("heading", { name: "New research task" });
      await waitFor(() => expect(useResearchTasksStore.getState().selectedTaskId).toBe(first.id));
    }
    await act(async () => pending.resolve(task("created-in-first", "first")));
    const selected = returnToOriginal ? first : second;
    expect(page().getByRole("heading", { name: returnToOriginal ? "New research task" : selected.title })).toBeInTheDocument();
    expect(useResearchTasksStore.getState().selectedTaskId).toBe(selected.id);
  });

  it("keeps a new project's composer open when an earlier edit finishes", async () => {
    const first = { ...task("first", "first", "queued"), executionGeneration: 0, result: null };
    const second = task("second", "second");
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockImplementation(async (id) => id === "first" ? [first] : [second]);
    vi.mocked(api.editResearchTask).mockReturnValue(pending.promise);
    const view = render(<ResearchTasksPanel projectId="first" agents={agents} />);
    await page().findByRole("heading", { name: first.title });
    fireEvent.click(page().getByRole("button", { name: "Edit" }));
    fireEvent.click(page().getByRole("button", { name: "Save task" }));
    expect(api.editResearchTask).toHaveBeenCalledOnce();
    view.rerender(<ResearchTasksPanel projectId="second" agents={agents} />);
    await page().findByRole("heading", { name: second.title });
    fireEvent.click(page().getByRole("button", { name: "New task" }));
    await act(async () => pending.resolve({ ...first, title: "Updated first task" }));

    expect(page().getByRole("heading", { name: "New research task" })).toBeInTheDocument();
    expect(page().getByLabelText("Title")).toHaveValue("");
    expect(useResearchTasksStore.getState().tasks).toEqual([second]);
  });

  it("creates and edits a queued task through the native boundary", async () => {
    const created = { ...task("created", "paper", "queued"), executionGeneration: 0, result: null };
    const edited = { ...created, title: "Updated analysis task" };
    vi.mocked(api.createResearchTask).mockResolvedValue(created);
    vi.mocked(api.editResearchTask).mockResolvedValue(edited);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: "No research tasks yet" });
    fireEvent.click(page().getByRole("button", { name: "Create a task" }));
    fireEvent.change(page().getByLabelText("Start from"), { target: { value: "analysis" } });
    fireEvent.click(page().getByRole("button", { name: "Create task" }));
    await page().findByRole("heading", { name: created.title });
    expect(api.createResearchTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: "paper", runtimeId: "builtin", agentId: "provider", modelId: "model", skillIds: expect.arrayContaining(["statistical-analysis"]) }));
    fireEvent.click(page().getByRole("button", { name: "Edit" }));
    expect(page().getByLabelText("Title")).toHaveValue(created.title);
    const user = userEvent.setup({ document });
    await user.clear(page().getByLabelText("Title"));
    await user.type(page().getByLabelText("Title"), edited.title);
    fireEvent.click(page().getByRole("button", { name: "Save task" }));
    await page().findByRole("heading", { name: edited.title });
    expect(api.editResearchTask).toHaveBeenCalledWith(created.id, expect.objectContaining({ title: edited.title }));
  });

  it.each([
    ["create", true],
    ["create", false],
    ["edit", true],
    ["edit", false],
  ] as const)("preserves a reopened draft when an earlier %s finishes in the same project (cancel first: %s)", async (operation, cancelFirst) => {
    const existing = { ...task("existing", "paper", "queued"), executionGeneration: 0, result: null };
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockResolvedValue([existing]);
    vi.mocked(api.createResearchTask).mockReturnValue(pending.promise);
    vi.mocked(api.editResearchTask).mockReturnValue(pending.promise);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: existing.title });
    const user = userEvent.setup({ document });
    if (operation === "create") {
      await user.click(page().getByRole("button", { name: "New task" }));
      await user.selectOptions(page().getByLabelText("Start from"), "analysis");
      await user.click(page().getByRole("button", { name: "Create task" }));
    } else {
      await user.click(page().getByRole("button", { name: "Edit" }));
      await user.click(page().getByRole("button", { name: "Save task" }));
    }
    expect(page().getByRole("button", { name: "Saving..." })).toBeDisabled();
    if (cancelFirst) await user.click(page().getByRole("button", { name: "Cancel" }));
    await user.click(page().getByRole("button", { name: "New task" }));
    await user.type(page().getByLabelText("Title"), "A separate draft");
    await user.type(page().getByLabelText("Instructions"), "Keep this new work");

    await act(async () => pending.resolve(operation === "create"
      ? { ...existing, id: "created", title: "Created task" }
      : { ...existing, title: "Saved task" }));

    expect(page().getByRole("heading", { name: "New research task" })).toBeInTheDocument();
    expect(page().getByLabelText("Title")).toHaveValue("A separate draft");
    expect(page().getByLabelText("Instructions")).toHaveValue("Keep this new work");
    expect(useResearchTasksStore.getState().selectedTaskId).toBe(existing.id);
  });

  it("preserves another task's edit when a cancelled edit finishes", async () => {
    const first = { ...task("first", "paper", "queued"), executionGeneration: 0, result: null };
    const second = { ...task("second", "paper", "queued"), executionGeneration: 0, result: null };
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockResolvedValue([first, second]);
    vi.mocked(api.editResearchTask).mockReturnValue(pending.promise);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: first.title });
    const user = userEvent.setup({ document });
    await user.click(page().getByRole("button", { name: "Edit" }));
    await user.click(page().getByRole("button", { name: "Save task" }));
    await user.click(page().getByRole("button", { name: "Cancel" }));
    await user.click(page().getByRole("button", { name: /Task second/ }));
    await user.click(page().getByRole("button", { name: "Edit" }));
    await user.clear(page().getByLabelText("Title"));
    await user.type(page().getByLabelText("Title"), "Second task draft");

    await act(async () => pending.resolve({ ...first, title: "First task saved" }));

    expect(page().getByRole("heading", { name: "Edit queued task" })).toBeInTheDocument();
    expect(page().getByLabelText("Title")).toHaveValue("Second task draft");
    expect(page().getByLabelText("Instructions")).toHaveValue(second.prompt);
  });

  it("keeps the newer submission locked when an older submission settles", async () => {
    const first = deferred<ResearchTask>();
    const second = deferred<ResearchTask>();
    vi.mocked(api.createResearchTask).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: "No research tasks yet" });
    const user = userEvent.setup({ document });
    await user.click(page().getByRole("button", { name: "New task" }));
    await user.selectOptions(page().getByLabelText("Start from"), "analysis");
    await user.click(page().getByRole("button", { name: "Create task" }));
    await user.click(page().getByRole("button", { name: "Cancel" }));
    await user.click(page().getByRole("button", { name: "New task" }));
    await user.selectOptions(page().getByLabelText("Start from"), "literature-review");
    await user.click(page().getByRole("button", { name: "Create task" }));
    expect(api.createResearchTask).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve(task("first", "paper", "queued")));

    expect(page().getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(page().getByLabelText("Title")).toBeDisabled();
    expect(page().getByLabelText("Title")).toHaveValue("Review the literature");
    await act(async () => second.resolve(task("second", "paper", "queued")));
    expect(page().getByRole("heading", { name: "Task second" })).toBeInTheDocument();
    expect(page().queryByRole("heading", { name: "New research task" })).not.toBeInTheDocument();
  });

  it("locks the submitted form and preserves its values when saving fails", async () => {
    const dependency = { ...task("dependency", "paper", "queued"), result: null };
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockResolvedValue([dependency]);
    vi.mocked(api.createResearchTask).mockReturnValueOnce(pending.promise);
    vi.mocked(api.createResearchTask).mockResolvedValueOnce({ ...dependency, id: "created", title: "Revised analysis" });
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: dependency.title });
    const user = userEvent.setup({ document });
    await user.click(page().getByRole("button", { name: "New task" }));
    await user.selectOptions(page().getByLabelText("Start from"), "analysis");
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    const instructions = (page().getByLabelText("Instructions") as HTMLTextAreaElement).value;
    await user.click(page().getByRole("button", { name: "Create task" }));

    for (const label of ["Start from", "Title", "Instructions", "Agent and model"]) {
      expect(page().getByLabelText(label)).toBeDisabled();
    }
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeDisabled();
    expect(page().getByRole("button", { name: "Cancel" })).toBeEnabled();
    await user.type(page().getByLabelText("Title"), " changes during save");
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    await act(async () => pending.reject(new Error("Task could not be saved")));

    expect(await page().findByRole("alert")).toHaveTextContent("Task could not be saved");
    expect(page().getByLabelText("Title")).toHaveValue("Run the analysis");
    expect(page().getByLabelText("Instructions")).toHaveValue(instructions);
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeChecked();
    expect(page().getByRole("button", { name: "Create task" })).toBeEnabled();
    await user.clear(page().getByLabelText("Title"));
    await user.type(page().getByLabelText("Title"), "Revised analysis");
    await user.click(page().getByRole("button", { name: "Create task" }));
    await page().findByRole("heading", { name: "Revised analysis" });
    expect(api.createResearchTask).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Revised analysis", prompt: instructions, dependencyIds: [dependency.id], skillIds: ["statistical-analysis"] }));
  });

  it("marks an unchanged result reviewed without applying files", async () => {
    const current = task("unchanged");
    if (!current.result) throw new Error("Missing review fixture");
    current.result.changedFiles = [];
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.acceptResearchTaskResult).mockResolvedValue({ ...current, status: "completed" });
    const onApplied = vi.fn();
    render(<ResearchTasksPanel projectId="paper" agents={agents} onApplied={onApplied} />);
    fireEvent.click(await page().findByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(page().queryByRole("button", { name: "Mark reviewed" })).not.toBeInTheDocument());
    expect(api.acceptResearchTaskResult).toHaveBeenCalledWith(current.id);
    expect(api.applyResearchTask).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("does not notify an unmounted panel when its pending apply completes", async () => {
    const current = task("pending-apply");
    const pending = deferred<Awaited<ReturnType<typeof api.applyResearchTask>>>();
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.applyResearchTask).mockReturnValue(pending.promise);
    const onApplied = vi.fn();
    const view = render(<ResearchTasksPanel projectId="paper" agents={agents} onApplied={onApplied} />);
    await page().findByRole("heading", { name: current.title });
    fireEvent.click(page().getByRole("checkbox", { name: "Apply references.bib" }));
    fireEvent.click(page().getAllByRole("button", { name: "Preview" })[0]);
    await page().findByText("before -> main.tex");
    fireEvent.click(page().getByRole("button", { name: "Apply 1 selected" }));
    await waitFor(() => expect(api.applyResearchTask).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => pending.resolve({ task: { ...current, status: "completed" }, projectState: {} as never }));
    expect(onApplied).not.toHaveBeenCalled();
  });
});
