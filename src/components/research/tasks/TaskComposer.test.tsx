import { JSDOM } from "jsdom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@/lib/research-tasks";
import type { ResearchTaskAgentOption } from "./ResearchTasksPanel";

let TaskComposer: typeof import("./TaskComposer").TaskComposer;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let within: typeof import("@testing-library/react").within;
let userEvent: typeof import("@testing-library/user-event").default;

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
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
  vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
  });
  ({ cleanup, fireEvent, render, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ TaskComposer } = await import("./TaskComposer"));
});

afterEach(() => cleanup());

const agents: ResearchTaskAgentOption[] = [
  { runtimeId: "builtin", agentId: "provider", modelId: "first", label: "First model" },
  { runtimeId: "acp", agentId: "cli", modelId: "second", label: "Second model" },
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

describe("TaskComposer draft ownership", () => {
  it("preserves starter skills, edits, dependencies, and agent choice across catalog refreshes", async () => {
    const input = props();
    const view = render(<TaskComposer {...input} />);
    fireEvent.change(page().getByLabelText("Start from"), { target: { value: "analysis" } });
    await fill("Title", "My analysis");
    await fill("Instructions", "Use the cohort data");
    fireEvent.change(page().getByLabelText("Agent and model"), {
      target: { value: "acp\u0000cli\u0000second" },
    });
    fireEvent.click(page().getByRole("checkbox", { name: /Task dependency/ }));

    view.rerender(<TaskComposer {...input} agents={agents.map((agent) => ({ ...agent }))} tasks={[task("dependency"), task("new")]} />);

    expect(page().getByLabelText("Title")).toHaveValue("My analysis");
    expect(page().getByLabelText("Instructions")).toHaveValue("Use the cohort data");
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeChecked();
    fireEvent.click(page().getByRole("button", { name: "Create task" }));
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

  it("preserves an edited queued task on refresh and resets only for a different task", async () => {
    const original = task("first");
    const input = props(original);
    const view = render(<TaskComposer {...input} />);
    await fill("Title", "Unsaved title");
    await fill("Instructions", "Unsaved instructions");

    view.rerender(<TaskComposer {...input} agents={agents.map((agent) => ({ ...agent }))} editingTask={{ ...original, updatedAt: 2 }} />);
    fireEvent.click(page().getByRole("button", { name: "Save task" }));
    expect(input.onSave).toHaveBeenCalledExactlyOnceWith("first", expect.objectContaining({
      title: "Unsaved title",
      prompt: "Unsaved instructions",
      skillIds: ["peer-review"],
    }));

    view.rerender(<TaskComposer {...input} editingTask={task("second")} />);
    expect(page().getByLabelText("Title")).toHaveValue("Task second");
    expect(page().getByLabelText("Instructions")).toHaveValue("Complete second");
  });

  it("keeps a draft while agents load and requires an explicit replacement if its chosen agent disappears", async () => {
    const input = props();
    const view = render(<TaskComposer {...input} agents={[]} />);
    await fill("Title", "Keep this draft");
    await fill("Instructions", "Pending provider configuration");

    view.rerender(<TaskComposer {...input} />);
    expect(page().getByLabelText("Title")).toHaveValue("Keep this draft");
    expect(page().getByRole("button", { name: "Create task" })).toBeEnabled();
    view.rerender(<TaskComposer {...input} agents={[agents[1]]} />);
    expect(page().getByRole("button", { name: "Create task" })).toBeDisabled();
    expect(page().getByLabelText("Instructions")).toHaveValue("Pending provider configuration");
    expect(page().getByRole("option", { name: "Choose an agent and model" })).toHaveProperty("selected", true);
    await userEvent.setup({ document }).selectOptions(page().getByLabelText("Agent and model"), "acp\u0000cli\u0000second");
    fireEvent.click(page().getByRole("button", { name: "Create task" }));
    expect(input.onCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "Keep this draft",
      prompt: "Pending provider configuration",
      runtimeId: "acp",
      agentId: "cli",
      modelId: "second",
    }));

    view.rerender(<TaskComposer {...input} projectId="another-project" />);
    expect(page().getByLabelText("Title")).toHaveValue("");
    expect(page().getByLabelText("Instructions")).toHaveValue("");
  });

  it("keeps submitted task edits fixed while saving and leaves cancellation available", async () => {
    const input = props(task("editing"));
    const view = render(<TaskComposer {...input} />);
    await fill("Title", "Submitted title");
    await fill("Instructions", "Submitted instructions");
    const user = userEvent.setup({ document });
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    view.rerender(<TaskComposer {...input} busy />);

    await user.type(page().getByLabelText("Title"), " later edit");
    await user.type(page().getByLabelText("Instructions"), " later instructions");
    await user.selectOptions(page().getByLabelText("Agent and model"), "acp\u0000cli\u0000second");
    await user.click(page().getByRole("checkbox", { name: /Task dependency/ }));
    expect(page().getByLabelText("Title")).toHaveValue("Submitted title");
    expect(page().getByLabelText("Instructions")).toHaveValue("Submitted instructions");
    expect(page().getByLabelText("Agent and model")).toHaveValue("builtin\u0000provider\u0000first");
    expect(page().getByRole("checkbox", { name: /Task dependency/ })).toBeChecked();
    expect(page().getByRole("button", { name: "Saving..." })).toBeDisabled();
    await user.click(page().getByRole("button", { name: "Cancel" }));
    expect(input.onCancel).toHaveBeenCalledOnce();
    expect(input.onSave).not.toHaveBeenCalled();

    view.rerender(<TaskComposer {...input} />);
    await user.click(page().getByRole("button", { name: "Save task" }));
    expect(input.onSave).toHaveBeenCalledExactlyOnceWith("editing", expect.objectContaining({
      title: "Submitted title",
      prompt: "Submitted instructions",
      runtimeId: "builtin",
      dependencyIds: ["dependency"],
    }));
  });
});
