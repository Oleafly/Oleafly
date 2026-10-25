import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalRecord,
  EvidenceReport,
  ResearchTask,
  TaskFilePreview,
  TaskIsolationSummary,
  TaskTranscriptEvent,
} from "@/lib/research-tasks";
import { formatDateTime } from "@/lib/intl";
import { taskFieldsSince047 } from "./tests/task-fixtures";

const fileMocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("@/lib/research-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-tasks")>()),
  acceptResearchTaskResult: vi.fn(), applyResearchTask: vi.fn(), cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(), deleteResearchTask: vi.fn(), editResearchTask: vi.fn(), listResearchTasks: vi.fn(),
  listenForResearchTaskChanges: vi.fn(), listenForResearchTaskEvents: vi.fn(),
  loadResearchTaskEvents: vi.fn(), loadResearchTaskEventsBefore: vi.fn(), retryResearchTask: vi.fn(), startResearchTask: vi.fn(),
  previewResearchTaskFile: vi.fn(), previewResearchTaskArtifact: vi.fn(),
  // 0.4.8: live text, watching, plans, approvals, progress, evidence and keep running.
  listenForResearchTaskDeltas: vi.fn(async () => () => {}),
  watchResearchTask: vi.fn(async () => {}),
  approveResearchTaskPlan: vi.fn(),
  loadResearchTaskPlan: vi.fn(async () => ""),
  listResearchTaskApprovals: vi.fn(async () => []),
  decideResearchTaskApproval: vi.fn(),
  progressResearchTask: vi.fn(),
  cancelResearchTaskRun: vi.fn(),
  researchTaskRunLog: vi.fn(),
  refreshResearchTaskEvidence: vi.fn(),
  setResearchTaskKeepRunning: vi.fn(),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ runExternalProjectMutation: fileMocks.transaction }) },
}));

vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: ({ oldText, newText }: { oldText: string; newText: string }) => <div>{`${oldText} -> ${newText}`}</div>,
}));

vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));

import * as api from "@/lib/research-tasks";
import { useResearchTasksStore } from "@/store/research-tasks";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

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
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLSelectElement", "Element", "DocumentFragment", "Node", "NodeFilter", "Event", "CustomEvent", "MutationObserver"] as const) {
    vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
  }
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => dom.window.clearTimeout(handle));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ ResearchTasksPanel } = await import("./ResearchTasksPanel"));
});

function page() {
  return within(document.body);
}

function selectTab(name: RegExp) {
  fireEvent.mouseDown(page().getByRole("tab", { name }), { button: 0 });
}

function card(title: string) {
  return page().getByRole("button", { name: new RegExp(title) });
}

function openTask(title: string) {
  fireEvent.click(card(title));
}

function closeDetail() {
  fireEvent.click(within(page().getByRole("dialog")).getByRole("button", { name: enCommon.actions.close }));
}

function openActivity() {
  fireEvent.mouseDown(page().getByRole("tab", { name: enResearchTools.tasks.detail.tabActivity }), { button: 0 });
}

function choose(label: string, option: string) {
  fireEvent.keyDown(page().getByLabelText(label), { key: "ArrowDown" });
  fireEvent.click(page().getByRole("option", { name: option }));
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
    ...taskFieldsSince047(),
  };
}

function preview(path: string): TaskFilePreview {
  const content = (text: string) => ({ exists: true, text, base64: null, mediaType: "text/plain", binary: false, truncated: false, size: text.length, sha256: text });
  return {
    path, change: "modified", before: content("before"), after: content(path),
    projectSha256: "before", baseIsCurrent: true, mergesWithShared: false,
  };
}

const agents = [{ runtimeId: "builtin", agentId: "provider", modelId: "model", label: "Research model" }];

beforeEach(async () => {
  vi.resetAllMocks();
  changedTask = undefined;
  changedEvent = undefined;
  await useResearchTasksStore.getState().bindProject(null);
  vi.mocked(api.listResearchTasks).mockResolvedValue([]);
  vi.mocked(api.loadResearchTaskEventsBefore).mockResolvedValue({ events: [], nextSequence: null });
  vi.mocked(api.listenForResearchTaskChanges).mockImplementation(async (listener) => { changedTask = listener; return unlistenTasks; });
  vi.mocked(api.listenForResearchTaskEvents).mockImplementation(async (listener) => { changedEvent = listener; return unlistenEvents; });
  vi.mocked(api.previewResearchTaskFile).mockImplementation(async (_id, path) => preview(path));
  fileMocks.transaction.mockImplementation(async (_projectId: string, action: (generation: number) => Promise<unknown>) => action(17));
});

afterEach(() => cleanup());

describe("ResearchTasksPanel lifecycle", () => {
  it("requires a project and disables task creation without a configured agent", async () => {
    const view = render(<ResearchTasksPanel projectId={null} agents={[]} />);
    expect(page().getByRole("heading", { name: enResearchTools.tasks.panel.noProjectTitle })).toBeInTheDocument();
    expect(api.listResearchTasks).not.toHaveBeenCalled();
    view.rerender(<ResearchTasksPanel projectId="paper" agents={[]} />);
    await page().findByRole("heading", { name: enResearchTools.tasks.panel.emptyTitle });
    expect(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask })).toBeDisabled();
    expect(page().getByRole("button", { name: enResearchTools.tasks.panel.createTask })).toBeDisabled();
  });

  it("loads tasks, selects the newest task and switches to another task's activity", async () => {
    const pending = deferred<ResearchTask[]>();
    const older = task("older");
    const newer = { ...task("newer"), createdAt: 2 };
    vi.mocked(api.listResearchTasks).mockReturnValue(pending.promise);
    vi.mocked(api.loadResearchTaskEventsBefore).mockImplementation(async (id) => ({ events: [{ taskId: id, executionGeneration: 1, sequence: 1, event: { kind: "text", text: `${id} activity` }, createdAt: 1 }], nextSequence: null }));
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    expect(page().getByRole("status")).toHaveTextContent("Loading research tasks");
    await act(async () => pending.resolve([older, newer]));
    await page().findByRole("button", { name: /Task newer/ });
    openTask("Task newer");
    openActivity();
    await page().findByText("newer activity");
    closeDetail();
    openTask("Task older");
    openActivity();
    await page().findByText("older activity");
    expect(page().queryByText("newer activity")).not.toBeInTheDocument();
    expect(api.loadResearchTaskEventsBefore).toHaveBeenLastCalledWith(older.id, 1, api.NEWEST_EVENTS);
  });

  it("passes only previewed selections through the project mutation boundary and reports completion", async () => {
    const current = task("review");
    const completed = { ...current, status: "completed" as const };
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.applyResearchTask).mockResolvedValue({ task: completed, projectState: {} as never });
    const onApplied = vi.fn();
    render(<ResearchTasksPanel projectId="paper" agents={agents} onApplied={onApplied} />);
    await page().findByRole("button", { name: new RegExp(current.title) });
    openTask(current.title);
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
    await page().findByRole("button", { name: new RegExp(current.title) });
    openTask(current.title);
    fireEvent.click(page().getByRole("checkbox", { name: "Apply references.bib" }));
    fireEvent.click(page().getAllByRole("button", { name: "Preview" })[0]);
    await page().findByText("before -> main.tex");
    fireEvent.click(page().getByRole("button", { name: "Apply 1 selected" }));
    expect(await page().findByRole("alert")).toHaveTextContent("The project changed since this task started");
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(page().getByRole("button", { name: "Dismiss" }));
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.discardChanges }));
    fireEvent.click(
      within(page().getByRole("alertdialog")).getByRole("button", { name: enResearchTools.tasks.detail.discardChanges }),
    );
    fireEvent.click(await page().findByRole("button", { name: enCommon.actions.retry }));
    fireEvent.click(await page().findByRole("button", { name: enResearchTools.tasks.detail.start }));
    await page().findByRole("button", { name: enResearchTools.tasks.detail.stopTask });
    expect(page().queryByText(`Result ${current.id}`)).not.toBeInTheDocument();
    expect(page().queryByText("before -> main.tex")).not.toBeInTheDocument();
    expect(api.cancelResearchTask).toHaveBeenCalledWith(current.id);
    // A task without a saved workspace can only start over.
    expect(api.retryResearchTask).toHaveBeenCalledWith(current.id, "fresh");
    expect(api.startResearchTask).toHaveBeenCalledWith(current.id);
  });

  it("queues a blocked task and reflects native task and transcript updates", async () => {
    const current = { ...task("dependent", "paper", "queued"), dependencyIds: ["dependency"], result: null, executionGeneration: 0 };
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.startResearchTask).mockResolvedValue({ ...current, startRequested: true });
    const view = render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(current.title) });
    expect(page().getByText(enResearchTools.tasks.panel.waiting)).toBeInTheDocument();
    openTask(current.title);
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.startWhenReady }));
    expect(await page().findByRole("button", { name: enResearchTools.tasks.detail.waiting })).toBeDisabled();
    const running = { ...current, status: "running" as const, executionGeneration: 1 };
    act(() => changedTask?.(running));
    await page().findByRole("button", { name: enResearchTools.tasks.detail.stopTask });
    act(() => changedEvent?.({ taskId: current.id, executionGeneration: 1, sequence: 1, createdAt: 1, event: { kind: "text", text: "Native task progress" } }));
    expect(page().getByText("Native task progress")).toBeInTheDocument();
    act(() => changedTask?.({ ...running, cancelRequested: true }));
    expect(page().getByRole("button", { name: enResearchTools.tasks.detail.stopping })).toBeDisabled();
    view.unmount();
    // The shared listeners stop once the last view unmounts (asynchronously since 0.4.8).
    await waitFor(() => expect(unlistenTasks).toHaveBeenCalledOnce());
    expect(unlistenEvents).toHaveBeenCalledOnce();
  });

  it("keeps a load error visible until refresh succeeds", async () => {
    vi.mocked(api.listResearchTasks).mockRejectedValueOnce(new Error("Task storage could not be read"));
    vi.mocked(api.listResearchTasks).mockResolvedValueOnce([task("recovered")]);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    expect(await page().findByRole("alert")).toHaveTextContent("Task storage could not be read");
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.refreshAria }));
    await page().findByRole("button", { name: /Task recovered/ });
    expect(page().queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps the current project selected when an old submission finishes (return to original: %s)", async (returnToOriginal) => {
    const pending = deferred<ResearchTask>();
    const first = task("first", "first");
    const second = task("second", "second");
    vi.mocked(api.listResearchTasks).mockImplementation(async (id) => id === "first" ? [first] : [second]);
    vi.mocked(api.createResearchTask).mockReturnValue(pending.promise);
    const view = render(<ResearchTasksPanel projectId="first" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(first.title) });
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask }));
    choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    expect(api.createResearchTask).toHaveBeenCalledOnce();
    view.rerender(<ResearchTasksPanel projectId="second" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(second.title) });
    if (returnToOriginal) {
      view.rerender(<ResearchTasksPanel projectId="first" agents={agents} />);
      await page().findByRole("heading", { name: enResearchTools.tasks.composer.newTitle });
      await waitFor(() => expect(useResearchTasksStore.getState().selectedTaskId).toBe(first.id));
    }
    await act(async () => pending.resolve(task("created-in-first", "first")));
    const selected = returnToOriginal ? first : second;
    if (returnToOriginal) {
      expect(page().getByRole("heading", { name: enResearchTools.tasks.composer.newTitle })).toBeInTheDocument();
    } else {
      expect(card(selected.title)).toBeInTheDocument();
    }
    expect(useResearchTasksStore.getState().selectedTaskId).toBe(selected.id);
  });

  it("keeps a new project's composer open when an earlier edit finishes", async () => {
    const first = { ...task("first", "first", "queued"), executionGeneration: 0, result: null };
    const second = task("second", "second");
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockImplementation(async (id) => id === "first" ? [first] : [second]);
    vi.mocked(api.editResearchTask).mockReturnValue(pending.promise);
    const view = render(<ResearchTasksPanel projectId="first" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(first.title) });
    openTask(first.title);
    fireEvent.click(page().getByRole("button", { name: enCommon.actions.edit }));
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.saveTask }));
    expect(api.editResearchTask).toHaveBeenCalledOnce();
    view.rerender(<ResearchTasksPanel projectId="second" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(second.title) });
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask }));
    await act(async () => pending.resolve({ ...first, title: "Updated first task" }));

    expect(page().getByRole("heading", { name: enResearchTools.tasks.composer.newTitle })).toBeInTheDocument();
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("");
    expect(useResearchTasksStore.getState().tasks).toEqual([second]);
  });

  it("creates and edits a queued task through the native boundary", async () => {
    const created = { ...task("created", "paper", "queued"), executionGeneration: 0, result: null };
    const edited = { ...created, title: "Updated analysis task" };
    vi.mocked(api.createResearchTask).mockResolvedValue(created);
    vi.mocked(api.editResearchTask).mockResolvedValue(edited);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: enResearchTools.tasks.panel.emptyTitle });
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.createTask }));
    choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    await page().findByRole("heading", { name: created.title });
    expect(page().getByRole("dialog")).toHaveAttribute("data-testid", "research-task-detail");
    expect(api.createResearchTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: "paper", runtimeId: "builtin", agentId: "provider", modelId: "model", skillIds: expect.arrayContaining(["statistical-analysis"]) }));
    fireEvent.click(page().getByRole("button", { name: enCommon.actions.edit }));
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue(created.title);
    const user = userEvent.setup({ document });
    await user.clear(page().getByLabelText(enResearchTools.tasks.composer.titleLabel));
    await user.type(page().getByLabelText(enResearchTools.tasks.composer.titleLabel), edited.title);
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.saveTask }));
    await page().findByRole("heading", { name: edited.title });
    expect(api.editResearchTask).toHaveBeenCalledWith(created.id, expect.objectContaining({ title: edited.title }));
  });

  it.each(["create", "edit"] as const)("preserves a reopened draft when an earlier %s finishes in the same project", async (operation) => {
    const existing = { ...task("existing", "paper", "queued"), executionGeneration: 0, result: null };
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockResolvedValue([existing]);
    vi.mocked(api.createResearchTask).mockReturnValue(pending.promise);
    vi.mocked(api.editResearchTask).mockReturnValue(pending.promise);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(existing.title) });
    const user = userEvent.setup({ document });
    if (operation === "create") {
      await user.click(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask }));
      choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
      await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    } else {
      openTask(existing.title);
      await user.click(page().getByRole("button", { name: enCommon.actions.edit }));
      await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.saveTask }));
    }
    expect(page().getByRole("button", { name: enResearchTools.tasks.composer.saving })).toBeDisabled();
    await user.click(page().getByRole("button", { name: enCommon.actions.cancel }));
    if (operation === "edit") closeDetail();
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask }));
    await user.type(page().getByLabelText(enResearchTools.tasks.composer.titleLabel), "A separate draft");
    await user.type(page().getByLabelText(enResearchTools.tasks.composer.promptLabel), "Keep this new work");

    await act(async () => pending.resolve(operation === "create"
      ? { ...existing, id: "created", title: "Created task" }
      : { ...existing, title: "Saved task" }));

    expect(page().getByRole("heading", { name: enResearchTools.tasks.composer.newTitle })).toBeInTheDocument();
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("A separate draft");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("Keep this new work");
    expect(useResearchTasksStore.getState().selectedTaskId).toBe(existing.id);
  });

  it("preserves another task's edit when a cancelled edit finishes", async () => {
    const first = { ...task("first", "paper", "queued"), executionGeneration: 0, result: null };
    const second = { ...task("second", "paper", "queued"), executionGeneration: 0, result: null };
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockResolvedValue([first, second]);
    vi.mocked(api.editResearchTask).mockReturnValue(pending.promise);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(first.title) });
    const user = userEvent.setup({ document });
    openTask(first.title);
    await user.click(page().getByRole("button", { name: enCommon.actions.edit }));
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.saveTask }));
    await user.click(page().getByRole("button", { name: enCommon.actions.cancel }));
    closeDetail();
    openTask("Task second");
    await user.click(page().getByRole("button", { name: enCommon.actions.edit }));
    await user.clear(page().getByLabelText(enResearchTools.tasks.composer.titleLabel));
    await user.type(page().getByLabelText(enResearchTools.tasks.composer.titleLabel), "Second task draft");

    await act(async () => pending.resolve({ ...first, title: "First task saved" }));

    expect(page().getByRole("heading", { name: enResearchTools.tasks.composer.editTitle })).toBeInTheDocument();
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("Second task draft");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue(second.prompt);
  });

  it("keeps the newer submission locked when an older submission settles", async () => {
    const first = deferred<ResearchTask>();
    const second = deferred<ResearchTask>();
    vi.mocked(api.createResearchTask).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("heading", { name: enResearchTools.tasks.panel.emptyTitle });
    const user = userEvent.setup({ document });
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask }));
    choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    await user.click(page().getByRole("button", { name: enCommon.actions.cancel }));
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask }));
    choose(enResearchTools.tasks.composer.starterLabel, "Literature review");
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    expect(api.createResearchTask).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve(task("first", "paper", "queued")));

    expect(page().getByRole("button", { name: enResearchTools.tasks.composer.saving })).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue(enResearchTools.tasks.starter.literatureReview.title);
    await act(async () => second.resolve(task("second", "paper", "queued")));
    expect(page().getByRole("heading", { name: "Task second" })).toBeInTheDocument();
    expect(page().queryByRole("heading", { name: enResearchTools.tasks.composer.newTitle })).not.toBeInTheDocument();
  });

  it("locks the submitted form and preserves its values when saving fails", async () => {
    const dependency = { ...task("dependency", "paper", "queued"), result: null };
    const pending = deferred<ResearchTask>();
    vi.mocked(api.listResearchTasks).mockResolvedValue([dependency]);
    vi.mocked(api.createResearchTask).mockReturnValueOnce(pending.promise);
    vi.mocked(api.createResearchTask).mockResolvedValueOnce({ ...dependency, id: "created", title: "Revised analysis" });
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(dependency.title) });
    const user = userEvent.setup({ document });
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.panel.newTask }));
    choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    const instructions = (page().getByLabelText(enResearchTools.tasks.composer.promptLabel) as HTMLTextAreaElement).value;
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));

    for (const label of [enResearchTools.tasks.composer.starterLabel, enResearchTools.tasks.composer.titleLabel, enResearchTools.tasks.composer.promptLabel, enResearchTools.tasks.composer.agentLabel]) {
      expect(page().getByLabelText(label)).toBeDisabled();
    }
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeDisabled();
    expect(page().getByRole("button", { name: enCommon.actions.cancel })).toBeEnabled();
    await user.type(page().getByLabelText(enResearchTools.tasks.composer.titleLabel), " changes during save");
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    await act(async () => pending.reject(new Error("Task could not be saved")));

    expect(await page().findByRole("alert")).toHaveTextContent("Task could not be saved");
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue(enResearchTools.tasks.starter.analysis.title);
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue(instructions);
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeChecked();
    expect(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask })).toBeEnabled();
    await user.clear(page().getByLabelText(enResearchTools.tasks.composer.titleLabel));
    await user.type(page().getByLabelText(enResearchTools.tasks.composer.titleLabel), "Revised analysis");
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
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
    await page().findByRole("button", { name: new RegExp(current.title) });
    openTask(current.title);
    fireEvent.click(await page().findByRole("button", { name: enResearchTools.tasks.detail.markReviewed }));
    await waitFor(() => expect(page().queryByRole("button", { name: enResearchTools.tasks.detail.markReviewed })).not.toBeInTheDocument());
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
    await page().findByRole("button", { name: new RegExp(current.title) });
    openTask(current.title);
    fireEvent.click(page().getByRole("checkbox", { name: "Apply references.bib" }));
    fireEvent.click(page().getAllByRole("button", { name: "Preview" })[0]);
    await page().findByText("before -> main.tex");
    fireEvent.click(page().getByRole("button", { name: "Apply 1 selected" }));
    await waitFor(() => expect(api.applyResearchTask).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => pending.resolve({ task: { ...current, status: "completed" }, projectState: {} as never }));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("opens the task modal from View task and keeps the list reachable after closing it", async () => {
    const running = { ...task("running", "paper", "running"), result: null, createdAt: 2 };
    const review = task("review");
    vi.mocked(api.listResearchTasks).mockResolvedValue([running, review]);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: /Task running/ });

    expect(page().queryByRole("dialog")).not.toBeInTheDocument();
    expect(page().getByRole("button", { name: enResearchTools.tasks.panel.viewProgress })).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.viewTask }));

    const dialog = page().getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: review.title })).toBeInTheDocument();
    expect(dialog.querySelector('article[aria-labelledby="research-task-detail-title"]')).not.toBeNull();
    await waitFor(() => expect(useResearchTasksStore.getState().selectedTaskId).toBe(review.id));

    closeDetail();
    expect(page().queryByRole("dialog")).not.toBeInTheDocument();
    expect(useResearchTasksStore.getState().selectedTaskId).toBe(review.id);
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.viewTask }));
    expect(within(page().getByRole("dialog")).getByRole("heading", { name: review.title })).toBeInTheDocument();
  });

  it("filters the task list by run state without losing the other tasks", async () => {
    const running = { ...task("running", "paper", "running"), result: null };
    const review = task("review");
    const done = { ...task("done", "paper", "completed"), createdAt: 0 };
    vi.mocked(api.listResearchTasks).mockResolvedValue([running, review, done]);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: /Task running/ });
    expect(page().getAllByRole("listitem")).toHaveLength(3);

    const list = () => within(page().getByRole("navigation", { name: enResearchTools.tasks.panel.listLabel }));

    expect(page().getByRole("tab", { name: /^All/ })).toHaveTextContent("All3");
    expect(page().getByRole("tab", { name: /^Running/ })).toHaveTextContent("Running1");
    expect(page().getByRole("tab", { name: /^Review/ })).toHaveTextContent("Review1");
    expect(page().getByRole("tab", { name: /^Done/ })).toHaveTextContent("Done1");
    expect(page().getByTestId("research-task-filter-count-all")).toHaveTextContent("3");
    expect(page().getByTestId("research-task-filter-count-all")).toHaveClass("bg-primary/15");
    expect(page().getByTestId("research-task-filter-count-done")).not.toHaveClass("bg-primary/15");

    const chips = page().getAllByTestId("task-agent-chip");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent("Research model");
    expect(chips[0]).not.toHaveTextContent("provider");

    selectTab(/^Review/);
    expect(list().getByRole("button", { name: /Task review/ })).toBeInTheDocument();
    expect(list().queryByRole("button", { name: /Task done/ })).not.toBeInTheDocument();

    selectTab(/^Done/);
    expect(list().getByRole("button", { name: /Task done/ })).toBeInTheDocument();
    expect(list().queryByRole("button", { name: /Task running/ })).not.toBeInTheDocument();

    selectTab(/^All/);
    expect(page().getAllByRole("listitem")).toHaveLength(3);
  });

  it("marks tasks the background helper runs or is giving back", async () => {
    const helper = {
      ...task("helper", "paper", "running"),
      result: null,
      owner: "daemon" as const,
      reclaimRequested: false,
    };
    const returning = {
      ...task("returning", "paper", "running"),
      result: null,
      owner: "daemon" as const,
      reclaimRequested: true,
      createdAt: 0,
    };
    const local = { ...task("local", "paper", "running"), result: null, owner: "app" as const, createdAt: -1 };
    vi.mocked(api.listResearchTasks).mockResolvedValue([helper, returning, local]);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: /Task helper/ });

    expect(page().getAllByText(enResearchTools.backgroundHelper.badge.background)).toHaveLength(1);
    expect(page().getAllByText(enResearchTools.backgroundHelper.badge.movingBack)).toHaveLength(1);
    expect(page().getAllByTestId("task-owner-badge")).toHaveLength(2);
  });

  it("deletes a task only after the confirmation is accepted", async () => {
    const first = task("first");
    const second = { ...task("second"), createdAt: 0 };
    vi.mocked(api.listResearchTasks).mockResolvedValue([first, second]);
    vi.mocked(api.deleteResearchTask).mockResolvedValue(undefined);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(first.title) });
    openTask(first.title);

    fireEvent.click(page().getByRole("button", { name: `Delete ${first.title}` }));
    fireEvent.click(within(page().getByRole("alertdialog")).getByRole("button", { name: /Cancel/ }));
    expect(api.deleteResearchTask).not.toHaveBeenCalled();

    fireEvent.click(page().getByRole("button", { name: `Delete ${first.title}` }));
    expect(page().getByRole("alertdialog")).toHaveTextContent(first.title);
    fireEvent.click(within(page().getByRole("alertdialog")).getByRole("button", { name: enResearchTools.tasks.panel.deleteConfirm }));
    await waitFor(() => expect(api.deleteResearchTask).toHaveBeenCalledWith(first.id));
    await waitFor(() => expect(useResearchTasksStore.getState().tasks).toEqual([second]));
    expect(
      within(page().getByRole("navigation", { name: enResearchTools.tasks.panel.listLabel }))
        .queryByRole("button", { name: /Task first/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps a task that the backend refuses to delete", async () => {
    const current = task("kept");
    vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
    vi.mocked(api.deleteResearchTask).mockRejectedValue(new Error("Another task waits for this one"));
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: new RegExp(current.title) });
    openTask(current.title);
    fireEvent.click(page().getByRole("button", { name: `Delete ${current.title}` }));
    fireEvent.click(within(page().getByRole("alertdialog")).getByRole("button", { name: enResearchTools.tasks.panel.deleteConfirm }));
    expect(await page().findByRole("alert")).toHaveTextContent("Another task waits for this one");
    expect(card(current.title)).toBeInTheDocument();
  });

  it("opens a running task's Progress tab from View progress", async () => {
    const running: ResearchTask = { ...task("live", "paper", "running"), result: null };
    vi.mocked(api.listResearchTasks).mockResolvedValue([running]);
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    await page().findByRole("button", { name: /Task live/ });

    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.viewProgress }));

    const dialog = await page().findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: enResearchTools.tasks.detail.tabProgress })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("brings the composer back with its draft after a Settings link closed it", async () => {
    const { useSettingsStore } = await import("@/store/settings");
    useSettingsStore.setState({ settingsOpen: false });
    render(<ResearchTasksPanel projectId="paper" agents={agents} />);
    fireEvent.click(await page().findByRole("button", { name: enResearchTools.tasks.panel.createTask }));
    fireEvent.change(page().getByLabelText(enResearchTools.tasks.composer.titleLabel), { target: { value: "Half done" } });
    fireEvent.click(page().getByTestId("research-brief-more"));

    fireEvent.click(await page().findByTestId("research-brief-keep-running-settings"));

    await waitFor(() => expect(page().queryByTestId("research-task-composer")).toBeNull());
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    act(() => useSettingsStore.getState().setSettingsOpen(false));
    expect(await page().findByTestId("research-task-composer")).toBeInTheDocument();
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("Half done");
  });

  describe("autoresearch", () => {
    const squash = (value: string) => value.replace(/\s+/g, " ").trim();
    const workspace: TaskIsolationSummary = {
      kind: "staged_project",
      executionRoot: "/tasks/workspaces/failed/1",
      sourceRevision: "snapshot:base",
      baselineHash: "baseline",
      fileCount: 2,
      createdAt: 1,
    };

    function approval(id: string, taskId: string): ApprovalRecord {
      return {
        id,
        taskId,
        executionGeneration: 1,
        kind: "run",
        summary: "Train the larger model",
        detail: "python train.py --width 2048",
        status: "pending",
        createdAt: 1,
        expiresAt: Date.UTC(2026, 9, 20, 9, 30),
        decidedAt: null,
      };
    }

    function report(unused: boolean): EvidenceReport {
      return {
        checkedAt: 1,
        checks: [
          {
            id: "figures",
            status: unused ? "warn" : "pass",
            items: unused ? [{ code: "figures.unused", file: null, line: null, params: { path: "figures/new.png" } }] : [],
          },
        ],
      };
    }

    it("shows the phase, start time and waiting requests on task cards and the requests above the list", async () => {
      const runAfter = Date.UTC(2026, 9, 20, 9, 30);
      const working: ResearchTask = {
        ...task("working", "paper", "running"),
        result: null,
        phase: "waiting_runs",
        pendingApprovals: 2,
        createdAt: 3,
      };
      const scheduled: ResearchTask = {
        ...task("scheduled", "paper", "queued"),
        result: null,
        executionGeneration: 0,
        runAfter,
        phase: "waiting_runs",
        createdAt: 2,
      };
      vi.mocked(api.listResearchTasks).mockResolvedValue([working, scheduled]);
      vi.mocked(api.listResearchTaskApprovals).mockResolvedValue([approval("a1", "working")]);
      vi.mocked(api.decideResearchTaskApproval).mockResolvedValue({ ...approval("a1", "working"), status: "approved" });
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task working/ });

      const workingCard = card("Task working").closest("li") as HTMLElement;
      expect(workingCard).toHaveTextContent(enResearchTools.tasks.phase.waitingRuns);
      expect(workingCard).toHaveTextContent("2 requests waiting");
      const scheduledCard = card("Task scheduled").closest("li") as HTMLElement;
      expect(scheduledCard).toHaveTextContent(
        squash(enResearchTools.tasks.detail.startsAt.replace("{{time}}", formatDateTime(new Date(runAfter)))),
      );
      expect(scheduledCard).not.toHaveTextContent(enResearchTools.tasks.phase.waitingRuns);
      expect(scheduledCard).not.toHaveTextContent("requests waiting");

      const list = within(page().getByRole("navigation", { name: enResearchTools.tasks.panel.listLabel }));
      const banner = await list.findByTestId("research-pending-approvals");
      expect(api.listResearchTaskApprovals).toHaveBeenCalledWith("paper");
      expect(banner).toHaveTextContent("Task working");
      expect(banner).toHaveTextContent("python train.py --width 2048");
      fireEvent.click(within(banner).getByRole("button", { name: enResearchTools.tasks.approvals.approve }));
      await waitFor(() => expect(api.decideResearchTaskApproval).toHaveBeenCalledWith("a1", true));
    });

    it("leaves the requests banner out while no task waits for an answer", async () => {
      vi.mocked(api.listResearchTasks).mockResolvedValue([task("quiet")]);
      vi.mocked(api.listResearchTaskApprovals).mockResolvedValue([approval("stale", "quiet")]);
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task quiet/ });

      expect(page().queryByTestId("research-pending-approvals")).toBeNull();
      expect(api.listResearchTaskApprovals).not.toHaveBeenCalled();
    });

    it("approves an edited plan from the task's review tab", async () => {
      const ready: ResearchTask = { ...task("plan", "paper", "plan_ready"), result: null };
      const approved: ResearchTask = { ...ready, status: "queued", planApproved: true, startRequested: true, updatedAt: 2 };
      vi.mocked(api.listResearchTasks).mockResolvedValue([ready]);
      vi.mocked(api.loadResearchTaskPlan).mockResolvedValue({ text: "- [ ] Measure the baseline", truncated: false });
      vi.mocked(api.approveResearchTaskPlan).mockResolvedValue(approved);
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task plan/ });
      openTask(ready.title);

      const editor = await page().findByRole("textbox", { name: enResearchTools.tasks.plan.title });
      expect(api.loadResearchTaskPlan).toHaveBeenCalledWith(ready.id);
      fireEvent.change(editor, { target: { value: "- [ ] Measure the baseline twice" } });
      fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.plan.approveEdited }));

      await waitFor(() =>
        expect(api.approveResearchTaskPlan).toHaveBeenCalledWith(ready.id, "- [ ] Measure the baseline twice"),
      );
      await waitFor(() => expect(useResearchTasksStore.getState().tasks[0]).toMatchObject({ status: "queued", planApproved: true }));
    });

    it("resumes a failed task in its workspace or starts another one over", async () => {
      const first: ResearchTask = { ...task("first", "paper", "failed"), result: null, isolation: workspace, createdAt: 2 };
      const second: ResearchTask = { ...task("second", "paper", "failed"), result: null, isolation: workspace, createdAt: 1 };
      vi.mocked(api.listResearchTasks).mockResolvedValue([first, second]);
      vi.mocked(api.retryResearchTask).mockImplementation(async (id) => ({
        ...(id === first.id ? first : second),
        status: "queued",
        updatedAt: 2,
      }));
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task first/ });

      openTask(first.title);
      fireEvent.click(await page().findByRole("button", { name: enResearchTools.tasks.detail.resume }));
      await waitFor(() => expect(api.retryResearchTask).toHaveBeenCalledWith(first.id, "resume"));
      closeDetail();

      openTask(second.title);
      fireEvent.click(await page().findByRole("button", { name: enResearchTools.tasks.detail.startOver }));
      await waitFor(() => expect(api.retryResearchTask).toHaveBeenLastCalledWith(second.id, "fresh"));
      await waitFor(() =>
        expect(useResearchTasksStore.getState().tasks.map((entry) => entry.status)).toEqual(["queued", "queued"]),
      );
    });

    it("checks the evidence again and shows the new report", async () => {
      const current: ResearchTask = { ...task("evidence"), evidence: report(true) };
      vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
      vi.mocked(api.refreshResearchTaskEvidence).mockResolvedValue({ ...current, evidence: report(false), updatedAt: 2 });
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task evidence/ });
      openTask(current.title);

      const checklist = await page().findByTestId("research-evidence");
      expect(checklist).toHaveTextContent("figures/new.png isn't used in the document.");
      fireEvent.click(within(checklist).getByRole("button", { name: enResearchTools.evidence.refresh }));

      await waitFor(() => expect(api.refreshResearchTaskEvidence).toHaveBeenCalledWith(current.id));
      await waitFor(() => expect(page().getByTestId("research-evidence")).not.toHaveTextContent("figures/new.png"));
      expect(page().getByTestId("research-evidence")).toHaveTextContent(enResearchTools.evidence.status.pass);
    });

    it("keeps a plan waiting for approval under Review, so the filter shows what needs the user", async () => {
      const ready: ResearchTask = { ...task("ready", "paper", "plan_ready"), result: null, createdAt: 3 };
      const waiting: ResearchTask = task("waiting");
      const running: ResearchTask = { ...task("running", "paper", "running"), result: null, createdAt: 2 };
      vi.mocked(api.listResearchTasks).mockResolvedValue([ready, waiting, running]);
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task ready/ });

      expect(page().getByRole("tab", { name: /^Review/ })).toHaveTextContent("Review2");
      expect(page().getByRole("tab", { name: /^Running/ })).toHaveTextContent("Running1");
      selectTab(/^Review/);
      const list = within(page().getByRole("navigation", { name: enResearchTools.tasks.panel.listLabel }));
      expect(list.getByRole("button", { name: /Task ready/ })).toBeInTheDocument();
      expect(list.getByRole("button", { name: /Task waiting/ })).toBeInTheDocument();
      expect(list.queryByRole("button", { name: /Task running/ })).not.toBeInTheDocument();
    });

    it("builds no timeline while the task dialog is closed, however much live text arrives", async () => {
      const running: ResearchTask = { ...task("busy", "paper", "running"), result: null };
      vi.mocked(api.listResearchTasks).mockResolvedValue([running]);
      const timeline = await import("./task-timeline");
      const build = vi.spyOn(timeline, "buildTaskTimelineIncremental");
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task busy/ });
      await waitFor(() => expect(useResearchTasksStore.getState().selectedTaskId).toBe(running.id));
      build.mockClear();

      for (let sequence = 1; sequence <= 5; sequence += 1) {
        await act(async () =>
          changedEvent?.({ taskId: running.id, executionGeneration: 1, sequence, event: { kind: "text", text: `Row ${sequence}` }, createdAt: sequence }),
        );
      }

      expect(page().queryByRole("dialog")).toBeNull();
      expect(build).not.toHaveBeenCalled();
      openTask(running.title);
      await page().findByRole("dialog");
      expect(build).toHaveBeenCalled();
      build.mockRestore();
    });

    it("keeps the task and tab opened from the Files rail when this panel opens", async () => {
      const current = task("from-files");
      vi.mocked(api.listResearchTasks).mockResolvedValue([current]);
      useResearchTasksStore.setState({
        projectId: "paper",
        tasks: [current],
        selectedTaskId: current.id,
        detailOpen: true,
        detailTab: "review",
      });
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);

      const dialog = await page().findByRole("dialog");
      expect(within(dialog).getByRole("heading", { name: current.title })).toBeInTheDocument();
      expect(within(dialog).getByRole("tab", { name: enResearchTools.tasks.detail.tabReview })).toHaveAttribute("data-state", "active");
      await waitFor(() => expect(api.listResearchTasks).toHaveBeenCalledWith("paper"));
      expect(useResearchTasksStore.getState()).toMatchObject({ selectedTaskId: current.id, detailOpen: true });
    });

    it("drops a task that was deleted elsewhere when the list is refreshed", async () => {
      const kept = task("kept");
      const gone = { ...task("gone"), createdAt: 0 };
      vi.mocked(api.listResearchTasks).mockResolvedValueOnce([kept, gone]).mockResolvedValue([kept]);
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task gone/ });

      fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.panel.refreshAria }));

      await waitFor(() => expect(page().queryByRole("button", { name: /Task gone/ })).not.toBeInTheDocument());
      expect(card("Task kept")).toBeInTheDocument();
    });

    it("shows each request once while a task's dialog is open over the list", async () => {
      const waiting: ResearchTask = { ...task("waiting", "paper", "running"), result: null, pendingApprovals: 1 };
      vi.mocked(api.listResearchTasks).mockResolvedValue([waiting]);
      vi.mocked(api.listResearchTaskApprovals).mockResolvedValue([approval("a1", "waiting")]);
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task waiting/ });
      expect(await page().findAllByTestId("research-pending-approvals")).toHaveLength(1);

      openTask(waiting.title);
      const dialog = await page().findByRole("dialog");

      await within(dialog).findByTestId("research-pending-approvals");
      expect(page().getAllByTestId("research-pending-approvals")).toHaveLength(1);
      closeDetail();
      await waitFor(() => expect(page().getAllByTestId("research-pending-approvals")).toHaveLength(1));
      expect(page().queryByRole("dialog")).toBeNull();
    });

    it("keeps one task's buttons locked while another task's action finishes", async () => {
      const running: ResearchTask = { ...task("slow", "paper", "running"), result: null, createdAt: 2 };
      const queued: ResearchTask = { ...task("quick", "paper", "queued"), result: null, executionGeneration: 0, createdAt: 1 };
      const slowCancel = deferred<ResearchTask>();
      vi.mocked(api.listResearchTasks).mockResolvedValue([running, queued]);
      vi.mocked(api.cancelResearchTask).mockReturnValue(slowCancel.promise);
      vi.mocked(api.startResearchTask).mockResolvedValue({ ...queued, status: "running", updatedAt: 2 });
      render(<ResearchTasksPanel projectId="paper" agents={agents} />);
      await page().findByRole("button", { name: /Task slow/ });

      openTask(running.title);
      fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.detail.stopTask }));
      fireEvent.click(
        within(page().getByRole("alertdialog")).getByRole("button", { name: enResearchTools.tasks.detail.stopTask }),
      );
      closeDetail();
      await act(async () => {
        await useResearchTasksStore.getState().startTask(queued.id);
      });
      openTask(running.title);

      await waitFor(() => expect(useResearchTasksStore.getState().pendingActions).toEqual([running.id]));
      expect(page().getByRole("button", { name: enResearchTools.tasks.detail.stopTask })).toBeDisabled();
      await act(async () => slowCancel.resolve({ ...running, status: "cancelled", updatedAt: 3 }));
      await waitFor(() => expect(useResearchTasksStore.getState().pendingActions).toEqual([]));
    });
  });
});
