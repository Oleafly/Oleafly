import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/lib/tauri";
import type { ResearchTask, ResearchTaskDraft } from "@/lib/research-tasks";
import type { ResearchWorkspace, ResearchRootFileContent } from "@/lib/research-workspace";

let ResearchWorkspacePanel: typeof import("./ResearchWorkspacePanel").ResearchWorkspacePanel;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let useSettingsStore: typeof import("@/store/settings").useSettingsStore;
let useResearchTasksStore: typeof import("@/store/research-tasks").useResearchTasksStore;
let resetProviderConfigCache: typeof import("@/components/ai/provider-config").resetProviderConfigCache;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;
let userEvent: typeof import("@testing-library/user-event").default;
let queryClient: QueryClient;

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...await original<typeof import("@tauri-apps/api/core")>(), invoke: native.invoke,
}));
vi.mock("@tauri-apps/api/event", async (original) => ({
  ...await original<typeof import("@tauri-apps/api/event")>(), listen: native.listen,
}));

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://oleafly.test" });
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
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => dom.window.clearTimeout(handle));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => false },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ default: userEvent } = await import("@testing-library/user-event"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ useSettingsStore } = await import("@/store/settings"));
  ({ useResearchTasksStore } = await import("@/store/research-tasks"));
  ({ resetProviderConfigCache } = await import("@/components/ai/provider-config"));
  ({ ResearchWorkspacePanel } = await import("./ResearchWorkspacePanel"));
});

beforeEach(() => {
  native.invoke.mockReset();
  native.listen.mockClear();
  resetProviderConfigCache();
  useFilesStore.setState({ projectId: null });
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });
  useResearchTasksStore.setState({ projectId: null, tasks: [], selectedTaskId: null, events: [], eventsNextSequence: null, loading: false, eventsLoading: false, action: null, error: null });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function page() {
  return within(document.body);
}

function mount() {
  return render(<QueryClientProvider client={queryClient}><ResearchWorkspacePanel /></QueryClientProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function workspace(projectId: string): ResearchWorkspace {
  return {
    version: 1, primaryProjectId: projectId, updatedAtMs: 1,
    roots: [{ id: `${projectId}-root`, canonicalPath: `/study/${projectId}`, identity: projectId, label: `${projectId} data`, role: "data", access: "read_only", createdAtMs: 1 }],
  };
}

function task(draft: ResearchTaskDraft): ResearchTask {
  return {
    ...draft, id: `${draft.projectId}-task`, status: "queued", executionGeneration: 0,
    sessionId: null, nativeSessionId: null, sourceRevision: null, isolation: null,
    error: null, result: null, review: null, startRequested: false, cancelRequested: false,
    createdAt: 1, updatedAt: 1, startedAt: null, finishedAt: null,
  };
}

function providerConfig(): AppConfig {
  return {
    ai_provider: "openai", ai_model: "research-model", ai_keys: { openai: "fixture-only" },
    ai_provider_models: { openai: [
      { id: "research-model", name: "Research model", enabled: true, source: "custom" },
      { id: "disabled-model", name: "Disabled model", enabled: false, source: "custom" },
    ] },
  } as unknown as AppConfig;
}

describe("ResearchWorkspacePanel integration", () => {
  it("offers project-scoped entry points and opens agent settings without a project", async () => {
    native.invoke.mockResolvedValue({});
    mount();
    expect(page().getByText("Open a project to use research tasks")).toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Configure research agents" }));
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "ai" });
    await userEvent.setup({ document }).click(page().getByRole("tab", { name: "Linked folders" }));
    expect(page().getByText("Open a project to link its research folders.")).toBeInTheDocument();
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["get_config"]);
  });

  it("uses configured models and installed CLI capabilities to create the task the user drafted", async () => {
    const config = providerConfig();
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_config") return config;
      if (command === "acp_catalog") return [
        { definition: { id: "restricted-cli", name: "Restricted CLI" }, installed: true, taskUnavailableReason: "Isolated tasks are unavailable" },
        { definition: { id: "not-installed", name: "Missing CLI" }, installed: false },
      ];
      if (command === "research_task_list") return [];
      if (command === "research_task_create") return task(args.draft);
      throw new Error(`Unexpected command: ${command}`);
    });
    useFilesStore.setState({ projectId: "paper" });
    mount();
    await waitFor(() => expect(page().getByRole("button", { name: "New task" })).toBeEnabled());
    fireEvent.click(page().getByRole("button", { name: "New task" }));
    await waitFor(() => expect(page().getByRole("option", { name: /Research model/ })).toBeInTheDocument());
    expect(page().getByRole("option", { name: /Restricted CLI/ })).toBeDisabled();
    expect(page().queryByRole("option", { name: /Missing CLI|Disabled model/ })).not.toBeInTheDocument();
    fireEvent.change(page().getByLabelText("Start from"), { target: { value: "evidence-audit" } });
    const user = userEvent.setup({ document });
    await user.clear(page().getByLabelText("Title"));
    await user.type(page().getByLabelText("Title"), "Check the cohort evidence");
    await user.clear(page().getByLabelText("Instructions"));
    await user.type(page().getByLabelText("Instructions"), "Compare the claims to the attached data");
    await act(async () => window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: { ...config } })));
    fireEvent.click(page().getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("research_task_create", {
      draft: { projectId: "paper", title: "Check the cohort evidence", prompt: "Compare the claims to the attached data", runtimeId: "builtin", agentId: "openai", modelId: "research-model", skillIds: ["oleafly-verify-claims"], dependencyIds: [] },
    }));
    await waitFor(() => expect(page().queryByLabelText("Instructions")).not.toBeInTheDocument());
    expect(within(page().getByRole("navigation", { name: "Research task list" })).getByText("Check the cohort evidence")).toBeInTheDocument();
    expect(native.invoke).not.toHaveBeenCalledWith("research_task_start", expect.anything());
  });

  it("shows a provider-settings failure while keeping an installed task-capable CLI available", async () => {
    native.invoke.mockImplementation(async (command) => {
      if (command === "get_config") throw new Error("Settings file unavailable");
      if (command === "acp_catalog") return [{ definition: { id: "ready-cli", name: "Ready CLI" }, installed: true }];
      if (command === "research_task_list") return [];
      throw new Error(`Unexpected command: ${command}`);
    });
    useFilesStore.setState({ projectId: "paper" });
    mount();
    await waitFor(() => expect(page().getByText("Assistant settings could not be loaded.")).toBeInTheDocument());
    await waitFor(() => expect(page().getByRole("button", { name: "New task" })).toBeEnabled());
    fireEvent.click(page().getByRole("button", { name: "New task" }));
    expect(page().getByRole("option", { name: /Ready CLI/ })).toBeEnabled();
  });

  it("rejects old folder loads and file previews after switching the open project", async () => {
    const firstLoad = deferred<ResearchWorkspace>();
    const secondRead = deferred<ResearchRootFileContent>();
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "get_config") return {};
      if (command === "acp_catalog" || command === "research_task_list") return [];
      if (command === "get_research_workspace") return args.projectId === "first" ? firstLoad.promise : workspace(args.projectId);
      if (command === "list_research_root_files") return { entries: [{ relativePath: "measurements.csv", name: "measurements.csv", isDirectory: false, isSymlink: false, size: 10 }], truncated: false };
      if (command === "read_research_root_file") return secondRead.promise;
      throw new Error(`Unexpected command: ${command}`);
    });
    useFilesStore.setState({ projectId: "first" });
    mount();
    await userEvent.setup({ document }).click(page().getByRole("tab", { name: "Linked folders" }));
    await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("get_research_workspace", { projectId: "first" }));
    await act(async () => useFilesStore.setState({ projectId: "second" }));
    await waitFor(() => expect(page().getByLabelText("second data role")).toBeInTheDocument());
    await act(async () => firstLoad.resolve(workspace("first")));
    expect(page().queryByLabelText("first data role")).not.toBeInTheDocument();
    fireEvent.click(page().getByRole("button", { name: "Browse files" }));
    await waitFor(() => expect(page().getByRole("button", { name: "measurements.csv" })).toBeInTheDocument());
    fireEvent.click(page().getByRole("button", { name: "measurements.csv" }));
    expect(native.invoke).toHaveBeenCalledWith("read_research_root_file", { projectId: "second", rootId: "second-root", relativePath: "measurements.csv", maxBytes: 256 * 1024 });
    await act(async () => useFilesStore.setState({ projectId: "third" }));
    await waitFor(() => expect(page().getByLabelText("third data role")).toBeInTheDocument());
    await act(async () => secondRead.resolve({ rootId: "second-root", relativePath: "measurements.csv", content: "private second-project data", bytesRead: 27, truncated: false, isBinary: false }));
    expect(page().queryByText("private second-project data")).not.toBeInTheDocument();
    expect(page().queryByLabelText("second data role")).not.toBeInTheDocument();
    expect(page().getByLabelText("third data access")).toHaveTextContent("Read only");
  });
});
