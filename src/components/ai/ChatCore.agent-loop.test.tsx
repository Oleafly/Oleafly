import { JSDOM } from "jsdom";
import { within, type RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@oleafly/ai-core";
import type { ApprovalMode } from "@oleafly/ai-tools";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import type { AppConfig, ModelProbe, StoredModel } from "@/lib/tauri";
import type { ChatMessage, StoredChat } from "@/store/chats";

interface HarnessOptions {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  onRequestId?: (requestId: string) => void;
  onRawEvent?: (event: AgentEvent) => void;
  guardToolCall?: (call: { id: string; name: string; args: unknown }) => string | null;
  takePendingImages: () => string[];
  handlers: {
    onText: (text: string) => void;
    onToolCall: (call: { id: string; name: string; args: unknown }) => void | Promise<void>;
    onToolResult: (result: { id: string; output: unknown }) => void;
    onSteered?: (text: string) => void;
  };
}

interface PendingRun {
  options: HarnessOptions;
  resolve: (outcome: {
    text: string;
    usage: { input: number; output: number };
    steps: number;
    stopped_at_cap: boolean;
    error: string | null;
  }) => void;
}

const launchBrowser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-window", () => ({ launchBrowser }));

const mocks = vi.hoisted(() => ({
  runs: [] as PendingRun[],
  runAgentHarness: vi.fn(),
  agentProbeModel: vi.fn(),
  agentSteer: vi.fn(),
  agentThreadArchive: vi.fn(),
  agentThreadFork: vi.fn(),
  claimPrewarmed: vi.fn(),
  approvalsList: vi.fn(),
  approvalsSet: vi.fn(),
  approvalsModeGet: vi.fn(),
  approvalsModeSet: vi.fn(),
  getConfig: vi.fn(),
  gitPreparePublish: vi.fn(),
  gitHeadOid: vi.fn(),
  gitLog: vi.fn(),
  gitShow: vi.fn(),
  gitStatus: vi.fn(),
  usageRecord: vi.fn(),
  checkProjectBudget: vi.fn(),
  buildWorkspaceContext: vi.fn(),
  retrieveProjectChunks: vi.fn(),
  readFileContent: vi.fn(),
  mcpAgentToolsList: vi.fn(),
  mcpAgentToolAuthorize: vi.fn(),
  mcpAgentToolCall: vi.fn(),
  toastError: vi.fn(),
  createSkill: vi.fn(),
  refetchSkills: vi.fn(),
  skillEntries: [] as Array<Record<string, unknown>>,
  skillsLoaded: true,
  runSummaryProps: [] as Array<{
    todos: unknown[];
    turn: { chatId: string; turnId: string } | null;
    plan?: boolean;
  }>,
  planProps: [] as Array<{
    todos: unknown[];
    turn: { chatId: string; turnId: string } | null;
    approval?: {
      status: "awaiting" | "approved";
      busy?: boolean;
      onApprove: () => void;
      onRevise: () => void;
    };
  }>,
  textareaProps: null as null | {
    onChange: (event: { target: { value: string } }) => void;
    onKeyDown: (event: {
      key: string;
      shiftKey: boolean;
      nativeEvent: { isComposing: boolean };
      preventDefault: () => void;
    }) => void;
  },
  goalInputProps: null as null | {
    onChange: (event: { target: { value: string } }) => void;
  },
  modelSelectorProps: null as null | {
    modelId?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  },
}));

vi.mock("./agent-turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-turn")>()),
  runAgentHarness: (options: HarnessOptions) => mocks.runAgentHarness(options),
}));

vi.mock("@/lib/agent-backend", () => ({
  agentSteer: (...args: unknown[]) => mocks.agentSteer(...args),
  agentThreadArchive: (...args: unknown[]) => mocks.agentThreadArchive(...args),
  agentThreadFork: (...args: unknown[]) => mocks.agentThreadFork(...args),
  agentThreadClaimPrewarmed: (...args: unknown[]) => mocks.claimPrewarmed(...args),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  agentProbeModel: (...args: unknown[]) => mocks.agentProbeModel(...args),
  approvalsList: (...args: unknown[]) => mocks.approvalsList(...args),
  approvalsSet: (...args: unknown[]) => mocks.approvalsSet(...args),
  approvalsModeGet: (...args: unknown[]) => mocks.approvalsModeGet(...args),
  approvalsModeSet: (...args: unknown[]) => mocks.approvalsModeSet(...args),
  getConfig: (...args: unknown[]) => mocks.getConfig(...args),
  gitPreparePublish: (...args: unknown[]) => mocks.gitPreparePublish(...args),
  gitHeadOid: (...args: unknown[]) => mocks.gitHeadOid(...args),
  gitLog: (...args: unknown[]) => mocks.gitLog(...args),
  gitShow: (...args: unknown[]) => mocks.gitShow(...args),
  gitStatus: (...args: unknown[]) => mocks.gitStatus(...args),
  usageRecord: (...args: unknown[]) => mocks.usageRecord(...args),
  readFileContent: (...args: unknown[]) => mocks.readFileContent(...args),
  mcpAgentToolsList: (...args: unknown[]) => mocks.mcpAgentToolsList(...args),
  mcpAgentToolAuthorize: (...args: unknown[]) => mocks.mcpAgentToolAuthorize(...args),
  mcpAgentToolCall: (...args: unknown[]) => mocks.mcpAgentToolCall(...args),
}));

vi.mock("@/lib/ai-budget", () => ({
  checkProjectBudget: (...args: unknown[]) => mocks.checkProjectBudget(...args),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/ai-context", () => ({
  buildWorkspaceContext: (...args: unknown[]) => mocks.buildWorkspaceContext(...args),
}));

vi.mock("@/lib/ai-rag", () => ({
  formatRagContext: () => "",
  retrieveProjectChunks: (...args: unknown[]) => mocks.retrieveProjectChunks(...args),
}));

vi.mock("@/lib/skills", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/skills")>()),
  createSkill: (...args: unknown[]) => mocks.createSkill(...args),
  useSkills: () => ({
    data: mocks.skillsLoaded ? mocks.skillEntries : undefined,
    refetch: mocks.refetchSkills,
  }),
}));

vi.mock("@/contributions/ai-toolsets", () => ({
  registerAiToolsets: () => {},
}));

vi.mock("@oleafly/registry", () => ({
  registry: {
    aiToolsets: [
      {
        id: "test-tools",
        mode: "chat",
        create: ({ confirm }: { confirm: (request: unknown) => Promise<boolean> }) => ({
          read_file: {
            execute: async () => ({ content: "" }),
          },
          update_todos: {
            execute: async () => ({ ok: true }),
          },
          write_file: {
            execute: async () => ({
              approved: await confirm({
                tool: "write_file",
                summary: "Write main.tex",
                path: "main.tex",
              }),
            }),
          },
          run_command: {
            execute: async () => ({
              approved: await confirm({
                tool: "run_command",
                summary: "$ echo unsafe",
                projectId: "project",
                command: "echo unsafe",
                cwd: "/project",
              }),
            }),
          },
          literature_search: {
            execute: async () => ({
              approved: await confirm({
                tool: "literature_search",
                summary: "Search OpenAlex for approval policies",
              }),
            }),
          },
        }),
      },
    ],
  },
}));

vi.mock("@/components/ai/AttachmentChips", async () => {
  const React = await import("react");
  return {
    AttachmentChips: ({ items }: { items: Array<{ id: string; name: string }> }) =>
      React.createElement(
        "div",
        null,
        items.map((item) => React.createElement("span", { key: item.id }, item.name)),
      ),
  };
});

vi.mock("@/components/ai/ChatHistoryModal", () => ({
  ChatHistoryModal: () => null,
}));

vi.mock("@/components/ai/ModelSelector", async () => {
  const React = await import("react");
  return {
    ModelSelector: (props: typeof mocks.modelSelectorProps) => {
      mocks.modelSelectorProps = props;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "button",
          {
            "aria-label": "AI model",
            type: "button",
            onClick: () => props?.onOpenChange?.(!props.open),
          },
          props?.modelId ?? "Select a model",
        ),
        props?.open
          ? React.createElement("input", { "aria-label": "Search models", autoFocus: true })
          : null,
      );
    },
  };
});

vi.mock("@/components/ai/SubagentActivity", () => ({
  SubagentActivity: () => null,
}));

vi.mock("@/components/branding/OleaflyAssistantMascot", () => ({
  OleaflyAssistantMascot: () => null,
}));

vi.mock("@/components/ai/chat-parts", async () => {
  const React = await import("react");
  return {
  AgentStatusPill: (props: (typeof mocks.planProps)[number]) => {
    mocks.planProps.push(props);
    const approval = props.approval;
    return React.createElement(
      "div",
      { "data-testid": "agent-status-pill", "data-plan-status": approval?.status ?? "none" },
      approval?.status === "awaiting"
        ? [
            React.createElement(
              "button",
              {
                key: "approve",
                type: "button",
                "aria-label": "Approve plan",
                disabled: approval.busy,
                onClick: approval.onApprove,
              },
              "Approve plan",
            ),
            React.createElement(
              "button",
              {
                key: "revise",
                type: "button",
                "aria-label": "Revise",
                disabled: approval.busy,
                onClick: approval.onRevise,
              },
              "Revise",
            ),
          ]
        : null,
    );
  },
  AgentRunSummary: (props: (typeof mocks.runSummaryProps)[number]) => {
    mocks.runSummaryProps.push(props);
    return React.createElement("div", {
      "data-testid": "agent-run-summary",
      "data-plan": props.plan ? "true" : "false",
    });
  },
  InfoHint: () => null,
  MessageItem: () => null,
  Shimmer: () => null,
  formatError: (error: unknown) => String(error),
  formatToolOutput: (output: unknown) =>
    typeof output === "string" ? output : JSON.stringify(output),
  };
});

vi.mock("@/components/ui/textarea", async () => {
  const React = await import("react");
  return {
    Textarea: React.forwardRef<HTMLTextAreaElement, Record<string, unknown>>((props, ref) => {
      mocks.textareaProps = props as typeof mocks.textareaProps;
      return React.createElement("textarea", { ...props, ref });
    }),
  };
});

vi.mock("@/components/ui/input", async () => {
  const React = await import("react");
  return {
    Input: React.forwardRef<HTMLInputElement, Record<string, unknown>>((props, ref) => {
      if (props["aria-label"] === "Goal") {
        mocks.goalInputProps = props as typeof mocks.goalInputProps;
      }
      return React.createElement("input", { ...props, ref });
    }),
  };
});

let ChatCore: typeof import("./ChatCore").ChatCore;
let ChatPanel: typeof import("./ChatPanel").ChatPanel;
let CopilotOverlay: typeof import("./CopilotOverlay").CopilotOverlay;
let resetProviderConfigCache: typeof import("./provider-config").resetProviderConfigCache;
let Fragment: typeof import("react").Fragment;
let LATEX_ENGINE: typeof import("@/lib/document-engine").LATEX_ENGINE;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let useChatsStore: typeof import("@/store/chats").useChatsStore;
let useSettingsStore: typeof import("@/store/settings").useSettingsStore;
let useApprovalModeStore: typeof import("@/store/approval-mode").useApprovalModeStore;
let useAgentTurnsStore: typeof import("@/store/agent-turns").useAgentTurnsStore;
let useAgentTodoStore: typeof import("@/store/agent-todos").useAgentTodoStore;
let useAgentFileChangesStore: typeof import("@/store/agent-file-changes").useAgentFileChangesStore;
let agentFileChangeTurnForChat: typeof import("@/store/agent-file-changes").agentFileChangeTurnForChat;
let useAssistantOutputsStore: typeof import("@/store/assistant-outputs").useAssistantOutputsStore;
let usePlanModeStore: typeof import("@/store/plan-mode").usePlanModeStore;
let usePlanApprovalStore: typeof import("@/store/plan-approval").usePlanApprovalStore;
let PLAN_MODE_HINT: typeof import("./ChatCore").PLAN_MODE_HINT;
let PLAN_MODE_PLANNING_PROMPT: typeof import("./ChatCore").PLAN_MODE_PLANNING_PROMPT;
let PLAN_MODE_REVISION_LINE: typeof import("./ChatCore").PLAN_MODE_REVISION_LINE;
let useChatGoalStore: typeof import("@/store/chat-goal").useChatGoalStore;
let useAiToolSettingsStore: typeof import("@/store/ai-tool-settings").useAiToolSettingsStore;
let activeChatRun: typeof import("./chat-run-registry").activeChatRun;
let endChatRun: typeof import("./chat-run-registry").endChatRun;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let createElement: typeof import("react").createElement;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let createAppQueryClient: typeof import("@/lib/query").createAppQueryClient;
let chatQueryClient: ReturnType<typeof createAppQueryClient>;
let projectSequence = 0;

beforeAll(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLButtonElement: { configurable: true, value: dom.window.HTMLButtonElement },
    HTMLFormElement: { configurable: true, value: dom.window.HTMLFormElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
    HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    NodeFilter: { configurable: true, value: dom.window.NodeFilter },
    Event: { configurable: true, value: dom.window.Event },
    CustomEvent: { configurable: true, value: dom.window.CustomEvent },
    File: { configurable: true, value: dom.window.File },
    FileReader: { configurable: true, value: dom.window.FileReader },
    MutationObserver: { configurable: true, value: dom.window.MutationObserver },
    getComputedStyle: {
      configurable: true,
      value: dom.window.getComputedStyle.bind(dom.window),
    },
  });
  const requestFrame = (callback: FrameRequestCallback) =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  const cancelFrame = (handle: number) => dom.window.clearTimeout(handle);
  Object.defineProperties(globalThis, {
    requestAnimationFrame: { configurable: true, value: requestFrame },
    cancelAnimationFrame: { configurable: true, value: cancelFrame },
  });
  Object.defineProperties(dom.window, {
    requestAnimationFrame: { configurable: true, value: requestFrame },
    cancelAnimationFrame: { configurable: true, value: cancelFrame },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
  });

  vi.resetModules();
  ({ createElement, Fragment } = await import("react"));
  ({ act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ createAppQueryClient } = await import("@/lib/query"));
  ({ ChatCore, PLAN_MODE_HINT, PLAN_MODE_PLANNING_PROMPT, PLAN_MODE_REVISION_LINE } =
    await import("./ChatCore"));
  ({ ChatPanel } = await import("./ChatPanel"));
  ({ CopilotOverlay } = await import("./CopilotOverlay"));
  ({ resetProviderConfigCache } = await import("./provider-config"));
  ({ LATEX_ENGINE } = await import("@/lib/document-engine"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ useChatsStore } = await import("@/store/chats"));
  ({ useSettingsStore } = await import("@/store/settings"));
  ({ useApprovalModeStore } = await import("@/store/approval-mode"));
  ({ useAgentTurnsStore } = await import("@/store/agent-turns"));
  ({ useAgentTodoStore } = await import("@/store/agent-todos"));
  ({ useAgentFileChangesStore, agentFileChangeTurnForChat } = await import("@/store/agent-file-changes"));
  ({ useAssistantOutputsStore } = await import("@/store/assistant-outputs"));
  ({ usePlanModeStore } = await import("@/store/plan-mode"));
  ({ usePlanApprovalStore } = await import("@/store/plan-approval"));
  ({ useChatGoalStore } = await import("@/store/chat-goal"));
  ({ useAiToolSettingsStore } = await import("@/store/ai-tool-settings"));
  ({ activeChatRun, endChatRun } = await import("./chat-run-registry"));
});

afterEach(() => cleanup());

beforeEach(() => {
  const active = activeChatRun();
  if (active) endChatRun(active);
  resetProviderConfigCache();
  mocks.runs.length = 0;
  mocks.runSummaryProps.length = 0;
  mocks.planProps.length = 0;
  mocks.textareaProps = null;
  mocks.goalInputProps = null;
  mocks.modelSelectorProps = null;
  mocks.agentProbeModel
    .mockReset()
    .mockResolvedValue({ verdict: "verified", reason: "", probedAt: 1 });
  mocks.agentSteer.mockReset().mockResolvedValue({ status: "delivered" });
  mocks.agentThreadArchive.mockReset().mockResolvedValue(true);
  mocks.agentThreadFork.mockReset().mockResolvedValue("thread-forked");
  mocks.claimPrewarmed.mockReset().mockResolvedValue(null);
  mocks.approvalsList.mockReset().mockResolvedValue({});
  mocks.approvalsSet.mockReset().mockResolvedValue(undefined);
  mocks.approvalsModeGet.mockReset().mockResolvedValue("approve-for-me");
  mocks.approvalsModeSet.mockReset().mockResolvedValue(undefined);
  mocks.getConfig.mockReset().mockResolvedValue({
    ai_provider: "openai",
    ai_model: "gpt-4o",
    ai_api_key: "test-key",
    ai_keys: { openai: "test-key" },
    ai_provider_models: {},
    ai_custom_providers: [],
    ai_system_prompt: "",
    ai_personas: [],
  });
  mocks.gitPreparePublish.mockReset().mockResolvedValue(undefined);
  mocks.gitHeadOid.mockReset().mockResolvedValue(null);
  mocks.gitLog.mockReset().mockResolvedValue([]);
  mocks.gitShow.mockReset().mockResolvedValue("");
  mocks.gitStatus.mockReset().mockResolvedValue([]);
  mocks.usageRecord.mockReset().mockResolvedValue(undefined);
  mocks.checkProjectBudget.mockReset().mockResolvedValue("ok");
  mocks.buildWorkspaceContext.mockReset().mockResolvedValue("");
  mocks.retrieveProjectChunks.mockReset().mockResolvedValue([]);
  mocks.readFileContent.mockReset().mockResolvedValue("");
  mocks.mcpAgentToolsList.mockReset().mockResolvedValue([
    {
      name: "Papers",
      tools: [
        {
          name: "mcp__papers__search_papers",
          tool_handle: "search_papers",
          description: "Search the connected papers server.",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    },
  ]);
  mocks.mcpAgentToolAuthorize.mockReset().mockResolvedValue("approval-1");
  mocks.mcpAgentToolCall.mockReset().mockResolvedValue({
    content: [{ type: "text", text: "No papers found" }],
  });
  mocks.toastError.mockReset();
  mocks.createSkill.mockReset().mockResolvedValue(
    skillEntry({
      id: "recorded-review",
      name: "Recorded Review",
      description: "Repeat the review approach from this chat.",
      instructions: "Review this draft before enabling it.",
    }),
  );
  mocks.refetchSkills.mockReset().mockResolvedValue(undefined);
  mocks.skillEntries.length = 0;
  mocks.skillsLoaded = true;
  mocks.runAgentHarness.mockReset().mockImplementation(
    (options: HarnessOptions) =>
      new Promise((resolve) => {
        const requestId = `request-${mocks.runs.length + 1}`;
        options.onRequestId?.(requestId);
        mocks.runs.push({ options, resolve });
      }),
  );
  const projectId = `project-${++projectSequence}`;
  const chat: StoredChat = {
    id: "chat-1",
    projectId,
    title: "New chat",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    headOid: null,
  };
  useFilesStore.setState({
    projectId,
    projectName: "Test project",
    projectKind: "",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
  });
  useChatsStore.setState({
    projectId,
    chats: [chat],
    activeId: chat.id,
    live: {},
  });
  useSettingsStore.setState({
    browserOpen: false,
    webBrowser: true,
    chatFloating: false,
    figureModeOpen: false,
    settingsInitialSection: "general",
    settingsOpen: false,
    settingsScrollTarget: null,
  });
  useApprovalModeStore.setState({ modes: {}, loaded: {}, persisted: {} });
  useAgentTurnsStore.getState().reset();
  useAgentTodoStore.getState().clear();
  useAgentFileChangesStore.setState({
    turns: {},
    activeTurnByChat: {},
    lastTurnByChat: {},
  });
  useAssistantOutputsStore.setState({ fileOpen: null, pdfEpoch: 0 });
  usePlanModeStore.setState({ enabledByProject: {}, loaded: {} });
  try {
    localStorage.clear();
  } catch {
    void 0;
  }
  usePlanApprovalStore.setState({ byChat: {}, loaded: {} });
  useChatGoalStore.setState({ goalsByProject: {}, loaded: {} });
  useAiToolSettingsStore.setState({ enabledByName: {} });
});

function finishRun(index: number, text: string) {
  const run = mocks.runs[index];
  run.options.handlers.onText(text);
  run.resolve({
    text,
    usage: { input: 0, output: 0 },
    steps: 1,
    stopped_at_cap: false,
    error: null,
  });
}

async function renderChat(): Promise<RenderResult> {
  chatQueryClient = createAppQueryClient();
  const rendered = render(
    createElement(
      QueryClientProvider,
      { client: chatQueryClient },
      createElement(ChatCore),
    ),
  );
  await waitFor(() => {
    expect(
      rendered.container.querySelector('[data-tour-configured="true"]'),
    ).not.toBeNull();
  });
  return rendered;
}

function submit(rendered: RenderResult, text: string) {
  rendered.getByPlaceholderText("Ask AI to help with your document…");
  act(() => mocks.textareaProps?.onChange({ target: { value: text } }));
  act(() =>
    mocks.textareaProps?.onKeyDown({
      key: "Enter",
      shiftKey: false,
      nativeEvent: { isComposing: false },
      preventDefault: () => {},
    }),
  );
}

function changeComposer(text: string) {
  act(() => mocks.textareaProps?.onChange({ target: { value: text } }));
}

function pressComposerKey(key: string) {
  act(() =>
    mocks.textareaProps?.onKeyDown({
      key,
      shiftKey: false,
      nativeEvent: { isComposing: false },
      preventDefault: () => {},
    }),
  );
}

function openAttachMenu(rendered: RenderResult) {
  fireEvent.pointerDown(rendered.getByRole("button", { name: "Add context" }), {
    button: 0,
    ctrlKey: false,
  });
}

async function beginApprovalCall(
  mode: ApprovalMode,
  tool: "write_file" | "run_command" | "literature_search" = "write_file",
  rules: Record<string, "allow" | "deny"> = {},
) {
  mocks.approvalsModeGet.mockResolvedValue(mode);
  mocks.approvalsList.mockResolvedValue(rules);
  const rendered = await renderChat();
  submit(rendered, `Use ${tool}`);
  await waitFor(() => expect(mocks.runs).toHaveLength(1));
  mocks.runs[0].options.handlers.onToolCall({
    id: "call-1",
    name: tool,
    args: {},
  });
  const result = Promise.resolve(mocks.runs[0].options.tools[tool].execute?.({}));
  return { rendered, result };
}

function plainTranscript(messages: ModelMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function attachTextFile(rendered: RenderResult, name: string, text: string) {
  const input = rendered.container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("attachment input missing");
  fireEvent.change(input, {
    target: { files: [new File([text], name, { type: "text/plain", lastModified: 1 })] },
  });
  await waitFor(() => expect(rendered.getByText(name)).toBeTruthy());
}

function skillEntry(
  overrides: Record<string, unknown> & { id: string },
): Record<string, unknown> {
  return {
    name: overrides.id,
    description: `Description for ${overrides.id}.`,
    instructions: `Instructions for ${overrides.id}.`,
    dir: `/skills/${overrides.id}`,
    files: [],
    license: null,
    compatibility: null,
    allowedTools: [],
    version: null,
    author: null,
    tier: "user",
    phase: null,
    tools: [],
    source: "user",
    packVersion: null,
    updateAvailable: false,
    projectEnabled: false,
    enabled: false,
    removable: true,
    validation: { status: "valid" },
    ...overrides,
  };
}

function seedCompletedChat() {
  useChatsStore.setState((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === state.activeId
        ? {
            ...chat,
            messages: [
              { id: "record-user", role: "user", content: "Review this proof carefully." },
              {
                id: "record-assistant",
                role: "assistant",
                content: "I mapped the claims, checked each dependency, and listed the gaps.",
              },
            ],
          }
        : chat,
    ),
  }));
}

describe("ChatCore agent turns", () => {
  it("shows the current project and configured MCP tools in the header", async () => {
    const rendered = await renderChat();

    fireEvent.click(rendered.getByRole("button", { name: "Manage agent tools" }));

    await waitFor(() =>
      expect(rendered.getByRole("heading", { name: "Project tools" })).toBeTruthy(),
    );
    expect(rendered.getByRole("heading", { name: "MCP Papers" })).toBeTruthy();
    expect(rendered.getByRole("switch", { name: "Enable write_file" })).toBeChecked();
    expect(
      rendered.getByRole("switch", { name: "Enable mcp__papers__search_papers" }),
    ).toBeChecked();
  });

  it("opens assistant MCP settings from the chat header chip", async () => {
    const rendered = await renderChat();
    const header = rendered.container.querySelector('[data-tour="ai-assistant-header"]');
    if (!(header instanceof HTMLElement)) throw new Error("AI assistant header missing");

    const chip = within(header).getByRole("button", { name: "Assistant MCP settings" });
    expect(within(header).getByRole("button", { name: "Manage agent tools" })).toBeTruthy();
    fireEvent.click(chip);

    expect(useSettingsStore.getState()).toMatchObject({
      settingsInitialSection: "ai",
      settingsScrollTarget: "ai-mcp",
      settingsOpen: true,
    });
  });

  it("keeps the composer footer on one line with progressively collapsible controls", async () => {
    const rendered = await renderChat();
    const controls = rendered.getByTestId("ai-composer-controls");
    const left = rendered.getByTestId("ai-composer-controls-left");
    const right = rendered.getByTestId("ai-composer-controls-right");

    expect(controls).toHaveClass(
      "min-w-0",
      "flex-nowrap",
      "gap-0.5",
      "[container-name:ai-composer]",
      "[container-type:inline-size]",
    );
    expect(controls).not.toHaveClass("flex-wrap");
    expect(left).toHaveClass("min-w-0", "flex-nowrap", "overflow-x-auto");
    expect(left).not.toHaveClass("flex-1");
    expect(left).not.toHaveClass("grow");
    expect(left).toHaveClass(
      "[&_button:focus-visible]:outline-offset-[-2px]",
      "[&_button:focus-visible]:ring-inset",
      "[&_button:focus-visible]:ring-offset-0",
    );
    expect(left).not.toHaveClass("flex-wrap");
    expect(right).toHaveClass("shrink-0", "flex-nowrap");
    const model = rendered.getByRole("button", { name: "AI model" });
    expect(right).toContainElement(model);
    expect(rendered.queryByRole("button", { name: "Voice input (coming soon)" })).toBeNull();
    expect(rendered.getByRole("button", { name: "Send" })).toBeVisible();

    const attach = rendered.getByRole("button", { name: "Add context" });
    const approval = rendered.getByRole("button", {
      name: "Approval mode. Approve for me",
    });
    const prompts = rendered.getByRole("button", { name: "Prompt shortcuts" });
    const persona = rendered.getByRole("button", { name: "Choose persona" });
    const plan = rendered.getByRole("button", { name: "Plan mode" });
    const figure = rendered.getByRole("button", { name: "Toggle figure mode" });
    const leftControls = [attach, approval, prompts, persona, plan, figure];
    for (const control of leftControls) expect(left).toContainElement(control);
    for (let index = 0; index < leftControls.length - 1; index += 1) {
      expect(
        leftControls[index].compareDocumentPosition(leftControls[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }

    fireEvent.click(model);
    expect(rendered.getByRole("textbox", { name: "Search models" })).toBeVisible();
    fireEvent.click(model);

    expect(prompts.querySelector(".lucide-wallet-cards")).not.toBeNull();
    const promptsLabel = rendered.getByText("Prompts");
    expect(promptsLabel).toHaveClass("ai-composer-prompts-value");
    expect(promptsLabel).not.toHaveClass("hidden");
    fireEvent.click(prompts);
    expect(rendered.getByText("Write & edit")).toBeVisible();
    fireEvent.click(prompts);

    fireEvent.click(persona);
    expect(rendered.getByRole("button", { name: "Create a persona in Settings" })).toBeVisible();
    fireEvent.click(persona);

    const approvalLabel = approval.querySelector(".ai-composer-approval-value");
    expect(approvalLabel).toHaveTextContent("Approve for me");
    expect(approvalLabel).not.toHaveClass("hidden");
    fireEvent.click(approval);
    expect(rendered.getByRole("button", { name: "Full access" })).toBeVisible();
    fireEvent.click(approval);

    fireEvent.mouseEnter(prompts.parentElement as HTMLElement);
    expect(await rendered.findByRole("tooltip")).toHaveTextContent("Prompts");
  });

  it("shows the persona label with a dot until a persona is active", async () => {
    mocks.getConfig.mockResolvedValue({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_api_key: "test-key",
      ai_keys: { openai: "test-key" },
      ai_provider_models: {},
      ai_custom_providers: [],
      ai_system_prompt: "",
      ai_personas: [
        {
          id: "starter-research-writer",
          name: "Research Writer",
          color: "ocean",
          prompt: "Write from verified sources.",
        },
      ],
    });
    const rendered = await renderChat();

    const inactiveTrigger = rendered.getByRole("button", { name: "Choose persona" });
    expect(inactiveTrigger).toHaveTextContent("Persona");
    const inactiveValue = inactiveTrigger.querySelector(".ai-composer-persona-value");
    expect(inactiveValue).toHaveTextContent("Persona");
    const inactiveDot = rendered.getByTestId("ai-inactive-persona-indicator");
    expect(inactiveDot).toBeVisible();
    expect(inactiveDot).toHaveClass(
      "rounded-full",
      "border",
      "border-muted-foreground/50",
    );
    expect(inactiveDot).not.toHaveAttribute("style");
    expect(inactiveTrigger.querySelector(".lucide-chevron-down")).not.toBeNull();

    fireEvent.click(inactiveTrigger);
    fireEvent.click(rendered.getByTestId("ai-persona-Research Writer"));

    const activeTrigger = rendered.getByRole("button", {
      name: /Research Writer active/u,
    });
    expect(activeTrigger).toHaveTextContent("Research Writer");
    const activePersonaLabel = activeTrigger.querySelector(".ai-composer-persona-value");
    expect(activePersonaLabel).toHaveTextContent("Research Writer");
    expect(activePersonaLabel).not.toHaveClass("hidden");
    expect(rendered.getByTestId("ai-active-persona-indicator")).toBeVisible();
    expect(activeTrigger.querySelector(".lucide-chevron-down")).not.toBeNull();

    fireEvent.mouseEnter(activeTrigger.parentElement as HTMLElement);
    expect(await rendered.findByRole("tooltip")).toHaveTextContent(
      "Research Writer is active and replaces your default instructions.",
    );
  });

  it("clears the previous checklist when starting a new chat", async () => {
    const rendered = await renderChat();
    submit(rendered, "Finish a planned turn");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await act(async () => finishRun(0, "Done"));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    act(() => {
      useAgentTodoStore.getState().setTodos([
        { id: "old", content: "Old chat step", status: "completed" },
      ]);
    });
    expect(useAgentTodoStore.getState().todos).toHaveLength(1);

    fireEvent.click(rendered.getByRole("button", { name: "New chat" }));
    expect(useAgentTodoStore.getState().todos).toEqual([]);
  });

  it("discards the selected queued follow-up from its chip", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "Keep this queued");
    submit(rendered, "Discard this queued message");

    const discardButtons = rendered.getAllByRole("button", {
      name: "Discard queued message",
    });
    fireEvent.click(discardButtons[1]);

    expect(rendered.getByText("Queued for the next turn: Keep this queued")).toBeTruthy();
    expect(rendered.queryByText("Queued for the next turn: Discard this queued message")).toBeNull();
  });

  it("timestamps the user message at send and the assistant message at finalization", async () => {
    const rendered = await renderChat();
    let now = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      submit(rendered, "Timestamp this turn");
      await waitFor(() => expect(mocks.runs).toHaveLength(1));
      expect(useChatsStore.getState().byId("chat-1")?.messages).toEqual([
        expect.objectContaining({ role: "user", createdAt: 1_000 }),
        expect.objectContaining({ role: "assistant", createdAt: 1_000 }),
      ]);

      now = 2_000;
      await act(async () => finishRun(0, "Timestamped response"));
      await waitFor(() => expect(activeChatRun()).toBeNull());

      expect(useChatsStore.getState().byId("chat-1")?.messages).toEqual([
        expect.objectContaining({ role: "user", createdAt: 1_000 }),
        expect.objectContaining({ role: "assistant", createdAt: 2_000 }),
      ]);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("queues follow-ups while streaming and sends every one with the complete transcript", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "First follow-up");
    submit(rendered, "Second follow-up");

    expect(mocks.runs).toHaveLength(1);
    expect(rendered.getByText("Queued for the next turn: First follow-up")).toBeTruthy();
    expect(rendered.getByText("Queued for the next turn: Second follow-up")).toBeTruthy();

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(rendered.queryByText("Queued for the next turn: First follow-up")).toBeNull();
    expect(rendered.getByText("Queued for the next turn: Second follow-up")).toBeTruthy();
    expect(plainTranscript(mocks.runs[1].options.messages)).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "First follow-up" },
    ]);

    expect(
      useChatsStore.getState().byId("chat-1")?.messages.map(
        (message: ChatMessage) => ({ role: message.role, content: message.content }),
      ),
    ).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "First follow-up" },
      { role: "assistant", content: "" },
    ]);

    await act(async () => finishRun(1, "First follow-up response"));
    await waitFor(() => expect(mocks.runs).toHaveLength(3));
    expect(plainTranscript(mocks.runs[2].options.messages)).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "First follow-up" },
      { role: "assistant", content: "First follow-up response" },
      { role: "user", content: "Second follow-up" },
    ]);

    await act(async () => finishRun(2, "Second follow-up response"));
  });

  it("keeps queued attachment bytes until the follow-up send is accepted", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await attachTextFile(rendered, "queued-a.txt", "attachment A");
    submit(rendered, "Read the queued attachment");
    await attachTextFile(rendered, "composer-b.txt", "attachment B");

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    const followUp = mocks.runs[1].options.messages.at(-1);
    expect(followUp?.content).toEqual([
      { type: "text", text: "Read the queued attachment" },
      expect.objectContaining({ type: "file", name: "queued-a.txt" }),
    ]);
    expect(JSON.stringify(followUp?.content)).not.toContain("composer-b.txt");

    await act(async () => finishRun(1, "Read it"));
  });

  it("keeps a queued follow-up when its budget gate rejects the resend", async () => {
    mocks.checkProjectBudget
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("blocked");
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    submit(rendered, "Keep this queued");

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.checkProjectBudget).toHaveBeenCalledTimes(2));

    expect(mocks.runs).toHaveLength(1);
    expect(rendered.getByText("Queued for the next turn: Keep this queued")).toBeTruthy();
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]).toHaveLength(1);
  });

  it("does not discard a follow-up reserved for auto-send during its budget check", async () => {
    const followUpBudget = deferred<"blocked">();
    mocks.checkProjectBudget
      .mockResolvedValueOnce("ok")
      .mockReturnValueOnce(followUpBudget.promise);
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    submit(rendered, "Reserve this follow-up");

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.checkProjectBudget).toHaveBeenCalledTimes(2));

    const discard = rendered.getByRole("button", {
      name: "Discard queued message",
    }) as HTMLButtonElement;
    expect(discard.disabled).toBe(true);
    fireEvent.click(discard);
    expect(rendered.getByText("Sent as the next turn: Reserve this follow-up")).toBeTruthy();

    await act(async () => followUpBudget.resolve("blocked"));
    await waitFor(() => expect(discard.disabled).toBe(false));
    fireEvent.click(discard);
    expect(rendered.queryByText("Queued for the next turn: Reserve this follow-up")).toBeNull();
  });

  it("keeps a queued follow-up when backend startup fails before acceptance", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await attachTextFile(rendered, "retry.txt", "retry attachment");
    submit(rendered, "Keep this after startup failure");
    mocks.runAgentHarness.mockRejectedValueOnce(new Error("backend startup failed"));

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.runAgentHarness).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]).toEqual([
      expect.objectContaining({
        text: "Keep this after startup failure",
        status: "pending",
        attachments: [expect.objectContaining({ name: "retry.txt" })],
      }),
    ]);
    expect(
      useChatsStore.getState().byId("chat-1")?.messages.map(
        (message: ChatMessage) => ({ role: message.role, content: message.content }),
      ),
    ).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "First response" },
    ]);
    expect(useAgentTurnsStore.getState().recordsByChat["chat-1"]).toHaveLength(1);

    submit(rendered, "Recovery request");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(plainTranscript(mocks.runs[1].options.messages)).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "Recovery request" },
    ]);

    await act(async () => finishRun(1, "Recovery response"));
    await waitFor(() => expect(mocks.runs).toHaveLength(3));
    expect(plainTranscript(mocks.runs[2].options.messages.slice(0, -1))).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "Recovery request" },
      { role: "assistant", content: "Recovery response" },
    ]);
    expect(mocks.runs[2].options.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Keep this after startup failure" },
        expect.objectContaining({ type: "file", name: "retry.txt" }),
      ],
    });

    await act(async () => finishRun(2, "Queued response"));
  });

  it("does not let a stale budget callback replace the new project's active run", async () => {
    const firstBudget = deferred<"ok">();
    const firstProject = useFilesStore.getState().projectId;
    mocks.checkProjectBudget.mockImplementation((projectId: string) =>
      projectId === firstProject ? firstBudget.promise : Promise.resolve("ok"),
    );
    const rendered = await renderChat();
    submit(rendered, "Request in project A");
    await waitFor(() => expect(mocks.checkProjectBudget).toHaveBeenCalledWith(firstProject));

    const secondProject = `${firstProject}-second`;
    act(() => {
      useFilesStore.setState({ projectId: secondProject, projectName: "Second project" });
      useChatsStore.setState({
        projectId: secondProject,
        chats: [
          {
            id: "chat-2",
            projectId: secondProject,
            title: "New chat",
            createdAt: 2,
            updatedAt: 2,
            messages: [],
            headOid: null,
          },
        ],
        activeId: "chat-2",
        live: {},
      });
    });
    submit(rendered, "Request in project B");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await act(async () => firstBudget.resolve("ok"));
    await act(async () => finishRun(0, "Project B response"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
  });

  it("marks only the acknowledged queued steer as delivered", async () => {
    const steerAck = deferred<{ status: string }>();
    mocks.agentSteer.mockReturnValueOnce(steerAck.promise);
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "Use this now");
    submit(rendered, "Use this now");
    const queued = useAgentTurnsStore.getState().queuedByChat["chat-1"];
    const steerButton = rendered.getAllByRole("button", { name: "Steer now" })[1];
    const discardButton = rendered.getAllByRole("button", {
      name: "Discard queued message",
    })[1] as HTMLButtonElement;
    fireEvent.click(steerButton);
    fireEvent.click(steerButton);

    await waitFor(() => {
      expect(mocks.agentSteer).toHaveBeenCalledWith("request-1", {
        role: "user",
        content: [{ type: "text", text: "Use this now" }],
      });
    });
    expect(mocks.agentSteer).toHaveBeenCalledTimes(1);
    expect(discardButton.disabled).toBe(true);
    expect(
      (
        rendered.getAllByRole("button", {
          name: "Discard queued message",
        })[0] as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      rendered.getByText("Waiting for a safe point in the run: Use this now"),
    ).toBeTruthy();
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => item.status)).toEqual([
      "pending",
      "pending",
    ]);

    await act(async () => steerAck.resolve({ status: "delivered" }));
    await waitFor(() => {
      expect(
        useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => ({
          id: item.id,
          status: item.status,
        })),
      ).toEqual([
        { id: queued[0].id, status: "pending" },
        { id: queued[1].id, status: "steered" },
      ]);
    });
    const steeredChip = rendered
      .getByText("Steered into the running turn: Use this now")
      .closest('[data-testid="agent-follow-up-chip"]');
    expect(steeredChip?.querySelector('[data-testid="agent-follow-up-discard"]')).toBeNull();

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    await act(async () => finishRun(1, "Follow-up response"));
  });

  it("steers queued attachments through the same backend message conversion", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await attachTextFile(rendered, "steer.txt", "steered attachment");
    submit(rendered, "Use the attachment now");
    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));

    await waitFor(() => {
      expect(mocks.agentSteer).toHaveBeenCalledWith("request-1", {
        role: "user",
        content: [
          { type: "text", text: "Use the attachment now" },
          { type: "text", text: 'Attached file "steer.txt":\n\nsteered attachment' },
        ],
      });
    });

    act(() =>
      mocks.runs[0].options.onRawEvent?.({ kind: "steered", text: "Use the attachment now" }),
    );
    await act(async () => finishRun(0, "First response"));
  });

  it("records a delivered steer as its own user turn and reopens the assistant reply", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    act(() => mocks.runs[0].options.handlers.onText("Working on it."));

    submit(rendered, "Use this direction now");
    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));
    await waitFor(() =>
      expect(rendered.getByText("Steered into the running turn: Use this direction now")),
    );

    await act(async () => {
      mocks.runs[0].options.handlers.onSteered?.("Use this direction now");
    });
    act(() => mocks.runs[0].options.handlers.onText("Following the new direction."));
    await act(async () => finishRun(0, ""));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    const stored = useChatsStore.getState().byId("chat-1")?.messages ?? [];
    expect(
      stored.map((message: ChatMessage) => ({
        role: message.role,
        content: message.content,
        steered: message.steered ?? false,
      })),
    ).toEqual([
      { role: "user", content: "First request", steered: false },
      { role: "assistant", content: "Working on it.", steered: false },
      { role: "user", content: "Use this direction now", steered: true },
      { role: "assistant", content: "Following the new direction.", steered: false },
    ]);
    submit(rendered, "Second request");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(plainTranscript(mocks.runs[1].options.messages)).toEqual([
      { role: "user", content: "First request" },
      { role: "assistant", content: "Working on it." },
      { role: "user", content: "Use this direction now" },
      { role: "assistant", content: "Following the new direction." },
      { role: "user", content: "Second request" },
    ]);
    await act(async () => finishRun(1, "Second response"));
  });

  it("leaves a steer the run could not take queued for the next turn", async () => {
    mocks.agentSteer.mockResolvedValueOnce({ status: "run_finished" });
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "Apply this instead");
    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));

    await waitFor(() => expect(mocks.agentSteer).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(rendered.getByText("Queued for the next turn: Apply this instead")),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(
      useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => item.status),
    ).toEqual(["pending"]);

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(plainTranscript(mocks.runs[1].options.messages).at(-1)).toEqual({
      role: "user",
      content: "Apply this instead",
    });
    await act(async () => finishRun(1, "Second response"));
  });

  it("stops offering discard once the steer request is in flight", async () => {
    const steerAck = deferred<{ status: string }>();
    mocks.agentSteer.mockReturnValueOnce(steerAck.promise);
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "Drop this while it waits");
    const discard = rendered.getByRole("button", {
      name: "Discard queued message",
    }) as HTMLButtonElement;
    expect(discard.disabled).toBe(false);

    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));
    await waitFor(() =>
      expect(
        rendered.getByText("Waiting for a safe point in the run: Drop this while it waits"),
      ),
    );

    expect(discard.disabled).toBe(true);
    fireEvent.click(discard);
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"]).toHaveLength(1);

    await act(async () => steerAck.resolve({ status: "delivered" }));
    await waitFor(() =>
      expect(
        rendered.getByText("Steered into the running turn: Drop this while it waits"),
      ),
    );

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(mocks.runs).toHaveLength(1);
  });

  it("steers a queued skill command as the resolved skill directive", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "proof-review",
        name: "Proof Review",
        description: "Review a proof carefully.",
        instructions: "Check every inference.",
        enabled: true,
      }),
    );
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "/proof-review check table 2");
    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));

    await waitFor(() => expect(mocks.agentSteer).toHaveBeenCalledTimes(1));
    expect(mocks.agentSteer).toHaveBeenCalledWith("request-1", {
      role: "user",
      content: [
        {
          type: "text",
          text: 'Use the skill "Proof Review" (proof-review) for this request.\ncheck table 2',
        },
      ],
    });

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
  });

  it("carries the instructions of a skill the run cannot load into the steer", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "proof-review",
        name: "Proof Review",
        description: "Review a proof carefully.",
        instructions: "Check every inference.",
        enabled: false,
      }),
    );
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "/proof-review check table 2");
    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));

    await waitFor(() => expect(mocks.agentSteer).toHaveBeenCalledTimes(1));
    const steered = mocks.agentSteer.mock.calls[0][1] as {
      content: Array<{ text: string }>;
    };
    expect(steered.content[0].text).toContain(
      'Use the skill "Proof Review" (proof-review) for this request.',
    );
    expect(steered.content[0].text).toContain("<requested_skill");
    expect(steered.content[0].text).toContain("Check every inference.");
    expect(steered.content[0].text).toContain("check table 2");

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
  });

  it("waits for the run id before the steer button is usable", async () => {
    mocks.runAgentHarness.mockImplementationOnce(
      (options: HarnessOptions) =>
        new Promise((resolve) => {
          mocks.runs.push({ options, resolve });
        }),
    );
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "Steer once the run starts");
    const steerButton = rendered.getByRole("button", {
      name: "Steer now",
    }) as HTMLButtonElement;
    expect(steerButton.disabled).toBe(true);
    expect(steerButton.title).toBe("Starting the run");
    fireEvent.click(steerButton);
    expect(mocks.agentSteer).not.toHaveBeenCalled();

    act(() => mocks.runs[0].options.onRequestId?.("request-1"));
    await waitFor(() => expect(steerButton.disabled).toBe(false));
    expect(steerButton.title).toBe("");

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    await act(async () => finishRun(1, "Second response"));
  });

  it("drops delivered steers but keeps queued messages when a run fails", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "Steer this one");
    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));
    await waitFor(() =>
      expect(rendered.getByText("Steered into the running turn: Steer this one")),
    );
    submit(rendered, "Keep this one queued");

    await act(async () => {
      mocks.runs[0].options.handlers.onSteered?.("Steer this one");
      mocks.runs[0].resolve({
        text: "",
        usage: { input: 0, output: 0 },
        steps: 1,
        stopped_at_cap: false,
        error: "the provider failed",
      });
    });
    await waitFor(() => expect(activeChatRun()).toBeNull());

    expect(
      useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => ({
        text: item.text,
        status: item.status,
      })),
    ).toEqual([{ text: "Keep this one queued", status: "pending" }]);
    expect(mocks.runs).toHaveLength(1);
  });

  it("publishes no more than one capped text batch per animation frame", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1;
      callbacks.set(nextFrame, callback);
      return nextFrame;
    });
    const cancelFrame = vi.fn((handle: number) => {
      callbacks.delete(handle);
    });
    const originalRequestFrame = globalThis.requestAnimationFrame;
    const originalCancelFrame = globalThis.cancelAnimationFrame;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperties(globalThis, {
      requestAnimationFrame: { configurable: true, value: requestFrame },
      cancelAnimationFrame: { configurable: true, value: cancelFrame },
    });
    Object.defineProperties(window, {
      requestAnimationFrame: { configurable: true, value: requestFrame },
      cancelAnimationFrame: { configurable: true, value: cancelFrame },
    });

    try {
      const rendered = await renderChat();
      submit(rendered, "Stream a burst");
      await waitFor(() => expect(mocks.runs).toHaveLength(1));

      act(() => {
        for (let index = 0; index < 600; index += 1) {
          mocks.runs[0].options.handlers.onText("x");
        }
      });

      expect(requestFrame).toHaveBeenCalledTimes(1);
      expect(callbacks).toHaveLength(1);
      const first = callbacks.entries().next().value as [number, FrameRequestCallback];
      callbacks.delete(first[0]);
      act(() => first[1](0));
      expect(requestFrame).toHaveBeenCalledTimes(2);
      expect(callbacks).toHaveLength(1);
      expect(useChatsStore.getState().live["chat-1"].at(-1)?.content).toHaveLength(512);

      const second = callbacks.entries().next().value as [number, FrameRequestCallback];
      callbacks.delete(second[0]);
      act(() => second[1](16));
      expect(callbacks).toHaveLength(0);
      expect(useChatsStore.getState().live["chat-1"].at(-1)?.content).toHaveLength(600);

      await act(async () => {
        mocks.runs[0].resolve({
          text: "x".repeat(600),
          usage: { input: 0, output: 0 },
          steps: 1,
          stopped_at_cap: false,
          error: null,
        });
      });
      await waitFor(() => expect(activeChatRun()).toBeNull());
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
      Object.defineProperties(globalThis, {
        requestAnimationFrame: { configurable: true, value: originalRequestFrame },
        cancelAnimationFrame: { configurable: true, value: originalCancelFrame },
      });
      Object.defineProperties(window, {
        requestAnimationFrame: { configurable: true, value: originalRequestFrame },
        cancelAnimationFrame: { configurable: true, value: originalCancelFrame },
      });
    }
  });

  it.each(["ask-for-approval", "approve-for-me"] as const)(
    "prompts for a risky tool in %s mode",
    async (mode) => {
      const { rendered, result } = await beginApprovalCall(mode);

      await waitFor(() =>
        expect(rendered.getByRole("alertdialog", { name: "Confirm AI edit" })).toBeTruthy(),
      );
      fireEvent.click(rendered.getByRole("button", { name: "Reject" }));
      await expect(result).resolves.toEqual({ approved: false });
      await act(async () => finishRun(0, "Not changed"));
    },
  );

  it("auto-approves a risky tool without ToolConfirm in Full access", async () => {
    const { rendered, result } = await beginApprovalCall("full-access");

    await expect(result).resolves.toEqual({ approved: true });
    expect(rendered.queryByRole("alertdialog", { name: "Confirm AI edit" })).toBeNull();
    await act(async () => finishRun(0, "Updated"));
  });

  it("uses an explicit Custom allow without ToolConfirm", async () => {
    const { rendered, result } = await beginApprovalCall("custom", "write_file", {
      write_file: "allow",
    });

    await expect(result).resolves.toEqual({ approved: true });
    expect(rendered.queryByRole("alertdialog", { name: "Confirm AI edit" })).toBeNull();
    await act(async () => finishRun(0, "Updated"));
  });

  it("denies an explicit Custom rule without ToolConfirm", async () => {
    const { rendered, result } = await beginApprovalCall("custom", "write_file", {
      write_file: "deny",
    });

    await expect(result).resolves.toEqual({ approved: false });
    expect(rendered.queryByRole("alertdialog", { name: "Confirm AI edit" })).toBeNull();
    await act(async () => finishRun(0, "Denied"));
  });

  it("prompts for a risky Custom tool without a saved rule", async () => {
    const { rendered, result } = await beginApprovalCall("custom");

    await waitFor(() =>
      expect(rendered.getByRole("alertdialog", { name: "Confirm AI edit" })).toBeTruthy(),
    );
    fireEvent.click(rendered.getByRole("button", { name: "Reject" }));
    await expect(result).resolves.toEqual({ approved: false });
    await act(async () => finishRun(0, "Not changed"));
  });

  it("aborts a Custom run when project approval rules cannot be loaded", async () => {
    mocks.approvalsModeGet.mockResolvedValue("custom");
    mocks.approvalsList.mockRejectedValue(new Error("unreadable approvals"));
    const rendered = await renderChat();

    submit(rendered, "Search the literature");

    await waitFor(() => expect(mocks.approvalsList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(mocks.runAgentHarness).not.toHaveBeenCalled();
    expect(
      rendered.getByRole("button", { name: "Approval mode. Custom (approvals.toml)" }),
    ).not.toBeDisabled();
  });

  it("prompts before internet access in Ask for approval", async () => {
    const { rendered, result } = await beginApprovalCall(
      "ask-for-approval",
      "literature_search",
    );

    await waitFor(() =>
      expect(rendered.getByRole("alertdialog", { name: "Confirm internet access" })).toBeTruthy(),
    );
    fireEvent.click(rendered.getByRole("button", { name: "Reject" }));
    await expect(result).resolves.toEqual({ approved: false });
    await act(async () => finishRun(0, "Not searched"));
  });

  it.each([
    [
      "ask-for-approval",
      "Approval posture: Ask for approval before external file changes, internet access, or shell commands.",
    ],
    [
      "approve-for-me",
      "Approval posture: Safe and read-only actions may run automatically. Ask for approval before risky actions.",
    ],
    ["full-access", "Approval posture: Tool actions may run without asking for approval."],
    [
      "custom",
      "Approval posture: Project approval rules apply. Actions without a matching rule follow the standard risk policy.",
    ],
  ] as const)("assembles the %s posture into the system prompt", async (mode, posture) => {
    mocks.approvalsModeGet.mockResolvedValue(mode);
    const rendered = await renderChat();
    submit(rendered, "Check the prompt");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.system).toContain(posture);
    await act(async () => finishRun(0, "Ready"));
  });

  it("excludes disabled project and MCP tools from the model schemas and prompt inventory", async () => {
    useAiToolSettingsStore.setState({
      enabledByName: {
        write_file: false,
        mcp__papers__search_papers: false,
      },
    });
    const rendered = await renderChat();

    submit(rendered, "Check enabled tools");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.tools).not.toHaveProperty("write_file");
    expect(mocks.runs[0].options.tools).not.toHaveProperty(
      "mcp__papers__search_papers",
    );
    expect(mocks.runs[0].options.tools).toHaveProperty("run_command");
    const inventoryLine = mocks.runs[0].options.system
      .split("\n")
      .find((line) => line.startsWith("Available tools for this run"));
    expect(inventoryLine).not.toContain("write_file");
    expect(inventoryLine).not.toContain("mcp__papers__search_papers");
    expect(inventoryLine).toContain("run_command");

    await act(async () => finishRun(0, "Ready"));
  });

  it("uses the refreshed MCP catalog for the run being sent", async () => {
    const rendered = await renderChat();
    await waitFor(() =>
      expect(chatQueryClient.getQueryData(["mcp-agent-tools"])).toBeDefined(),
    );
    mocks.mcpAgentToolsList.mockResolvedValue([
      {
        name: "Papers",
        tools: [
          {
            name: "mcp__papers__find_current",
            tool_handle: "find_current",
            description: "Search the current papers catalog.",
            input_schema: { type: "object" },
          },
        ],
      },
    ]);

    submit(rendered, "Use the current catalog");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.tools).toHaveProperty("mcp__papers__find_current");
    expect(mocks.runs[0].options.tools).not.toHaveProperty(
      "mcp__papers__search_papers",
    );
    expect(mocks.runs[0].options.system).toContain("mcp__papers__find_current");
    expect(mocks.runs[0].options.system).not.toContain(
      "mcp__papers__search_papers",
    );

    await act(async () => finishRun(0, "Ready"));
  });

  it("keeps project B tool images when project A settles late", async () => {
    mocks.approvalsModeGet.mockResolvedValue("full-access");
    const rendered = await renderChat();
    submit(rendered, "Start project A");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    const secondProject = `${useFilesStore.getState().projectId}-second`;
    act(() => {
      useFilesStore.setState({
        projectId: secondProject,
        projectName: "Second project",
      });
      useChatsStore.setState({
        projectId: secondProject,
        chats: [
          {
            id: "chat-2",
            projectId: secondProject,
            title: "New chat",
            createdAt: 2,
            updatedAt: 2,
            messages: [],
            headOid: null,
          },
        ],
        activeId: "chat-2",
        live: {},
      });
    });

    submit(rendered, "Start project B");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    mocks.mcpAgentToolCall.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Chart ready" },
        { type: "image", mimeType: "image/png", data: "UFJPSkVDVC1C" },
      ],
    });
    await mocks.runs[1].options.tools.mcp__papers__search_papers.execute?.({
      query: "project B chart",
    });
    expect(mocks.mcpAgentToolAuthorize).toHaveBeenCalledWith(
      secondProject,
      "Papers",
      "search_papers",
      { query: "project B chart" },
      "request-2",
    );
    expect(mocks.mcpAgentToolCall).toHaveBeenCalledWith(
      secondProject,
      "Papers",
      "search_papers",
      { query: "project B chart" },
      "request-2",
      "approval-1",
    );

    await act(async () => finishRun(0, "Late project A response"));
    expect(mocks.runs[1].options.takePendingImages()).toEqual([
      "data:image/png;base64,UFJPSkVDVC1C",
    ]);

    await act(async () => finishRun(1, "Project B response"));
  });

  it("blocks a send when enabled tools exceed the agent schema limit", async () => {
    const rendered = await renderChat();
    await waitFor(() =>
      expect(chatQueryClient.getQueryData(["mcp-agent-tools"])).toBeDefined(),
    );
    mocks.mcpAgentToolsList.mockResolvedValue([
      {
        name: "Large catalog",
        tools: Array.from({ length: 124 }, (_, index) => ({
          name: `mcp__large__tool_${index}`,
          tool_handle: `tool_${index}`,
          description: `Tool ${index}`,
          input_schema: { type: "object" },
        })),
      },
    ]);

    submit(rendered, "Do not silently truncate tools");

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "129 tools are enabled, but a run supports up to 128. Disable at least 1 in Tools and try again.",
      ),
    );
    expect(mocks.runs).toHaveLength(0);
    expect(activeChatRun()).toBeNull();
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toHaveValue(
      "Do not silently truncate tools",
    );
  });

  it("uses an explicit empty inventory when every available tool is disabled", async () => {
    useAiToolSettingsStore.setState({
      enabledByName: {
        read_file: false,
        update_todos: false,
        write_file: false,
        run_command: false,
        literature_search: false,
        mcp__papers__search_papers: false,
      },
    });
    const rendered = await renderChat();

    submit(rendered, "Answer without tools");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.tools).toEqual({});
    expect(mocks.runs[0].options.system).toContain(
      "Available tools for this run: none.",
    );

    await act(async () => finishRun(0, "Ready"));
  });

  it("does not advertise enabled skills when load_skill is disabled", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "proof-review",
        name: "Proof Review",
        description: "Review a proof carefully.",
        instructions: "Check every inference.",
        enabled: true,
      }),
    );
    useAiToolSettingsStore.setState({ enabledByName: { load_skill: false } });
    const rendered = await renderChat();

    submit(rendered, "Review this proof");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.tools).not.toHaveProperty("load_skill");
    expect(mocks.runs[0].options.system).not.toContain("<enabled_skills>");
    expect(mocks.runs[0].options.system).not.toContain("load_skill");

    await act(async () => finishRun(0, "Ready"));
  });

  it("injects enabled OpenResearch metadata and loads its full instructions on demand", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "openresearch",
        name: "OpenResearch (orx)",
        description:
          "Ground research in literature and run or inspect experiments with the local orx CLI.",
        instructions:
          "Before using it, check whether `orx` is available on PATH. Run `orx --help` for the full interface.",
        source: "bundled",
        tier: "native",
        phase: "research",
        enabled: true,
        removable: false,
      }),
      skillEntry({
        id: "citation-audit",
        name: "Citation Audit",
        description: "Check every citation.",
        instructions: "Inspect every bibliography entry.",
      }),
      skillEntry({
        id: "broken",
        name: "Broken Skill",
        description: "This skill is invalid.",
        instructions: "Do not load this.",
        validation: {
          status: "invalid",
          code: "missing-description",
          message: "Missing description.",
        },
      }),
    );
    const rendered = await renderChat();

    submit(rendered, "Review the prompt");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.system).toContain("OpenResearch (orx)");
    expect(mocks.runs[0].options.system).toContain(
      "Ground research in literature and run or inspect experiments with the local orx CLI.",
    );
    expect(mocks.runs[0].options.system).not.toContain("Run `orx --help` for the full interface.");
    expect(mocks.runs[0].options.system).not.toContain("Citation Audit");
    expect(mocks.runs[0].options.system).not.toContain("Broken Skill");
    await expect(
      mocks.runs[0].options.tools.load_skill.execute?.({ id: "openresearch" }),
    ).resolves.toContain("Run `orx --help` for the full interface.");
    await act(async () => finishRun(0, "Ready"));
  });

  it("groups the skill catalog by phase and states the workflow rules", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "oleafly-research-loop",
        name: "Research loop",
        description: "Entry point for research writing in Oleafly.",
        instructions: "Plan the work, then hand off.",
        phase: "research",
        tier: "native",
        source: "bundled",
        enabled: true,
      }),
      skillEntry({
        id: "scientific-writing",
        name: "Scientific writing",
        description: "Draft a section that reads like a paper.",
        phase: "authoring",
        tier: "vendored",
        source: "bundled",
        enabled: true,
      }),
    );
    const rendered = await renderChat();

    submit(rendered, "Help me start this paper");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    const system = mocks.runs[0].options.system;
    expect(system).toContain("Research workflow map");
    expect(system.indexOf("## research")).toBeLessThan(system.indexOf("## authoring"));
    expect(system).toContain(
      'call load_skill with "oleafly-research-loop" first and follow the handoffs it names',
    );
    expect(mocks.runs[0].options.tools).toHaveProperty("read_skill_file");
    await act(async () => finishRun(0, "Ready"));
  });

  it("states the research rules for a document project and not for an image project", async () => {
    const rendered = await renderChat();

    submit(rendered, "Draft the introduction");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    const system = mocks.runs[0].options.system;
    expect(system).toContain("Never invent a reference");
    expect(system).toContain("Every \\cite key must resolve to an entry in the project bibliography");
    expect(system).toContain("research/sources/");
    expect(system).toContain("Compile after each section you write");
    await act(async () => finishRun(0, "Ready"));

    act(() => {
      useFilesStore.setState({ projectKind: "image" });
    });
    submit(rendered, "Add an arrow");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));

    expect(mocks.runs[1].options.system).not.toContain("Never invent a reference");
    await act(async () => finishRun(1, "Ready"));
  });

  it("loads a slash-requested skill that is not enabled and directs the turn to it", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "citation-audit",
        name: "Citation Audit",
        description: "Check every citation.",
        instructions: "Inspect every bibliography entry.",
      }),
    );
    const rendered = await renderChat();

    submit(rendered, "/citation-audit check section 3");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    const run = mocks.runs[0].options;
    expect(run.system).toContain('<requested_skill id="citation-audit" name="Citation Audit">');
    expect(run.system).toContain("Inspect every bibliography entry.");
    const last = run.messages[run.messages.length - 1];
    expect(last.content).toBe(
      'Use the skill "Citation Audit" (citation-audit) for this request.\ncheck section 3',
    );
    expect(last.content).not.toContain("/citation-audit");
    await expect(
      run.tools.load_skill.execute?.({ id: "citation-audit" }),
    ).resolves.toContain("Inspect every bibliography entry.");
    await act(async () => finishRun(0, "Ready"));
  });

  it("offers skill-backed suggestions and runs the skill when one is clicked", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "oleafly-literature-sweep",
        name: "Oleafly Literature Sweep",
        description: "Build a reading list.",
        instructions: "Search the literature and write research/reading-list.md.",
      }),
    );
    const rendered = await renderChat();

    const chips = rendered.getAllByTestId("chat-suggestion").map((chip) => chip.textContent);
    expect(chips).toContain("Sweep the literature for this project");
    expect(chips).toContain("Recompile and check for errors");
    expect(chips).not.toContain("Draft the related work section");

    fireEvent.click(rendered.getByTitle("Sweep the literature for this project"));
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    const run = mocks.runs[0].options;
    expect(run.system).toContain(
      '<requested_skill id="oleafly-literature-sweep" name="Oleafly Literature Sweep">',
    );
    const last = run.messages[run.messages.length - 1];
    expect(last.content).toBe(
      'Use the skill "Oleafly Literature Sweep" (oleafly-literature-sweep) for this request.\nBuild an annotated reading list for this project\'s research question',
    );
    expect(last.content).not.toContain("/oleafly-literature-sweep");
    await act(async () => finishRun(0, "Ready"));
  });

  it("sends an unknown slash word as plain text", async () => {
    const rendered = await renderChat();

    submit(rendered, "/summarise the results");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    const run = mocks.runs[0].options;
    expect(run.messages[run.messages.length - 1].content).toBe("/summarise the results");
    expect(run.system).not.toContain("<requested_skill");
    await act(async () => finishRun(0, "Ready"));
  });

  it("gives a chat-only model the requested skill in the system prompt", async () => {
    mocks.getConfig.mockResolvedValue({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_api_key: "test-key",
      ai_keys: { openai: "test-key" },
      ai_provider_models: {
        openai: [
          {
            id: "gpt-4o",
            name: "GPT-4o",
            enabled: true,
            source: "fetched",
            trust: "trusted",
            metadata: {
              name: "GPT-4o",
              inputModalities: ["text"],
              outputModalities: ["text"],
              toolCall: false,
              reasoning: false,
              attachment: false,
              structuredOutput: false,
              status: "active",
            },
          },
        ],
      },
      ai_model_probes: {},
      ai_custom_providers: [],
      ai_system_prompt: "",
      ai_personas: [],
    });
    mocks.skillEntries.push(
      skillEntry({
        id: "citation-audit",
        name: "Citation Audit",
        description: "Check every citation.",
        instructions: "Inspect every bibliography entry.",
      }),
    );
    const rendered = await renderChat();

    submit(rendered, "/citation-audit look at the bibliography");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.tools).toEqual({});
    expect(mocks.runs[0].options.system).toContain('<requested_skill id="citation-audit"');
    expect(mocks.runs[0].options.system).toContain("Inspect every bibliography entry.");
    await act(async () => finishRun(0, "Ready"));
  });

  it("inserts a skill token from the slash menu instead of clearing the composer", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "paper-lookup",
        name: "Paper Lookup",
        description: "Search literature APIs.",
        enabled: true,
      }),
    );
    const rendered = await renderChat();

    changeComposer("/paper-look");
    await waitFor(() =>
      expect(rendered.getByRole("option", { name: /Paper Lookup/ })).toBeTruthy(),
    );
    fireEvent.click(rendered.getByRole("option", { name: /Paper Lookup/ }));

    await waitFor(() =>
      expect(
        rendered.getByPlaceholderText("Ask AI to help with your document…"),
      ).toHaveValue("/paper-lookup "),
    );
    expect(rendered.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
  });

  it("waits for the initial skills query before assembling a run", async () => {
    const skill = skillEntry({
      id: "proof-review",
      name: "Proof Review",
      description: "Review a proof for logical gaps.",
      instructions: "Read each claim and verify its dependencies.",
      enabled: true,
    });
    mocks.skillEntries.push(skill);
    mocks.skillsLoaded = false;
    const pending = deferred<{ data: Array<Record<string, unknown>>; error: null }>();
    mocks.refetchSkills.mockReturnValue(pending.promise);
    const rendered = await renderChat();

    submit(rendered, "Review the prompt immediately");

    await waitFor(() => expect(mocks.refetchSkills).toHaveBeenCalledOnce());
    expect(mocks.runs).toHaveLength(0);
    await act(async () => pending.resolve({ data: [skill], error: null }));
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.system).toContain("Proof Review");
    await act(async () => finishRun(0, "Ready"));
  });

  it("admits only one rapid send while the initial skills query is pending", async () => {
    mocks.skillsLoaded = false;
    const pending = deferred<{ data: Array<Record<string, unknown>>; error: null }>();
    mocks.refetchSkills.mockReturnValue(pending.promise);
    const rendered = await renderChat();
    const approvalsBefore = mocks.approvalsModeGet.mock.calls.length;

    submit(rendered, "First immediate request");
    submit(rendered, "Second immediate request");
    await waitFor(() => expect(mocks.refetchSkills).toHaveBeenCalledTimes(1));
    await act(async () => pending.resolve({ data: [], error: null }));

    await waitFor(() =>
      expect(mocks.approvalsModeGet).toHaveBeenCalledTimes(approvalsBefore + 1),
    );
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toHaveValue(
      "Second immediate request",
    );
    await act(async () => finishRun(0, "Ready"));
  });

  it("abandons a pending cold-start send after the project changes", async () => {
    mocks.skillsLoaded = false;
    const pending = deferred<{ data: Array<Record<string, unknown>>; error: null }>();
    mocks.refetchSkills.mockReturnValue(pending.promise);
    const rendered = await renderChat();

    submit(rendered, "Request for the original project");
    await waitFor(() => expect(mocks.refetchSkills).toHaveBeenCalledOnce());
    act(() => {
      useFilesStore.setState({ projectId: "project-next", projectName: "Next project" });
    });
    await waitFor(() =>
      expect(mocks.approvalsModeGet).toHaveBeenCalledWith("project-next"),
    );
    mocks.approvalsModeGet.mockClear();
    await act(async () => pending.resolve({ data: [], error: null }));

    expect(mocks.approvalsModeGet).not.toHaveBeenCalled();
    expect(mocks.runs).toHaveLength(0);
    expect(activeChatRun()).toBeNull();
  });

  it("tells the planning model to plan tool work instead of refusing it", () => {
    expect(PLAN_MODE_PLANNING_PROMPT).toContain("do not say you lack access to tools");
    expect(PLAN_MODE_PLANNING_PROMPT).toContain("the approved plan runs with the full toolset");
    expect(PLAN_MODE_PLANNING_PROMPT).toContain("turn Plan off for direct tool access");
    expect(PLAN_MODE_HINT).toBe(
      "Plan mode: the assistant proposes a plan before editing. Turn Plan off to give the assistant direct access to all tools.",
    );
  });

  it("adds the planning prompt and info icon only after Plan mode is turned on", async () => {
    const rendered = await renderChat();
    const toggle = rendered.getByRole("button", { name: "Plan mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(rendered.queryByTestId("ai-plan-mode-info")).toBeNull();

    submit(rendered, "Run without planning posture");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.system).not.toContain("Plan mode:");
    expect(mocks.runs[0].options.tools).toHaveProperty("write_file");
    await act(async () => finishRun(0, "Done"));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("data-state", "on");
    expect(toggle).toHaveClass("bg-violet-500/15", "text-violet-600");
    expect(toggle.className).not.toContain("amber-");
    const info = rendered.getByTestId("ai-plan-mode-info");
    expect(info).toHaveAccessibleName("About plan mode");
    expect(info).not.toHaveAttribute("aria-describedby");
    expect(info.querySelector("svg")).toHaveClass("size-3.5");
    expect(toggle.parentElement?.nextElementSibling).toContainElement(info);
    fireEvent.mouseEnter(info.parentElement as HTMLElement);
    expect(await rendered.findByRole("tooltip")).toHaveTextContent(PLAN_MODE_HINT);
    expect(info).toHaveAccessibleDescription(PLAN_MODE_HINT);
    submit(rendered, "Run with planning posture");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.system).toContain(PLAN_MODE_PLANNING_PROMPT);
    expect(mocks.runs[1].options.system).not.toContain(PLAN_MODE_REVISION_LINE);
    await act(async () => finishRun(1, "Planned"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("planning");
    expect(rendered.queryByRole("button", { name: "Approve plan" })).toBeNull();
  });

  const PLAN_TODOS = [
    { id: "intro", content: "Rename the intro section in main.tex", status: "pending" as const },
    { id: "abstract", content: "Tighten the abstract in main.tex", status: "pending" as const },
  ];

  async function planFirstTurn(rendered: RenderResult, text: string) {
    fireEvent.click(rendered.getByRole("button", { name: "Plan mode" }));
    submit(rendered, text);
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    return mocks.runs[0].options;
  }

  it("plans with read-only tools, waits for approval, then executes with write tools and the approved plan", async () => {
    const rendered = await renderChat();
    const planning = await planFirstTurn(rendered, "Rename the intro and tighten the abstract");

    expect(Object.keys(planning.tools).sort()).toEqual([
      "literature_search",
      "read_file",
      "update_todos",
    ]);
    for (const name of ["write_file", "run_command", "mcp__papers__search_papers"]) {
      expect(planning.tools).not.toHaveProperty(name);
    }
    const inventoryLine = planning.system
      .split("\n")
      .find((line) => line.startsWith("Available tools for this run"));
    expect(inventoryLine).toContain("read_file");
    expect(inventoryLine).not.toContain("write_file");
    expect(planning.system).toContain(PLAN_MODE_PLANNING_PROMPT);
    expect(planning.guardToolCall?.({ id: "c1", name: "write_file", args: {} })).toBe(
      "Plan mode: this tool runs only after the plan is approved. Add the step to the plan with update_todos instead of calling it now.",
    );
    expect(planning.guardToolCall?.({ id: "c2", name: "run_command", args: {} })).toBe(
      "Plan mode: this tool runs only after the plan is approved. Add the step to the plan with update_todos instead of calling it now.",
    );
    expect(planning.guardToolCall?.({ id: "c3", name: "read_file", args: {} })).toBeNull();
    expect(planning.guardToolCall?.({ id: "c4", name: "update_todos", args: {} })).toBeNull();

    act(() => useAgentTodoStore.getState().setTodos(PLAN_TODOS));
    await act(async () => finishRun(0, "Here is the plan."));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("awaiting");
    await waitFor(() =>
      expect(mocks.planProps.at(-1)?.approval).toMatchObject({ status: "awaiting", busy: false }),
    );
    expect(rendered.getByPlaceholderText("Describe what to change in the plan")).toBeTruthy();
    expect(rendered.getByRole("button", { name: "Revise" })).not.toBeDisabled();

    fireEvent.click(rendered.getByRole("button", { name: "Approve plan" }));
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    const execution = mocks.runs[1].options;
    for (const name of [
      "read_file",
      "update_todos",
      "write_file",
      "run_command",
      "literature_search",
      "mcp__papers__search_papers",
    ]) {
      expect(execution.tools).toHaveProperty(name);
    }
    expect(execution.system).toContain(
      "Plan mode: the user approved this plan:\n1. Rename the intro section in main.tex\n2. Tighten the abstract in main.tex",
    );
    expect(execution.system).not.toContain(PLAN_MODE_PLANNING_PROMPT);
    expect(execution.guardToolCall?.({ id: "c5", name: "write_file", args: {} })).toBeNull();
    expect(JSON.stringify(execution.messages.at(-1))).toContain("Carry out the approved plan.");
    expect(useAgentTodoStore.getState().todos).toEqual(PLAN_TODOS);
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("approved");
    await waitFor(() =>
      expect(mocks.planProps.at(-1)?.approval).toMatchObject({ status: "approved" }),
    );
    expect(rendered.queryByRole("button", { name: "Approve plan" })).toBeNull();

    act(() =>
      useAgentTodoStore
        .getState()
        .setTodos(PLAN_TODOS.map((todo) => ({ ...todo, status: "completed" as const }))),
    );
    await act(async () => finishRun(1, "All done."));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("planning");
    expect(useAgentTodoStore.getState().todos.every((todo) => todo.status === "completed")).toBe(
      true,
    );
    expect(rendered.getByRole("button", { name: "Plan mode" })).toHaveAttribute("data-state", "on");
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toBeTruthy();
    expect(rendered.queryByTestId("agent-status-pill")).toBeNull();
    await waitFor(() =>
      expect(rendered.getByTestId("agent-run-summary")).toHaveAttribute("data-plan", "true"),
    );
    expect(mocks.runSummaryProps.at(-1)).toMatchObject({ plan: true, turn: { chatId: "chat-1" } });
    expect(rendered.getByTestId("agent-run-summary").closest('[data-message-role="assistant"]'))
      .not.toBeNull();
  });

  it("sends typed feedback as a revision turn that keeps tools gated and the plan awaiting", async () => {
    const rendered = await renderChat();
    await planFirstTurn(rendered, "Plan a two-step edit");
    act(() => useAgentTodoStore.getState().setTodos(PLAN_TODOS));
    await act(async () => finishRun(0, "Here is the plan."));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    await waitFor(() => expect(rendered.getByRole("button", { name: "Revise" })).toBeTruthy());

    fireEvent.click(rendered.getByRole("button", { name: "Revise" }));
    await waitFor(() => expect(document.activeElement).toBe(rendered.getByPlaceholderText("Describe what to change in the plan")));

    changeComposer("Skip the abstract");
    pressComposerKey("Enter");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    const revision = mocks.runs[1].options;
    expect(Object.keys(revision.tools).sort()).toEqual([
      "literature_search",
      "read_file",
      "update_todos",
    ]);
    expect(revision.system).toContain(PLAN_MODE_PLANNING_PROMPT);
    expect(revision.system).toContain(PLAN_MODE_REVISION_LINE);
    expect(revision.guardToolCall?.({ id: "c1", name: "write_file", args: {} })).toBe(
      "Plan mode: this tool runs only after the plan is approved. Add the step to the plan with update_todos instead of calling it now.",
    );
    expect(useAgentTodoStore.getState().todos).toEqual(PLAN_TODOS);
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("awaiting");
    expect(rendered.getByRole("button", { name: "Approve plan" })).toBeDisabled();

    act(() => useAgentTodoStore.getState().setTodos([PLAN_TODOS[0]]));
    await act(async () => finishRun(1, "Updated the plan."));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("awaiting");
    expect(useAgentTodoStore.getState().todos).toEqual([PLAN_TODOS[0]]);
    await waitFor(() => expect(rendered.getByRole("button", { name: "Approve plan" })).not.toBeDisabled());
  });

  it("leaves a stopped planning turn awaiting approval only when it produced a plan", async () => {
    const rendered = await renderChat();
    await planFirstTurn(rendered, "Plan something");
    fireEvent.click(rendered.getByRole("button", { name: "Stop" }));
    await act(async () => finishRun(0, ""));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("planning");
    expect(rendered.queryByRole("button", { name: "Approve plan" })).toBeNull();

    submit(rendered, "Plan again");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    act(() => useAgentTodoStore.getState().setTodos(PLAN_TODOS));
    fireEvent.click(rendered.getByRole("button", { name: "Stop" }));
    await act(async () => finishRun(1, ""));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("awaiting");
    await waitFor(() => expect(rendered.getByRole("button", { name: "Approve plan" })).toBeTruthy());
  });

  it("discards the pending approval when Plan mode is turned off and runs a normal turn", async () => {
    const rendered = await renderChat();
    await planFirstTurn(rendered, "Plan a change");
    act(() => useAgentTodoStore.getState().setTodos(PLAN_TODOS));
    await act(async () => finishRun(0, "Here is the plan."));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    await waitFor(() => expect(rendered.getByRole("button", { name: "Approve plan" })).toBeTruthy());

    const toggle = rendered.getByRole("button", { name: "Plan mode" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-state", "off");
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("planning");
    expect(rendered.queryByRole("button", { name: "Approve plan" })).toBeNull();
    expect(rendered.queryByTestId("ai-plan-mode-info")).toBeNull();
    expect(useAgentTodoStore.getState().todos).toEqual(PLAN_TODOS);

    submit(rendered, "Just do it");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.tools).toHaveProperty("write_file");
    expect(mocks.runs[1].options.system).not.toContain("Plan mode:");
    expect(mocks.runs[1].options.guardToolCall?.({ id: "c1", name: "write_file", args: {} })).toBeNull();
    await act(async () => finishRun(1, "Done"));
  });

  it("returns a chat to planning when a checkpoint restore wipes the awaiting checklist", async () => {
    const projectId = useFilesStore.getState().projectId;
    const originalRestoreFromGit = useFilesStore.getState().restoreFromGit;
    const restoreFromGit = vi.fn().mockResolvedValue(undefined);
    useFilesStore.setState({ restoreFromGit });
    usePlanModeStore.getState().setEnabled(projectId, true);
    usePlanApprovalStore.getState().setStatus("chat-1", "awaiting");
    localStorage.setItem("oleafly.agent-todos.chat-1", JSON.stringify(PLAN_TODOS));
    useChatsStore.setState((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === "chat-1"
          ? {
              ...chat,
              messages: [
                { id: "plan-user", role: "user", content: "Rename the intro" },
                {
                  id: "plan-assistant",
                  role: "assistant",
                  content: "Renamed it.",
                  checkpointOid: "checkpoint-oid",
                  toolCalls: [{ id: "t1", name: "write_file", status: "done" }],
                },
              ],
            }
          : chat,
      ),
    }));

    try {
      const rendered = await renderChat();
      await waitFor(() =>
        expect(rendered.getByPlaceholderText("Describe what to change in the plan")).toBeTruthy(),
      );

      fireEvent.click(rendered.getByTestId("ai-restore-checkpoint"));
      await waitFor(() =>
        expect(restoreFromGit).toHaveBeenCalledWith(projectId, "checkpoint-oid"),
      );
      await waitFor(() =>
        expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toBeTruthy(),
      );
      expect(usePlanApprovalStore.getState().status("chat-1")).toBe("planning");
      expect(useAgentTodoStore.getState().todos).toEqual([]);
      expect(rendered.queryByRole("button", { name: "Approve plan" })).toBeNull();

      submit(rendered, "Plan the next change");
      await waitFor(() => expect(mocks.runs).toHaveLength(1));
      expect(mocks.runs[0].options.system).toContain(PLAN_MODE_PLANNING_PROMPT);
      expect(mocks.runs[0].options.system).not.toContain(PLAN_MODE_REVISION_LINE);
      await act(async () => finishRun(0, "Fresh plan."));
    } finally {
      useFilesStore.setState({ restoreFromGit: originalRestoreFromGit });
    }
  });

  it("keeps the plan awaiting approval when the approved run cannot start", async () => {
    const rendered = await renderChat();
    await planFirstTurn(rendered, "Plan a change");
    act(() => useAgentTodoStore.getState().setTodos(PLAN_TODOS));
    await act(async () => finishRun(0, "Here is the plan."));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("awaiting");

    const originalThreadFor = useAgentTurnsStore.getState().threadFor;
    const threadFor = vi.fn(() => Promise.reject(new Error("thread unavailable")));
    useAgentTurnsStore.setState({ threadFor });
    try {
      fireEvent.click(rendered.getByRole("button", { name: "Approve plan" }));
      await waitFor(() => expect(threadFor).toHaveBeenCalled());
      await waitFor(() => expect(activeChatRun()).toBeNull());

      expect(mocks.runs).toHaveLength(1);
      expect(usePlanApprovalStore.getState().status("chat-1")).toBe("awaiting");
      expect(localStorage.getItem("oleafly.plan-approval.chat-1")).toBe("awaiting");
      expect(useAgentTodoStore.getState().todos).toEqual(PLAN_TODOS);
      await waitFor(() =>
        expect(rendered.getByRole("button", { name: "Approve plan" })).not.toBeDisabled(),
      );
    } finally {
      useAgentTurnsStore.setState({ threadFor: originalThreadFor });
    }
  });

  it("restores an awaiting plan with its checklist after a reload", async () => {
    const projectId = useFilesStore.getState().projectId;
    usePlanModeStore.getState().setEnabled(projectId, true);
    localStorage.setItem("oleafly.plan-approval.chat-1", "awaiting");
    localStorage.setItem("oleafly.agent-todos.chat-1", JSON.stringify(PLAN_TODOS));

    const rendered = await renderChat();

    await waitFor(() =>
      expect(rendered.getByRole("button", { name: "Approve plan" })).toBeTruthy(),
    );
    expect(rendered.getByRole("button", { name: "Revise" })).not.toBeDisabled();
    expect(rendered.getByPlaceholderText("Describe what to change in the plan")).toBeTruthy();
    expect(usePlanApprovalStore.getState().status("chat-1")).toBe("awaiting");
    expect(useAgentTodoStore.getState().todos).toEqual(PLAN_TODOS);
  });

  it("downgrades a persisted approved plan to planning when no run is live", async () => {
    const projectId = useFilesStore.getState().projectId;
    usePlanModeStore.getState().setEnabled(projectId, true);
    localStorage.setItem("oleafly.plan-approval.chat-1", "approved");
    localStorage.setItem("oleafly.agent-todos.chat-1", JSON.stringify(PLAN_TODOS));

    const rendered = await renderChat();

    await waitFor(() =>
      expect(usePlanApprovalStore.getState().status("chat-1")).toBe("planning"),
    );
    expect(localStorage.getItem("oleafly.plan-approval.chat-1")).toBeNull();
    expect(rendered.queryByRole("button", { name: "Approve plan" })).toBeNull();
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toBeTruthy();
  });

  it("adds the active project goal to the assembled system prompt", async () => {
    const projectId = useFilesStore.getState().projectId;
    useChatGoalStore.getState().setGoal(projectId, "Finish the Stage 3 UX");
    const rendered = await renderChat();

    submit(rendered, "Keep going");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.system).toContain(
      "Persistent goal: Finish the Stage 3 UX",
    );
    await act(async () => finishRun(0, "Done"));
  });

  it("keeps the active project goal in the figure mode system prompt", async () => {
    const projectId = useFilesStore.getState().projectId;
    useChatGoalStore.getState().setGoal(projectId, "Finish the diagram");
    const rendered = await renderChat();
    fireEvent.click(rendered.getByRole("button", { name: "Toggle figure mode" }));

    changeComposer("Draw the next block");
    pressComposerKey("Enter");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.runs[0].options.system).toContain("Persistent goal: Finish the diagram");
    await act(async () => finishRun(0, "Done"));
  });

  it("uses a Frame icon and primary color for active figure mode", async () => {
    const rendered = await renderChat();
    const toggle = rendered.getByRole("button", { name: "Toggle figure mode" });

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.querySelector(".lucide-frame")).not.toBeNull();
    expect(toggle.querySelector(".lucide-sparkles")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveClass("bg-primary/15", "text-primary");
  });

  it("edits and clears the active project goal from the composer", async () => {
    const projectId = useFilesStore.getState().projectId;
    useChatGoalStore.getState().setGoal(projectId, "Finish the Stage 3 UX");
    const rendered = await renderChat();

    fireEvent.click(
      rendered.getByRole("button", { name: "Edit goal: Finish the Stage 3 UX" }),
    );
    rendered.getByRole("textbox", { name: "Goal" });
    act(() =>
      mocks.goalInputProps?.onChange({ target: { value: "Ship the command menus" } }),
    );
    fireEvent.click(rendered.getByRole("button", { name: "Save goal" }));

    expect(useChatGoalStore.getState().goal(projectId)).toBe("Ship the command menus");
    expect(
      rendered.getByRole("button", { name: "Edit goal: Ship the command menus" }),
    ).toBeTruthy();

    fireEvent.click(rendered.getByRole("button", { name: "Clear goal" }));
    expect(useChatGoalStore.getState().goal(projectId)).toBe("");
    expect(rendered.queryByRole("button", { name: /Edit goal:/ })).toBeNull();
  });

  it("opens, filters, and dismisses slash commands only from the leading slash token", async () => {
    const rendered = await renderChat();

    changeComposer("Please /model this");
    expect(rendered.queryByRole("listbox", { name: "Slash commands" })).toBeNull();

    changeComposer("/");
    expect(rendered.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
    expect(rendered.getByRole("option", { name: /Goal/ })).toBeTruthy();

    changeComposer("/mod");
    expect(rendered.getByRole("option", { name: /Model/ })).toBeTruthy();
    expect(rendered.queryByRole("option", { name: /Goal/ })).toBeNull();

    pressComposerKey("Escape");
    expect(rendered.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toHaveValue(
      "/mod",
    );

    changeComposer("/mode");
    expect(rendered.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
  });

  it("uses arrow keys and Enter to open the real model picker and clear the slash token", async () => {
    const rendered = await renderChat();
    changeComposer("/");

    pressComposerKey("ArrowDown");
    pressComposerKey("ArrowDown");
    expect(rendered.getByRole("option", { name: /Model/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    pressComposerKey("Enter");

    expect(mocks.modelSelectorProps?.open).toBe(true);
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toHaveValue("");
    expect(rendered.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
    await waitFor(() =>
      expect(rendered.getByRole("textbox", { name: "Search models" })).toHaveFocus(),
    );
  });

  it("opens the real goal editor from the slash command", async () => {
    const rendered = await renderChat();
    changeComposer("/goal");
    pressComposerKey("Enter");

    await waitFor(() => expect(rendered.getByRole("textbox", { name: "Goal" })).toHaveFocus());
  });

  it.each([
    ["IME composition", false, true],
    ["Shift+Enter", true, false],
  ] as const)("does not run a slash command during %s", async (_label, shiftKey, isComposing) => {
    const rendered = await renderChat();
    changeComposer("/goal");
    const preventDefault = vi.fn();

    act(() =>
      mocks.textareaProps?.onKeyDown({
        key: "Enter",
        shiftKey,
        nativeEvent: { isComposing },
        preventDefault,
      }),
    );

    expect(rendered.queryByRole("textbox", { name: "Goal" })).toBeNull();
    expect(rendered.getByRole("listbox", { name: "Slash commands" })).toBeTruthy();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("opens the assistant MCP settings from the slash command", async () => {
    await renderChat();
    changeComposer("/mcp");
    pressComposerKey("Enter");

    expect(useSettingsStore.getState()).toMatchObject({
      settingsInitialSection: "ai",
      settingsScrollTarget: "ai-mcp",
      settingsOpen: true,
    });
  });

  it("toggles the real project plan mode from the slash command", async () => {
    await renderChat();
    const projectId = useFilesStore.getState().projectId;
    changeComposer("/plan");
    pressComposerKey("Enter");

    expect(usePlanModeStore.getState().isEnabled(projectId)).toBe(true);
  });

  it("archives a current chat with a mapped native thread", async () => {
    const rendered = await renderChat();
    const chatId = useChatsStore.getState().activeId;
    if (!chatId) throw new Error("active chat missing");
    act(() => {
      useAgentTurnsStore.setState({ threadByChat: { [chatId]: "thread-source" } });
    });

    changeComposer("/archive");
    pressComposerKey("Enter");

    await waitFor(() => expect(mocks.agentThreadArchive).toHaveBeenCalledWith("thread-source"));
    expect(useChatsStore.getState().byId(chatId)).toBeUndefined();
    expect(useChatsStore.getState().activeId).toBeNull();
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toHaveValue("");
  });

  it("forks the current chat and binds its native thread", async () => {
    const chatId = useChatsStore.getState().activeId;
    const projectId = useFilesStore.getState().projectId;
    if (!chatId || !projectId) throw new Error("active chat missing");
    useChatsStore.getState().saveMessages(chatId, [
      { id: "user-1", role: "user", content: "Review this proof" },
      { id: "assistant-1", role: "assistant", content: "I found one gap" },
    ]);
    const rendered = await renderChat();
    act(() => {
      useAgentTurnsStore.setState({ threadByChat: { [chatId]: "thread-source" } });
    });

    changeComposer("/fork");
    pressComposerKey("Enter");

    await waitFor(() =>
      expect(mocks.agentThreadFork).toHaveBeenCalledWith("thread-source", projectId),
    );
    const state = useChatsStore.getState();
    expect(state.activeId).not.toBe(chatId);
    expect(state.byId(state.activeId ?? "")?.messages).toEqual([
      { id: "user-1", role: "user", content: "Review this proof" },
      { id: "assistant-1", role: "assistant", content: "I found one gap" },
    ]);
    expect(useAgentTurnsStore.getState().threadByChat[state.activeId ?? ""]).toBe(
      "thread-forked",
    );
    expect(rendered.getByPlaceholderText("Ask AI to help with your document…")).toHaveValue("");
  });

  it("records a disabled skill draft from the current chat through slash", async () => {
    seedCompletedChat();
    await renderChat();
    changeComposer("/record");
    pressComposerKey("Enter");

    await waitFor(() => expect(mocks.createSkill).toHaveBeenCalledOnce());
    expect(mocks.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/Review This Proof/u),
        description: expect.stringContaining("Review this proof carefully"),
        instructions: expect.stringContaining("Replace this scaffold"),
      }),
    );
    await expect(mocks.createSkill.mock.results[0]?.value).resolves.toMatchObject({
      enabled: false,
    });
    await waitFor(() =>
      expect(
        chatQueryClient.getQueryData(["skills", useFilesStore.getState().projectId]),
      ).toEqual([
        expect.objectContaining({ id: "recorded-review", enabled: false }),
      ]),
    );
    await waitFor(() => expect(mocks.refetchSkills).toHaveBeenCalledOnce());
    expect(useSettingsStore.getState()).toMatchObject({
      settingsInitialSection: "ai",
      settingsOpen: true,
      settingsScrollTarget: "ai-skills",
    });
  });

  it("opens the existing file attachment input from the plus menu", async () => {
    const rendered = await renderChat();
    const input = rendered.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("attachment input missing");
    const click = vi.spyOn(input, "click");

    openAttachMenu(rendered);
    fireEvent.click(rendered.getByRole("menuitem", { name: /Files/ }));

    expect(click).toHaveBeenCalledOnce();
  });

  it("launches the browser window from the plus menu", async () => {
    const rendered = await renderChat();
    openAttachMenu(rendered);
    fireEvent.click(rendered.getByRole("menuitem", { name: /Attach browser/ }));

    expect(launchBrowser).toHaveBeenCalled();
  });

  it("opens the goal editor from the plus menu", async () => {
    const rendered = await renderChat();
    openAttachMenu(rendered);
    fireEvent.click(rendered.getByRole("menuitem", { name: /Goal/ }));

    await waitFor(() => expect(rendered.getByRole("textbox", { name: "Goal" })).toHaveFocus());
  });

  it("closes an unsaved goal draft when the project changes", async () => {
    const initialProjectId = useFilesStore.getState().projectId;
    const rendered = await renderChat();
    openAttachMenu(rendered);
    fireEvent.click(rendered.getByRole("menuitem", { name: /Goal/ }));
    expect(rendered.getByRole("textbox", { name: "Goal" })).toBeTruthy();

    act(() => {
      useFilesStore.setState({ projectId: "project-next", projectName: "Next project" });
    });

    expect(rendered.queryByRole("textbox", { name: "Goal" })).toBeNull();

    act(() => {
      useFilesStore.setState({ projectId: initialProjectId, projectName: "Test project" });
    });

    expect(rendered.queryByRole("textbox", { name: "Goal" })).toBeNull();
  });

  it("toggles the real project plan mode from the plus menu", async () => {
    const rendered = await renderChat();
    const projectId = useFilesStore.getState().projectId;
    openAttachMenu(rendered);
    fireEvent.click(rendered.getByRole("menuitem", { name: /Plan Mode/ }));

    expect(usePlanModeStore.getState().isEnabled(projectId)).toBe(true);
  });

  it("records a disabled skill draft from the current chat through the plus menu", async () => {
    seedCompletedChat();
    const rendered = await renderChat();
    openAttachMenu(rendered);
    fireEvent.click(rendered.getByRole("menuitem", { name: /Record a skill/ }));

    await waitFor(() => expect(mocks.createSkill).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.refetchSkills).toHaveBeenCalledOnce());
    expect(useSettingsStore.getState()).toMatchObject({
      settingsInitialSection: "ai",
      settingsOpen: true,
      settingsScrollTarget: "ai-skills",
    });
  });

  it("hides Plan mode and chat mutations while a run is active", async () => {
    const rendered = await renderChat();
    submit(rendered, "Keep working");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    changeComposer("/");
    expect(rendered.queryByRole("option", { name: /Plan Mode/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Archive/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Fork chat/ })).toBeNull();

    changeComposer("");
    openAttachMenu(rendered);
    expect(rendered.queryByRole("menuitem", { name: /Plan Mode/ })).toBeNull();
    expect(rendered.queryByRole("menuitem", { name: /Record a skill/ })).toBeNull();

    await act(async () => finishRun(0, "Done"));
  });

  it("omits project-dependent actions when no project is open", async () => {
    act(() => {
      useFilesStore.setState({ projectId: null, projectName: "" });
      useChatsStore.setState({ projectId: null, chats: [], activeId: null, live: {} });
    });
    const rendered = await renderChat();

    changeComposer("/");
    expect(rendered.queryByRole("option", { name: /^Goal/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Plan Mode/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Archive/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Fork chat/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Record a skill/ })).toBeNull();

    changeComposer("");
    openAttachMenu(rendered);
    expect(rendered.queryByRole("menuitem", { name: /Files/ })).toBeNull();
    expect(rendered.queryByRole("menuitem", { name: /^Goal/ })).toBeNull();
    expect(rendered.queryByRole("menuitem", { name: /Plan Mode/ })).toBeNull();
    expect(rendered.getByRole("menuitem", { name: /Attach browser/ })).toBeTruthy();
    expect(rendered.queryByRole("menuitem", { name: /Record a skill/ })).toBeNull();
  });

  it("clears the previous chat and record action when its project closes", async () => {
    seedCompletedChat();
    const rendered = await renderChat();
    await waitFor(() =>
      expect(rendered.container.querySelectorAll("[data-message-role]")).toHaveLength(2),
    );
    changeComposer("/record");
    expect(rendered.getByRole("option", { name: /Record a skill/ })).toBeTruthy();

    act(() => {
      useFilesStore.setState({ projectId: null, projectName: "" });
    });

    await waitFor(() =>
      expect(rendered.queryByRole("option", { name: /Record a skill/ })).toBeNull(),
    );
    expect(rendered.container.querySelectorAll("[data-message-role]")).toHaveLength(0);
    expect(mocks.createSkill).not.toHaveBeenCalled();
  });

  it("tracks a successful write from the existing tool-result mirror path", async () => {
    const rendered = await renderChat();
    act(() => {
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: "alpha\nbeta\n", dirty: false },
        },
      }));
    });
    submit(rendered, "Edit the file");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    act(() => {
      mocks.runs[0].options.handlers.onToolCall({
        id: "write-1",
        name: "write_file",
        args: { path: "main.tex", content: "alpha\ngamma\ndelta\n" },
      });
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: "alpha\ngamma\ndelta\n", dirty: false },
        },
      }));
      mocks.runs[0].options.handlers.onToolResult({
        id: "write-1",
        output: { success: true, path: "main.tex" },
      });
    });

    const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles["main.tex"]).toMatchObject({ additions: 2, deletions: 1 });
    expect(useAssistantOutputsStore.getState().fileOpen).toMatchObject({
      path: "main.tex",
      reason: "write",
    });
    await waitFor(() =>
      expect(mocks.planProps.at(-1)?.turn).toMatchObject({ chatId: "chat-1" }),
    );
    expect(mocks.planProps.at(-1)?.approval).toBeUndefined();
    expect(rendered.queryByTestId("agent-run-summary")).toBeNull();
    await act(async () => finishRun(0, "Edited"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    await waitFor(() =>
      expect(rendered.getByTestId("agent-run-summary")).toHaveAttribute("data-plan", "false"),
    );
    expect(mocks.runSummaryProps.at(-1)).toMatchObject({ plan: false, turn: { chatId: "chat-1" } });
    expect(rendered.queryByTestId("agent-status-pill")).toBeNull();
  });

  it("preserves create-file and compile output mirroring", async () => {
    const rendered = await renderChat();
    submit(rendered, "Create and compile");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await act(async () => {
      await mocks.runs[0].options.handlers.onToolCall({
        id: "create-1",
        name: "create_file",
        args: { path: "notes.md", is_dir: false },
      });
      useFilesStore.setState((state) => ({
        files: { ...state.files, "notes.md": { content: "", dirty: false } },
      }));
      mocks.runs[0].options.handlers.onToolResult({
        id: "create-1",
        output: { success: true, path: "notes.md", is_dir: false },
      });
      await mocks.runs[0].options.handlers.onToolCall({
        id: "compile-1",
        name: "compile",
        args: {},
      });
      mocks.runs[0].options.handlers.onToolResult({
        id: "compile-1",
        output: { success: true, errors: [], has_pdf: true },
      });
    });

    expect(useAssistantOutputsStore.getState().fileOpen).toMatchObject({
      path: "notes.md",
      reason: "write",
    });
    expect(useAssistantOutputsStore.getState().pdfEpoch).toBe(1);
    await act(async () => finishRun(0, "Compiled"));
  });

  it("reads an unopened file before a replace and does not track a declined write", async () => {
    mocks.readFileContent.mockResolvedValue("alpha\nbeta\n");
    const rendered = await renderChat();
    submit(rendered, "Edit an unopened file");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await act(async () => {
      await mocks.runs[0].options.handlers.onToolCall({
        id: "replace-1",
        name: "replace_in_file",
        args: { path: "chapter.tex", find: "beta", replace: "gamma" },
      });
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "chapter.tex": { content: "alpha\ngamma\n", dirty: false },
        },
      }));
      mocks.runs[0].options.handlers.onToolResult({
        id: "replace-1",
        output: { success: true, path: "chapter.tex" },
      });
      await mocks.runs[0].options.handlers.onToolCall({
        id: "write-declined",
        name: "write_file",
        args: { path: "declined.tex", content: "not written\n" },
      });
      mocks.runs[0].options.handlers.onToolResult({
        id: "write-declined",
        output: { declined: true, status: "declined", tool: "write_file" },
      });
    });

    const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles["chapter.tex"]).toMatchObject({ additions: 1, deletions: 1 });
    expect(turn?.changedFiles["declined.tex"]).toBeUndefined();
    expect(useAssistantOutputsStore.getState().fileOpen).toMatchObject({
      path: "chapter.tex",
      reason: "write",
    });
    await act(async () => finishRun(0, "Edited"));
  });

  it("keeps an empty file created through write_file in the turn summary", async () => {
    mocks.readFileContent.mockRejectedValue(new Error("missing"));
    const rendered = await renderChat();
    submit(rendered, "Create an empty file by writing it");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await act(async () => {
      await mocks.runs[0].options.handlers.onToolCall({
        id: "write-empty",
        name: "write_file",
        args: { path: "empty.md", content: "" },
      });
      useFilesStore.setState((state) => ({
        files: { ...state.files, "empty.md": { content: "", dirty: false } },
      }));
      mocks.runs[0].options.handlers.onToolResult({
        id: "write-empty",
        output: { success: true, path: "empty.md" },
      });
    });

    const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles["empty.md"]).toMatchObject({
      created: true,
      additions: 0,
      deletions: 0,
    });
    await act(async () => finishRun(0, "Created"));
  });

  it("does not create an automatic Git checkpoint when an assistant run starts", async () => {
    const rendered = await renderChat();
    submit(rendered, "Explain this document");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.gitPreparePublish).not.toHaveBeenCalled();
    await act(async () => finishRun(0, "Done"));
  });

  it("reconciles a commit made explicitly during the agent turn", async () => {
    mocks.gitHeadOid.mockResolvedValueOnce("head-0").mockResolvedValue("head-2");
    mocks.gitShow.mockResolvedValue("new\n");
    const rendered = await renderChat();
    act(() => {
      useFilesStore.setState((state) => ({
        files: { ...state.files, "notes.md": { content: "old\n", dirty: false } },
      }));
    });
    submit(rendered, "Edit and commit");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await act(async () => {
      await mocks.runs[0].options.handlers.onToolCall({
        id: "write-1",
        name: "write_file",
        args: { path: "notes.md", content: "new\n" },
      });
      useFilesStore.setState((state) => ({
        files: { ...state.files, "notes.md": { content: "new\n", dirty: false } },
      }));
      mocks.runs[0].options.handlers.onToolResult({
        id: "write-1",
        output: { success: true, path: "notes.md" },
      });
      await mocks.runs[0].options.handlers.onToolCall({
        id: "commit-1",
        name: "run_command",
        args: { command: "git add notes.md && git commit -m update" },
      });
      mocks.runs[0].options.handlers.onToolResult({
        id: "commit-1",
        output: {
          exec: true,
          command: "git add notes.md && git commit -m update",
          output: "",
          exit_code: 0,
          status: "Success",
        },
      });
    });

    await waitFor(() => {
      const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
      expect(turn?.commits).toContainEqual({ id: "head-2", files: ["notes.md"] });
    });
    expect(mocks.gitShow).toHaveBeenCalledWith(
      useFilesStore.getState().projectId,
      "head-2",
      "notes.md",
    );
    await act(async () => finishRun(0, "Committed"));
  });

  it("persists a mode selected from the composer footer", async () => {
    const rendered = await renderChat();
    fireEvent.click(
      rendered.getByRole("button", { name: "Approval mode. Approve for me" }),
    );
    fireEvent.click(rendered.getByRole("button", { name: "Full access" }));

    await waitFor(() =>
      expect(mocks.approvalsModeSet).toHaveBeenCalledWith(
        useFilesStore.getState().projectId,
        "full-access",
      ),
    );
  });

  it("keeps the snapshotted approval mode selector disabled during a run", async () => {
    mocks.approvalsModeGet.mockResolvedValue("ask-for-approval");
    const rendered = await renderChat();
    submit(rendered, "Keep this mode for the run");

    expect(
      rendered.getByRole("button", { name: "Approval mode. Ask for approval" }),
    ).toBeDisabled();
    expect(rendered.getByRole("button", { name: "Plan mode" })).toBeDisabled();
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await act(async () => finishRun(0, "Done"));
    await waitFor(() =>
      expect(
        rendered.getByRole("button", { name: "Approval mode. Ask for approval" }),
      ).not.toBeDisabled(),
    );
    expect(rendered.getByRole("button", { name: "Plan mode" })).not.toBeDisabled();
  });

  it("keeps the approval mode locked after remounting on another project chat", async () => {
    mocks.approvalsModeGet.mockResolvedValue("ask-for-approval");
    const first = await renderChat();
    submit(first, "Keep the project mode locked");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    first.unmount();

    const projectId = useFilesStore.getState().projectId;
    if (!projectId) throw new Error("project missing");
    act(() => {
      useChatsStore.setState((state) => ({
        chats: [
          ...state.chats,
          {
            id: "chat-2",
            projectId,
            title: "Another chat",
            createdAt: 2,
            updatedAt: 2,
            messages: [],
            headOid: null,
          },
        ],
        activeId: "chat-2",
      }));
    });

    const second = await renderChat();
    await waitFor(() =>
      expect(
        second.getByRole("button", { name: "Approval mode. Ask for approval" }),
      ).toBeDisabled(),
    );

    await act(async () => finishRun(0, "Done"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
  });

  it("opens the project approval settings from Custom mode", async () => {
    mocks.approvalsModeGet.mockResolvedValue("custom");
    const rendered = await renderChat();
    await waitFor(() =>
      expect(
        rendered.getByRole("button", {
          name: "Approval mode. Custom (approvals.toml)",
        }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      rendered.getByRole("button", { name: "Approval mode. Custom (approvals.toml)" }),
    );
    fireEvent.click(rendered.getByRole("button", { name: "Edit project rules" }));

    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "ai",
      settingsScrollTarget: "ai-approvals",
    });
  });
});

describe("ChatCore provider readiness", () => {
  const keyedConfig = {
    ai_provider: "openai",
    ai_model: "gpt-4o",
    ai_api_key: "test-key",
    ai_keys: { openai: "test-key" },
    ai_provider_models: {},
    ai_custom_providers: [],
    ai_system_prompt: "",
    ai_personas: [],
  } as unknown as AppConfig;
  const connectPrompt = "Connect an AI provider to continue";
  const composerPlaceholder = "Ask AI to help with your document…";

  function mount(node: ReturnType<typeof createElement>) {
    chatQueryClient = createAppQueryClient();
    return render(
      createElement(QueryClientProvider, { client: chatQueryClient }, node),
    );
  }

  function assistantRoot(scope: ParentNode) {
    return scope.querySelector('[data-tour="ai-assistant"]');
  }

  it("shows a neutral loading state, never the connect prompt, before the first config read resolves", async () => {
    const pending = deferred<AppConfig>();
    mocks.getConfig.mockReturnValue(pending.promise);

    const rendered = mount(createElement(ChatCore));

    expect(rendered.queryByText(connectPrompt)).toBeNull();
    expect(rendered.getByTestId("ai-provider-loading")).toBeTruthy();
    expect(assistantRoot(rendered.container)).toHaveAttribute("data-tour-ready", "false");

    await act(async () => {
      pending.resolve(keyedConfig);
    });
    await waitFor(() =>
      expect(assistantRoot(rendered.container)).toHaveAttribute("data-tour-configured", "true"),
    );
    expect(rendered.queryByTestId("ai-provider-loading")).toBeNull();
    expect(rendered.getByPlaceholderText(composerPlaceholder)).toBeTruthy();
  });

  it("shows the connect prompt once a keyless config has loaded", async () => {
    mocks.getConfig.mockResolvedValue({ ...keyedConfig, ai_api_key: "", ai_keys: {} });

    const rendered = mount(createElement(ChatCore));

    expect(rendered.queryByText(connectPrompt)).toBeNull();
    expect(await rendered.findByText(connectPrompt)).toBeTruthy();
    expect(assistantRoot(rendered.container)).toHaveAttribute("data-tour-configured", "false");
    expect(assistantRoot(rendered.container)).toHaveAttribute("data-tour-ready", "true");
    expect(rendered.queryByTestId("ai-provider-loading")).toBeNull();
  });

  it("remounts straight into the thread once the config is known", async () => {
    const first = await renderChat();
    first.unmount();
    const pending = deferred<AppConfig>();
    mocks.getConfig.mockReturnValue(pending.promise);

    const second = mount(createElement(ChatCore));

    expect(assistantRoot(second.container)).toHaveAttribute("data-tour-configured", "true");
    expect(assistantRoot(second.container)).toHaveAttribute("data-tour-ready", "true");
    expect(second.queryByText(connectPrompt)).toBeNull();
    expect(second.getByPlaceholderText(composerPlaceholder)).toBeTruthy();

    await act(async () => {
      pending.resolve(keyedConfig);
    });
  });

  it("keeps the thread on screen while the assistant floats and docks", async () => {
    const rendered = mount(
      createElement(Fragment, null, createElement(ChatPanel), createElement(CopilotOverlay)),
    );
    await waitFor(() =>
      expect(assistantRoot(rendered.container)).toHaveAttribute("data-tour-configured", "true"),
    );
    const pending = deferred<AppConfig>();
    mocks.getConfig.mockReturnValue(pending.promise);

    act(() => useSettingsStore.getState().setChatFloating(true));

    const overlay = document.body.querySelector('[data-testid="copilot-overlay"]');
    expect(overlay).not.toBeNull();
    expect(assistantRoot(overlay as ParentNode)).toHaveAttribute("data-tour-configured", "true");
    expect(assistantRoot(overlay as ParentNode)).toHaveAttribute("data-tour-ready", "true");
    expect(document.body.textContent).not.toContain(connectPrompt);
    expect(
      overlay?.querySelector(`textarea[placeholder="${composerPlaceholder}"]`),
    ).not.toBeNull();

    act(() => useSettingsStore.getState().setChatFloating(false));

    expect(document.body.querySelector('[data-testid="copilot-overlay"]')).toBeNull();
    expect(assistantRoot(rendered.container)).toHaveAttribute("data-tour-configured", "true");
    expect(assistantRoot(rendered.container)).toHaveAttribute("data-tour-ready", "true");
    expect(document.body.textContent).not.toContain(connectPrompt);
    expect(
      rendered.container.querySelector(`textarea[placeholder="${composerPlaceholder}"]`),
    ).not.toBeNull();

    await act(async () => {
      pending.resolve(keyedConfig);
    });
  });
});

describe("ChatCore model trust", () => {
  function configureStoredModel(extra: Partial<StoredModel> = {}, probes?: Record<string, ModelProbe>) {
    mocks.getConfig.mockResolvedValue({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_api_key: "test-key",
      ai_keys: { openai: "test-key" },
      ai_provider_models: {
        openai: [
          {
            id: "gpt-4o",
            name: "GPT-4o",
            enabled: true,
            source: "fetched",
            trust: "untested",
            ...extra,
          },
        ],
      },
      ai_model_probes: probes ?? {},
      ai_custom_providers: [],
      ai_system_prompt: "",
      ai_personas: [],
    });
  }

  const composerPlaceholder = "Ask AI to help with your document…";

  it("checks an untested model once before its first assistant run", async () => {
    configureStoredModel();
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.agentProbeModel).toHaveBeenCalledTimes(1);
    expect(mocks.agentProbeModel).toHaveBeenCalledWith({ providerId: "openai", modelId: "gpt-4o" });
    expect(rendered.queryByTestId("ai-model-notice")).toBeNull();
    expect(mocks.runs[0].options.tools).toHaveProperty("write_file");
    await act(async () => finishRun(0, "Ready"));

    submit(rendered, "Again");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.agentProbeModel).toHaveBeenCalledTimes(1);
    await act(async () => finishRun(1, "Ready"));
  });

  it("shows that the model is being checked while the probe runs", async () => {
    configureStoredModel();
    const probe = deferred<ModelProbe>();
    mocks.agentProbeModel.mockReturnValue(probe.promise);
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() =>
      expect(rendered.getByTestId("ai-model-notice")).toHaveTextContent("Checking this model"),
    );
    expect(rendered.getByTestId("ai-model-notice")).toHaveAttribute("role", "status");
    expect(mocks.runs).toHaveLength(0);

    await act(async () => probe.resolve({ verdict: "verified", reason: "", probedAt: 1 }));
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(rendered.queryByTestId("ai-model-notice")).toBeNull();
    await act(async () => finishRun(0, "Ready"));
  });

  it("stops before the run when the probe reports the model blocked", async () => {
    configureStoredModel();
    mocks.agentProbeModel.mockResolvedValue({
      verdict: "blocked",
      reason: "No tool call came back.",
      probedAt: 1,
    });
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() =>
      expect(rendered.getByTestId("ai-model-notice")).toHaveTextContent(
        "This model is blocked for the assistant: No tool call came back.",
      ),
    );
    expect(rendered.getByTestId("ai-model-notice")).toHaveAttribute("role", "alert");
    expect(mocks.runs).toHaveLength(0);
    expect(activeChatRun()).toBeNull();
    expect(rendered.getByPlaceholderText(composerPlaceholder)).toHaveValue("Hello");

    submit(rendered, "Hello");
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.agentProbeModel).toHaveBeenCalledTimes(1);
    expect(mocks.runs).toHaveLength(0);
  });

  it("refuses a model the catalog blocks without probing it", async () => {
    configureStoredModel({
      trust: "blocked",
      blockedReason: "Its thinking output breaks the assistant loop.",
    });
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() =>
      expect(rendered.getByTestId("ai-model-notice")).toHaveTextContent(
        "This model is blocked for the assistant: Its thinking output breaks the assistant loop.",
      ),
    );
    expect(mocks.agentProbeModel).not.toHaveBeenCalled();
    expect(mocks.runs).toHaveLength(0);
    expect(rendered.getByPlaceholderText(composerPlaceholder)).toHaveValue("Hello");
  });

  it("runs a chat-only model without tools and without a probe", async () => {
    configureStoredModel({
      metadata: {
        name: "GPT-4o",
        inputModalities: ["text"],
        outputModalities: ["text"],
        toolCall: false,
        reasoning: false,
        attachment: false,
        structuredOutput: false,
        status: "active",
      },
    });
    const rendered = await renderChat();
    expect(rendered.getByTestId("ai-model-notice")).toHaveTextContent(
      "Chat only, this model cannot use tools",
    );
    expect(rendered.getByTestId("ai-model-notice")).toHaveAttribute("role", "status");

    submit(rendered, "Hello");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.agentProbeModel).not.toHaveBeenCalled();
    expect(mocks.runs[0].options.tools).toEqual({});
    expect(mocks.runs[0].options.system).toContain("Available tools for this run: none.");
    await act(async () => finishRun(0, "Ready"));
  });

  it("skips the probe when the run offers no tools", async () => {
    configureStoredModel();
    useAiToolSettingsStore.setState({
      enabledByName: {
        read_file: false,
        update_todos: false,
        write_file: false,
        run_command: false,
        literature_search: false,
        mcp__papers__search_papers: false,
      },
    });
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.agentProbeModel).not.toHaveBeenCalled();
    expect(mocks.runs[0].options.tools).toEqual({});
    await act(async () => finishRun(0, "Ready"));
  });

  it("does not probe a verified model", async () => {
    configureStoredModel({ trust: "verified" });
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.agentProbeModel).not.toHaveBeenCalled();
    await act(async () => finishRun(0, "Ready"));
  });

  it("trusts a verdict already saved in the config", async () => {
    configureStoredModel({}, {
      "openai/gpt-4o": { verdict: "verified", reason: "", probedAt: 5 },
    });
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.agentProbeModel).not.toHaveBeenCalled();
    await act(async () => finishRun(0, "Ready"));
  });

  it("keeps the composer editable when the probe cannot run", async () => {
    configureStoredModel();
    mocks.agentProbeModel.mockRejectedValue(new Error("[network] The provider did not answer."));
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() =>
      expect(rendered.getByTestId("ai-model-notice")).toHaveTextContent(
        "Could not check this model. The provider did not answer.",
      ),
    );
    expect(rendered.getByTestId("ai-model-notice")).toHaveAttribute("role", "alert");
    expect(mocks.runs).toHaveLength(0);
    expect(activeChatRun()).toBeNull();
    expect(rendered.getByPlaceholderText(composerPlaceholder)).toHaveValue("Hello");
  });
});

describe("ChatCore model re-check", () => {
  it("offers a re-check for a model an earlier probe blocked and runs once it passes", async () => {
    mocks.getConfig.mockResolvedValue({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_api_key: "test-key",
      ai_keys: { openai: "test-key" },
      ai_provider_models: {
        openai: [
          { id: "gpt-4o", name: "GPT-4o", enabled: true, source: "fetched", trust: "untested" },
        ],
      },
      ai_model_probes: {
        "openai/gpt-4o": { verdict: "blocked", reason: "No tool call came back.", probedAt: 5 },
      },
      ai_custom_providers: [],
      ai_system_prompt: "",
      ai_personas: [],
    });
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() =>
      expect(rendered.getByTestId("ai-model-notice")).toHaveTextContent(
        "This model is blocked for the assistant: No tool call came back.",
      ),
    );
    expect(mocks.agentProbeModel).not.toHaveBeenCalled();
    expect(mocks.runs).toHaveLength(0);

    mocks.agentProbeModel.mockResolvedValue({ verdict: "verified", reason: "", probedAt: 9 });
    fireEvent.click(rendered.getByTestId("ai-model-recheck"));
    await waitFor(() => expect(rendered.queryByTestId("ai-model-notice")).toBeNull());
    expect(mocks.agentProbeModel).toHaveBeenCalledTimes(1);

    submit(rendered, "Hello");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.agentProbeModel).toHaveBeenCalledTimes(1);
    await act(async () => finishRun(0, "Ready"));
  });

  it("does not offer a re-check for a model the catalog blocks", async () => {
    mocks.getConfig.mockResolvedValue({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_api_key: "test-key",
      ai_keys: { openai: "test-key" },
      ai_provider_models: {
        openai: [
          {
            id: "gpt-4o",
            name: "GPT-4o",
            enabled: true,
            source: "fetched",
            trust: "blocked",
            blockedReason: "Its thinking output breaks the assistant loop.",
          },
        ],
      },
      ai_custom_providers: [],
      ai_system_prompt: "",
      ai_personas: [],
    });
    const rendered = await renderChat();

    submit(rendered, "Hello");
    await waitFor(() => expect(rendered.getByTestId("ai-model-notice")).toHaveTextContent("blocked"));
    expect(rendered.queryByTestId("ai-model-recheck")).toBeNull();
  });
});
