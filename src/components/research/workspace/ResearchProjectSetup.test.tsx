import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchProjectPreview, ResearchProjectRequest } from "@/lib/research-workspace";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };

let ResearchProjectSetup: typeof import("./ResearchProjectSetup").ResearchProjectSetup;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;
let userEvent: typeof import("@testing-library/user-event").default;

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

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
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
  });
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ ResearchProjectSetup } = await import("./ResearchProjectSetup"));
});

afterEach(() => cleanup());
beforeEach(() => {
  native.invoke.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function preview(request: ResearchProjectRequest): ResearchProjectPreview {
  const mainDocument = `main.${request.engine === "latex" ? "tex" : request.engine === "typst" ? "typ" : "md"}`;
  return {
    ...request,
    mainDocument,
    initialTask: `Plan ${request.name} as ${request.starter} in ${request.engine}`,
    files: [{ path: mainDocument, kind: "file", content: `Document for ${request.name}: ${request.starter}` }],
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

function props() {
  return {
    open: true,
    onClose: vi.fn(),
    onCreated: vi.fn(async () => {}),
    ensureInitialTask: vi.fn(async () => {}),
  };
}

function select(label: string, option: string) {
  fireEvent.keyDown(page().getByLabelText(label), { key: "ArrowDown" });
  fireEvent.click(page().getByRole("option", { name: option }));
}

describe("ResearchProjectSetup preview admission", () => {
  it("waits for the exact latest preview and creates its displayed files and starter task", async () => {
    const pending: { request: ResearchProjectRequest; result: ReturnType<typeof deferred<ResearchProjectPreview>> }[] = [];
    const creation = deferred<string>();
    native.invoke.mockImplementation((command: string, args: { request: ResearchProjectRequest }) => {
      if (command === "preview_research_project") {
        const result = deferred<ResearchProjectPreview>();
        pending.push({ request: args.request, result });
        return result.promise;
      }
      if (command === "create_research_project") return creation.promise;
      throw new Error(`Unexpected command: ${command}`);
    });
    const input = props();
    render(<ResearchProjectSetup {...input} />);
    await fill(enResearchTools.setup.nameLabel, "Study");
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].result.resolve(preview(pending[0].request)));
    expect(page().getByRole("button", { name: enResearchTools.setup.create })).toBeEnabled();

    select(enResearchTools.setup.engineLabel, "Typst");
    expect(page().getByRole("button", { name: enResearchTools.setup.create })).toBeDisabled();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.setup.create }));
    expect(native.invoke).not.toHaveBeenCalledWith("create_research_project", expect.anything());
    await waitFor(() => expect(pending).toHaveLength(2));
    select(enResearchTools.setup.starterLabel, enResearchTools.setup.starter.reproducibleAnalysis.label);
    await fill(enResearchTools.setup.nameLabel, "Revised study");
    await act(async () => pending[1].result.resolve(preview(pending[1].request)));
    expect(page().getByRole("button", { name: enResearchTools.setup.create })).toBeDisabled();
    expect(page().queryByText("Plan Study as article in typst")).not.toBeInTheDocument();
    const request = { name: "Revised study", engine: "typst", starter: "reproducible_analysis" } as const;
    await waitFor(() => expect(pending.map(({ request: candidate }) => candidate)).toContainEqual(request));
    const current = pending.find(({ request: candidate }) =>
      Object.entries(request).every(([key, value]) => candidate[key as keyof ResearchProjectRequest] === value),
    );
    expect(current).toBeDefined();
    await act(async () => current?.result.resolve(preview(request)));
    expect(page().getByText("Plan Revised study as reproducible_analysis in typst")).toBeInTheDocument();
    expect(page().getByText("Document for Revised study: reproducible_analysis")).toBeInTheDocument();

    fireEvent.click(page().getByRole("button", { name: enResearchTools.setup.create }));
    expect(native.invoke).toHaveBeenCalledWith("create_research_project", { request });
    expect(page().getByLabelText(enResearchTools.setup.nameLabel)).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.setup.engineLabel)).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.setup.starterLabel)).toBeDisabled();
    await act(async () => creation.resolve("new-project"));
    expect(input.ensureInitialTask).toHaveBeenCalledExactlyOnceWith({
      projectId: "new-project",
      title: enResearchTools.setup.starter.reproducibleAnalysis.task,
      prompt: "Plan Revised study as reproducible_analysis in typst",
      starter: "reproducible_analysis",
    });
    expect(input.onCreated).toHaveBeenCalledExactlyOnceWith("new-project");
    expect(input.onClose).toHaveBeenCalledOnce();
  });

  it("does not reuse the old preview when a renamed request fails validation", async () => {
    native.invoke.mockImplementation((command: string, args: { request: ResearchProjectRequest }) => {
      if (command === "preview_research_project") {
        if (args.request.name === "Invalid name") return Promise.reject(new Error("Invalid project name"));
        return Promise.resolve(preview(args.request));
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    render(<ResearchProjectSetup {...props()} />);
    await fill(enResearchTools.setup.nameLabel, "Valid name");
    await waitFor(() => expect(page().getByRole("button", { name: enResearchTools.setup.create })).toBeEnabled());

    await fill(enResearchTools.setup.nameLabel, "Invalid name");
    expect(page().getByRole("button", { name: enResearchTools.setup.create })).toBeDisabled();
    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("Invalid project name"));
    expect(page().getByRole("button", { name: enResearchTools.setup.create })).toBeDisabled();
    expect(page().queryByText("Plan Valid name as article in latex")).not.toBeInTheDocument();
    expect(native.invoke).not.toHaveBeenCalledWith("create_research_project", expect.anything());
  });

  it("retries a failed starter task against the already created project and its original preview", async () => {
    native.invoke.mockImplementation((command: string, args: { request: ResearchProjectRequest }) => {
      if (command === "preview_research_project") return Promise.resolve(preview(args.request));
      if (command === "create_research_project") return Promise.resolve("existing-project");
      throw new Error(`Unexpected command: ${command}`);
    });
    const input = props();
    input.ensureInitialTask.mockRejectedValueOnce(new Error("Task save failed"));
    render(<ResearchProjectSetup {...input} />);
    await fill(enResearchTools.setup.nameLabel, "Study");
    await waitFor(() => expect(page().getByRole("button", { name: enResearchTools.setup.create })).toBeEnabled());
    fireEvent.click(page().getByRole("button", { name: enResearchTools.setup.create }));
    await waitFor(() => expect(page().getByRole("alert")).toHaveTextContent("Task save failed"));

    expect(page().getByLabelText(enResearchTools.setup.nameLabel)).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.setup.engineLabel)).toBeDisabled();
    expect(page().getByLabelText(enResearchTools.setup.starterLabel)).toBeDisabled();
    fireEvent.click(page().getByRole("button", { name: enResearchTools.setup.retry }));
    await waitFor(() => expect(input.onClose).toHaveBeenCalledOnce());
    expect(native.invoke.mock.calls.filter(([command]) => command === "create_research_project")).toEqual([
      ["create_research_project", { request: { name: "Study", engine: "latex", starter: "article" } }],
    ]);
    expect(input.ensureInitialTask.mock.calls).toEqual([
      [{ projectId: "existing-project", title: enResearchTools.setup.starter.article.task, prompt: "Plan Study as article in latex", starter: "article" }],
      [{ projectId: "existing-project", title: enResearchTools.setup.starter.article.task, prompt: "Plan Study as article in latex", starter: "article" }],
    ]);
  });
});
