import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@/lib/research-tasks";
import type { ResearchTaskAgentOption } from "./ResearchTasksPanel";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { briefFixture, taskFieldsSince047 } from "./tests/task-fixtures";

let TaskComposer: typeof import("./TaskComposer").TaskComposer;
let composerDraftKey: typeof import("./TaskComposer").composerDraftKey;
let RESEARCH_TASK_STARTERS: typeof import("./TaskComposer").RESEARCH_TASK_STARTERS;
let useResearchTasksStore: typeof import("@/store/research-tasks").useResearchTasksStore;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let within: typeof import("@testing-library/react").within;
let waitFor: typeof import("@testing-library/react").waitFor;
let userEvent: typeof import("@testing-library/user-event").default;

const appConfig = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/research-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-tasks")>()),
  acceptResearchTaskResult: vi.fn(), applyResearchTask: vi.fn(), cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(), deleteResearchTask: vi.fn(), editResearchTask: vi.fn(),
  listResearchTasks: vi.fn(), listenForResearchTaskChanges: vi.fn(),
  listenForResearchTaskEvents: vi.fn(), loadResearchTaskEvents: vi.fn(),
  retryResearchTask: vi.fn(), startResearchTask: vi.fn(),
  previewResearchTaskFile: vi.fn(), previewResearchTaskArtifact: vi.fn(),
}));

// The composer reads the research defaults (time budget, network, background work) from the app config.
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  getConfig: appConfig.get,
}));

// The real "Where runs happen" control loads compute targets over IPC; it has its own tests.
vi.mock("@/components/settings/research/ComputeBriefFields", () => ({
  ComputeBriefFields: ({
    id,
    value,
    disabled,
    onChange,
  }: {
    id: string;
    value: { target: string | null };
    disabled?: boolean;
    onChange: (next: { executor: string; target: string | null; resources: null }) => void;
  }) => (
    <button
      id={id}
      type="button"
      disabled={disabled}
      onClick={() => onChange({ executor: "slurm", target: "t-s", resources: null })}
    >
      {`Runs on ${value.target ?? "this computer"}`}
    </button>
  ),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ runExternalProjectMutation: vi.fn() }) },
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
  vi.stubGlobal("HTMLFormElement", dom.window.HTMLFormElement);
  vi.stubGlobal("HTMLSelectElement", dom.window.HTMLSelectElement);
  vi.stubGlobal("Element", dom.window.Element);
  vi.stubGlobal("DocumentFragment", dom.window.DocumentFragment);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("NodeFilter", dom.window.NodeFilter);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
  vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
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
  ({ useResearchTasksStore } = await import("@/store/research-tasks"));
  ({ TaskComposer, composerDraftKey, RESEARCH_TASK_STARTERS } = await import("./TaskComposer"));
});

beforeEach(() => {
  useResearchTasksStore.setState({ composerDrafts: {} });
  // Outside the app the config is unavailable, as it was for these tests before 0.4.8.
  appConfig.get.mockReset().mockRejectedValue(new Error("The app config is not available."));
});

afterEach(() => cleanup());

const agents: ResearchTaskAgentOption[] = [
  { runtimeId: "builtin", agentId: "provider", modelId: "first", label: "First model", modelLabel: "Provider" },
  { runtimeId: "acp", agentId: "cli", modelId: "second", label: "Second model", modelLabel: "CLI agent" },
];

function task(id: string): ResearchTask {
  return {
    id,
    projectId: "paper",
    title: `Task ${id}`,
    prompt: `Complete ${id}`,
    runtimeId: "builtin",
    agentId: "provider",
    modelId: "first",
    skillIds: ["peer-review"],
    dependencyIds: [],
    status: "queued",
    executionGeneration: 1,
    sessionId: null,
    nativeSessionId: null,
    sourceRevision: null,
    isolation: null,
    error: null,
    result: null,
    review: null,
    startRequested: false,
    cancelRequested: false,
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    finishedAt: null,
    ...taskFieldsSince047(),
  };
}

function props(editingTask: ResearchTask | null = null) {
  return {
    projectId: "paper",
    agents,
    tasks: [task("dependency")],
    editingTask,
    busy: false,
    onCancel: vi.fn(),
    onDismiss: vi.fn(),
    onCreate: vi.fn(async () => {}),
    onSave: vi.fn(async () => {}),
  };
}

function page() {
  return within(document.body);
}

async function fill(label: string, value: string) {
  const user = userEvent.setup({ document });
  const input = page().getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
}

function choose(label: string, option: string | RegExp) {
  fireEvent.keyDown(page().getByLabelText(label), { key: "ArrowDown" });
  fireEvent.click(page().getByRole("option", { name: option }));
}

describe("TaskComposer draft ownership", () => {
  it("opens as a dialog and preserves starter skills, edits, dependencies, and agent choice across catalog refreshes", async () => {
    const input = props();
    const view = render(<TaskComposer {...input} />);
    expect(page().getByRole("dialog")).toHaveTextContent(enResearchTools.tasks.composer.newTitle);
    choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue(enResearchTools.tasks.starter.analysis.title);
    await fill(enResearchTools.tasks.composer.titleLabel, "My analysis");
    await fill(enResearchTools.tasks.composer.promptLabel, "Use the cohort data");
    choose(enResearchTools.tasks.composer.agentLabel, /Second model/);
    fireEvent.click(page().getByRole("checkbox", { name: /Task dependency/ }));

    view.rerender(<TaskComposer {...input} agents={agents.map((agent) => ({ ...agent }))} tasks={[task("dependency"), task("new")]} />);

    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("My analysis");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("Use the cohort data");
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeChecked();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    expect(input.onCreate).toHaveBeenCalledExactlyOnceWith({
      projectId: "paper",
      title: "My analysis",
      prompt: "Use the cohort data",
      runtimeId: "acp",
      agentId: "cli",
      modelId: "second",
      skillIds: ["statistical-analysis"],
      dependencyIds: ["dependency"],
      brief: briefFixture(),
      runAfter: null,
      keepRunningAfterQuit: false,
    });
  });

  it("shows each CLI agent's own logo instead of a terminal icon", () => {
    render(
      <TaskComposer
        {...props()}
        agents={[
          { runtimeId: "acp", agentId: "claude", modelId: "default", label: "Claude Code", modelLabel: "CLI agent" },
        ]}
      />,
    );
    expect(document.body.querySelector('svg[aria-label="Claude Code"]')).not.toBeNull();
    expect(document.body.querySelector("svg.lucide-terminal")).toBeNull();
  });

  it("shows a rejected create as an inline alert and keeps the draft", async () => {
    const input = props();
    input.onCreate = vi.fn(async () => {
      throw new Error(
        "The skill statistical-analysis is turned off. Enable it in Settings, AI, Skills.",
      );
    });
    render(<TaskComposer {...input} />);
    choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    await waitFor(() =>
      expect(page().getByRole("alert")).toHaveTextContent(
        "The skill statistical-analysis is turned off. Enable it in Settings, AI, Skills.",
      ),
    );
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue(enResearchTools.tasks.starter.analysis.title);
  });

  it("clears an attached starter skill when the user returns to a blank task", () => {
    const input = props();
    render(<TaskComposer {...input} />);
    choose(enResearchTools.tasks.composer.starterLabel, "Analysis");
    choose(enResearchTools.tasks.composer.starterLabel, enResearchTools.tasks.composer.blankStarter);
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    expect(input.onCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ skillIds: [] }),
    );
  });

  it("preserves an edited queued task on refresh and resets only for a different task", async () => {
    const original = task("first");
    const input = props(original);
    const view = render(<TaskComposer {...input} />);
    expect(page().getByRole("dialog")).toHaveTextContent(enResearchTools.tasks.composer.editTitle);
    await fill(enResearchTools.tasks.composer.titleLabel, "Unsaved title");
    await fill(enResearchTools.tasks.composer.promptLabel, "Unsaved instructions");

    view.rerender(<TaskComposer {...input} agents={agents.map((agent) => ({ ...agent }))} editingTask={{ ...original, updatedAt: 2 }} />);
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.saveTask }));
    expect(input.onSave).toHaveBeenCalledExactlyOnceWith("first", expect.objectContaining({
      title: "Unsaved title",
      prompt: "Unsaved instructions",
      skillIds: ["peer-review"],
    }));

    view.rerender(<TaskComposer {...input} editingTask={task("second")} />);
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("Task second");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("Complete second");
  });

  it("keeps a draft while agents load and requires an explicit replacement if its chosen agent disappears", async () => {
    const input = props();
    const view = render(<TaskComposer {...input} agents={[]} />);
    await fill(enResearchTools.tasks.composer.titleLabel, "Keep this draft");
    await fill(enResearchTools.tasks.composer.promptLabel, "Pending provider configuration");
    expect(page().getByLabelText(enResearchTools.tasks.composer.agentLabel)).toHaveTextContent(enResearchTools.tasks.composer.noAgents);

    view.rerender(<TaskComposer {...input} />);
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("Keep this draft");
    expect(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask })).toBeEnabled();
    view.rerender(<TaskComposer {...input} agents={[agents[1]]} />);
    expect(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask })).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("Pending provider configuration");
    expect(page().getByLabelText(enResearchTools.tasks.composer.agentLabel)).toHaveTextContent(enResearchTools.tasks.composer.chooseAgent);
    choose(enResearchTools.tasks.composer.agentLabel, /Second model/);
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    expect(input.onCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "Keep this draft",
      prompt: "Pending provider configuration",
      runtimeId: "acp",
      agentId: "cli",
      modelId: "second",
    }));

    view.rerender(<TaskComposer {...input} projectId="another-project" />);
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("");
  });

  it("shows why an unavailable agent cannot run and refuses to submit against it", () => {
    const blocked: ResearchTaskAgentOption = {
      ...agents[1],
      available: false,
      unavailableReason: "This CLI agent cannot run isolated tasks on Windows.",
    };
    render(<TaskComposer {...props()} agents={[blocked]} />);
    expect(page().getByText("This CLI agent cannot run isolated tasks on Windows.")).toBeInTheDocument();
    fireEvent.keyDown(page().getByLabelText(enResearchTools.tasks.composer.agentLabel), { key: "ArrowDown" });
    const option = page().getByRole("option", { name: /Second model/ });
    expect(option).toHaveAttribute("data-disabled");
    expect(option).toHaveTextContent("This CLI agent cannot run isolated tasks on Windows.");
  });

  it("keeps submitted task edits fixed while saving and leaves cancellation available", async () => {
    const input = props(task("editing"));
    const view = render(<TaskComposer {...input} />);
    await fill(enResearchTools.tasks.composer.titleLabel, "Submitted title");
    await fill(enResearchTools.tasks.composer.promptLabel, "Submitted instructions");
    const user = userEvent.setup({ document });
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    view.rerender(<TaskComposer {...input} busy />);

    await user.type(page().getByLabelText(enResearchTools.tasks.composer.titleLabel), " later edit");
    await user.type(page().getByLabelText(enResearchTools.tasks.composer.promptLabel), " later instructions");
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("Submitted title");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("Submitted instructions");
    expect(page().getByLabelText(enResearchTools.tasks.composer.agentLabel)).toHaveTextContent("First model");
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeChecked();
    expect(page().getByRole("button", { name: enResearchTools.tasks.composer.saving })).toBeDisabled();
    await user.click(page().getByRole("button", { name: enCommon.actions.cancel }));
    expect(input.onCancel).toHaveBeenCalledOnce();
    expect(input.onSave).not.toHaveBeenCalled();

    view.rerender(<TaskComposer {...input} />);
    await user.click(page().getByRole("button", { name: enResearchTools.tasks.composer.saveTask }));
    expect(input.onSave).toHaveBeenCalledExactlyOnceWith("editing", expect.objectContaining({
      title: "Submitted title",
      prompt: "Submitted instructions",
      runtimeId: "builtin",
      dependencyIds: ["dependency"],
    }));
  });

  it("keeps an unsaved draft when the dialog is dismissed and discards it on cancel", async () => {
    const input = props();
    const first = render(<TaskComposer {...input} />);
    await fill(enResearchTools.tasks.composer.titleLabel, "Draft");
    await fill(enResearchTools.tasks.composer.promptLabel, "Notes");
    fireEvent.keyDown(page().getByRole("dialog"), { key: "Escape" });
    expect(input.onDismiss).toHaveBeenCalledOnce();
    expect(input.onCancel).not.toHaveBeenCalled();
    expect(useResearchTasksStore.getState().composerDrafts[composerDraftKey("paper", null)]).toMatchObject({
      title: "Draft",
      prompt: "Notes",
    });
    first.unmount();

    const second = render(<TaskComposer {...input} />);
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("Draft");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("Notes");
    fireEvent.click(page().getByRole("button", { name: enCommon.actions.cancel }));
    expect(useResearchTasksStore.getState().composerDrafts[composerDraftKey("paper", null)]).toBeUndefined();
    second.unmount();

    render(<TaskComposer {...input} />);
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("");
  });
});

describe("TaskComposer brief", () => {
  const brief = enResearchTools.brief;

  interface SentDraft {
    brief: ResearchTask["brief"];
    runAfter: number | null;
    keepRunningAfterQuit: boolean;
  }

  /** The first argument of a mock's first call. */
  function sent(mock: { mock: { calls: unknown[][] } }): SentDraft {
    return mock.mock.calls[0][0] as SentDraft;
  }

  function openBrief() {
    fireEvent.click(page().getByTestId("research-brief-more"));
  }

  async function backgroundWorkLoaded() {
    await waitFor(() =>
      expect(page().getByRole("checkbox", { name: new RegExp(brief.keepRunning) })).toBeEnabled(),
    );
  }

  async function named(title = "Ablation", prompt = "Measure each change") {
    await fill(enResearchTools.tasks.composer.titleLabel, title);
    await fill(enResearchTools.tasks.composer.promptLabel, prompt);
  }

  function create() {
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
  }

  it("sends the brief with the task and validates the metric name", async () => {
    const input = props();
    render(<TaskComposer {...input} />);
    await named();
    fireEvent.change(page().getByLabelText(brief.goalLabel), { target: { value: "Lower the validation loss" } });
    fireEvent.change(page().getByLabelText(brief.criteriaLabel), { target: { value: "val_loss below 0.4\nNo new warnings" } });
    openBrief();
    const metric = page().getByRole("textbox", { name: brief.metricLabel });

    fireEvent.change(metric, { target: { value: "a b" } });
    expect(page().getByText(brief.invalidMetric)).toBeInTheDocument();
    const createButton = page().getByRole("button", { name: enResearchTools.tasks.composer.createTask });
    expect(createButton).toBeDisabled();
    create();
    expect(input.onCreate).not.toHaveBeenCalled();

    fireEvent.change(metric, { target: { value: "val_loss" } });
    expect(page().queryByText(brief.invalidMetric)).toBeNull();
    expect(createButton).toBeEnabled();
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    const draft = sent(input.onCreate);
    expect(draft.brief).toEqual(
      briefFixture({
        goal: "Lower the validation loss",
        successCriteria: ["val_loss below 0.4", "No new warnings"],
        primaryMetric: { name: "val_loss", goal: "minimize" },
      }),
    );
  });

  it("refuses a cost limit that is not above zero", async () => {
    const input = props();
    render(<TaskComposer {...input} />);
    await named();
    openBrief();
    fireEvent.change(page().getByLabelText(brief.costLabel), { target: { value: "0" } });

    expect(page().getByText(brief.invalidCost)).toBeInTheDocument();
    expect(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask })).toBeDisabled();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.createTask }));
    expect(input.onCreate).not.toHaveBeenCalled();
  });

  it("prefills the time budget and network from research settings", async () => {
    appConfig.get.mockResolvedValue({ research_time_budget_minutes: 240, research_command_network: true });
    const input = props();
    render(<TaskComposer {...input} />);
    await waitFor(() => expect(appConfig.get).toHaveBeenCalled());
    await named();
    openBrief();
    await waitFor(() =>
      expect(page().getByRole("combobox", { name: brief.timeLabel })).toHaveTextContent("4 hours"),
    );
    expect(page().getByRole("checkbox", { name: new RegExp(brief.network) })).toBeChecked();
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: expect.objectContaining({
          budget: expect.objectContaining({ wallClockMinutes: 240 }),
          permissions: expect.objectContaining({ network: true }),
        }),
      }),
    );
  });

  it("keeps the brief defaults when the settings leave them unset", async () => {
    appConfig.get.mockResolvedValue({});
    const input = props();
    render(<TaskComposer {...input} />);
    await waitFor(() => expect(appConfig.get).toHaveBeenCalled());
    await named();
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(expect.objectContaining({ brief: briefFixture() }));
  });

  it("does not overwrite a brief the user already changed with the settings", async () => {
    let answer!: (config: unknown) => void;
    appConfig.get.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const input = props();
    render(<TaskComposer {...input} />);
    await named();
    openBrief();
    fireEvent.click(page().getByRole("checkbox", { name: new RegExp(brief.reviewPlan) }));
    await act(async () => answer({ research_time_budget_minutes: 480, research_command_network: true }));
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ brief: briefFixture({ reviewPlanFirst: true }) }),
    );
  });

  it("ignores settings that arrive after the composer closed", async () => {
    let answer!: (config: unknown) => void;
    appConfig.get.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const view = render(<TaskComposer {...props()} />);
    view.unmount();
    await act(async () => answer({ research_time_budget_minutes: 480, research_background_enabled: true }));
    expect(page().queryByRole("dialog")).toBeNull();
  });

  it("schedules a start time", async () => {
    const input = props();
    render(<TaskComposer {...input} />);
    await named();
    openBrief();
    fireEvent.change(page().getByLabelText(brief.startAtLabel), { target: { value: "2026-10-20T09:30" } });
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ runAfter: new Date("2026-10-20T09:30").getTime(), keepRunningAfterQuit: false }),
    );
  });

  it("keeps running after Oleafly closes only when background work is on", async () => {
    appConfig.get.mockResolvedValue({ research_background_enabled: true });
    const input = props();
    render(<TaskComposer {...input} />);
    await named();
    openBrief();
    const keep = page().getByRole("checkbox", { name: new RegExp(brief.keepRunning) });
    await waitFor(() => expect(keep).toBeEnabled());
    expect(page().queryByText(brief.keepRunningHint)).toBeNull();
    fireEvent.click(keep);
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(expect.objectContaining({ keepRunningAfterQuit: true }));
  });

  it("does not keep a task running when background work is off", async () => {
    const input = props();
    useResearchTasksStore.setState({
      composerDrafts: {
        [composerDraftKey("paper", null)]: {
          starterId: "blank",
          title: "Overnight",
          prompt: "Keep going",
          agentKey: "",
          skillIds: [],
          dependencyIds: [],
          keepRunning: true,
        },
      },
    });
    render(<TaskComposer {...input} />);
    openBrief();
    const keep = page().getByRole("checkbox", { name: new RegExp(brief.keepRunning) });
    expect(keep).toBeDisabled();
    expect(keep).not.toBeChecked();
    expect(page().getByText(brief.keepRunningHint)).toBeInTheDocument();
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Overnight", keepRunningAfterQuit: false, brief: briefFixture() }),
    );
  });

  it("the reviewer response starter uses the response letter skill", () => {
    const starter = (id: string) => RESEARCH_TASK_STARTERS.find((candidate) => candidate.id === id);
    expect(starter("reviewer-response")?.skillIds).toEqual(["oleafly-response-letter"]);
    expect(starter("experiment-loop")).toMatchObject({
      skillIds: ["oleafly-experiment-loop"],
      brief: { reviewPlanFirst: true },
    });
  });

  it("starts an experiment loop with plan review turned on", async () => {
    const input = props();
    render(<TaskComposer {...input} />);
    choose(enResearchTools.tasks.composer.starterLabel, enResearchTools.tasks.starter.experimentLoop.label);

    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue(
      enResearchTools.tasks.starter.experimentLoop.title,
    );
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue(
      "Improve the main metric with a series of small, recorded experiments. Measure a baseline first, change one thing per run, and keep only changes that help.",
    );
    openBrief();
    expect(page().getByRole("checkbox", { name: new RegExp(brief.reviewPlan) })).toBeChecked();
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        skillIds: ["oleafly-experiment-loop"],
        brief: briefFixture({ reviewPlanFirst: true }),
      }),
    );
  });

  it("sends the compute target picked in the brief", async () => {
    const input = props();
    render(<TaskComposer {...input} />);
    await named();
    openBrief();
    fireEvent.click(await page().findByText("Runs on this computer"));
    expect(await page().findByText("Runs on t-s")).toBeInTheDocument();
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    expect(input.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: expect.objectContaining({ compute: { executor: "slurm", target: "t-s", resources: null } }),
      }),
    );
  });

  it("keeps the brief, start time and keep-running choice in a dismissed draft", async () => {
    appConfig.get.mockResolvedValue({ research_background_enabled: true, research_time_budget_minutes: 30 });
    const input = props();
    const first = render(<TaskComposer {...input} />);
    await named("Draft", "Notes");
    openBrief();
    await backgroundWorkLoaded();
    expect(page().getByRole("combobox", { name: brief.timeLabel })).toHaveTextContent("30 minutes");
    fireEvent.click(page().getByRole("checkbox", { name: new RegExp(brief.reviewPlan) }));
    fireEvent.change(page().getByLabelText(brief.startAtLabel), { target: { value: "2026-10-21T08:00" } });
    fireEvent.click(page().getByRole("checkbox", { name: new RegExp(brief.keepRunning) }));
    fireEvent.keyDown(page().getByRole("dialog"), { key: "Escape" });

    expect(input.onDismiss).toHaveBeenCalledOnce();
    const saved = useResearchTasksStore.getState().composerDrafts[composerDraftKey("paper", null)];
    expect(saved).toMatchObject({
      title: "Draft",
      prompt: "Notes",
      runAfter: new Date("2026-10-21T08:00").getTime(),
      keepRunning: true,
      brief: { reviewPlanFirst: true, budget: { wallClockMinutes: 30 } },
    });
    first.unmount();

    // The restored brief is the user's, so newer settings do not replace it.
    appConfig.get.mockResolvedValue({ research_background_enabled: true, research_time_budget_minutes: 720 });
    render(<TaskComposer {...input} />);
    openBrief();
    await backgroundWorkLoaded();
    expect(page().getByRole("checkbox", { name: new RegExp(brief.keepRunning) })).toBeChecked();
    create();

    await waitFor(() => expect(input.onCreate).toHaveBeenCalledOnce());
    const draft = sent(input.onCreate);
    expect(draft.brief.reviewPlanFirst).toBe(true);
    expect(draft.brief.budget.wallClockMinutes).toBe(30);
    expect(draft.runAfter).toBe(new Date("2026-10-21T08:00").getTime());
    expect(draft.keepRunningAfterQuit).toBe(true);
  });

  it("edits a task's brief, start time and keep-running choice", async () => {
    appConfig.get.mockResolvedValue({ research_background_enabled: true, research_time_budget_minutes: 720 });
    const editing: ResearchTask = {
      ...task("planned"),
      brief: briefFixture({ goal: "Old goal", reviewPlanFirst: true }),
      runAfter: new Date("2026-10-22T07:15").getTime(),
      keepRunningAfterQuit: true,
    };
    const input = props(editing);
    render(<TaskComposer {...input} />);
    expect(page().getByLabelText(brief.goalLabel)).toHaveValue("Old goal");
    openBrief();
    await backgroundWorkLoaded();
    expect(page().getByRole("checkbox", { name: new RegExp(brief.keepRunning) })).toBeChecked();
    expect(page().getByLabelText(brief.startAtLabel)).toHaveValue("2026-10-22T07:15");
    expect(page().getByRole("combobox", { name: brief.timeLabel })).toHaveTextContent("2 hours");
    fireEvent.change(page().getByLabelText(brief.goalLabel), { target: { value: "New goal" } });
    fireEvent.click(page().getByRole("button", { name: enResearchTools.tasks.composer.saveTask }));

    await waitFor(() => expect(input.onSave).toHaveBeenCalledOnce());
    expect(input.onSave).toHaveBeenCalledWith(
      "planned",
      expect.objectContaining({
        brief: briefFixture({ goal: "New goal", reviewPlanFirst: true }),
        runAfter: new Date("2026-10-22T07:15").getTime(),
        keepRunningAfterQuit: true,
      }),
    );
  });
});
