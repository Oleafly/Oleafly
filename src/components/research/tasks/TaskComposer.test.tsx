import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@/lib/research-tasks";
import type { ResearchTaskAgentOption } from "./ResearchTasksPanel";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

let TaskComposer: typeof import("./TaskComposer").TaskComposer;
let composerDraftKey: typeof import("./TaskComposer").composerDraftKey;
let useResearchTasksStore: typeof import("@/store/research-tasks").useResearchTasksStore;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let within: typeof import("@testing-library/react").within;
let waitFor: typeof import("@testing-library/react").waitFor;
let userEvent: typeof import("@testing-library/user-event").default;

vi.mock("@/lib/research-tasks", () => ({
  acceptResearchTaskResult: vi.fn(), applyResearchTask: vi.fn(), cancelResearchTask: vi.fn(),
  createResearchTask: vi.fn(), deleteResearchTask: vi.fn(), editResearchTask: vi.fn(),
  listResearchTasks: vi.fn(), listenForResearchTaskChanges: vi.fn(),
  listenForResearchTaskEvents: vi.fn(), loadResearchTaskEvents: vi.fn(),
  retryResearchTask: vi.fn(), startResearchTask: vi.fn(),
  previewResearchTaskFile: vi.fn(), previewResearchTaskArtifact: vi.fn(),
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
  ({ cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ useResearchTasksStore } = await import("@/store/research-tasks"));
  ({ TaskComposer, composerDraftKey } = await import("./TaskComposer"));
});

beforeEach(() => {
  useResearchTasksStore.setState({ composerDrafts: {} });
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
    });
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
    await fill(enResearchTools.tasks.composer.titleLabel, "Interrupted draft");
    await fill(enResearchTools.tasks.composer.promptLabel, "Half written instructions");
    fireEvent.keyDown(page().getByRole("dialog"), { key: "Escape" });
    expect(input.onDismiss).toHaveBeenCalledOnce();
    expect(input.onCancel).not.toHaveBeenCalled();
    expect(useResearchTasksStore.getState().composerDrafts[composerDraftKey("paper", null)]).toMatchObject({
      title: "Interrupted draft",
      prompt: "Half written instructions",
    });
    first.unmount();

    const second = render(<TaskComposer {...input} />);
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("Interrupted draft");
    expect(page().getByLabelText(enResearchTools.tasks.composer.promptLabel)).toHaveValue("Half written instructions");
    fireEvent.click(page().getByRole("button", { name: enCommon.actions.cancel }));
    expect(useResearchTasksStore.getState().composerDrafts[composerDraftKey("paper", null)]).toBeUndefined();
    second.unmount();

    render(<TaskComposer {...input} />);
    expect(page().getByLabelText(enResearchTools.tasks.composer.titleLabel)).toHaveValue("");
  });
});
