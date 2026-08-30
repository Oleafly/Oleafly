import { JSDOM } from "jsdom";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@oleafly/ai-core";
import type { ApprovalMode } from "@oleafly/ai-tools";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import type { ChatMessage, StoredChat } from "@/store/chats";

interface HarnessOptions {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  onRequestId?: (requestId: string) => void;
  onRawEvent?: (event: AgentEvent) => void;
  handlers: {
    onText: (text: string) => void;
    onToolCall: (call: { id: string; name: string; args: unknown }) => void | Promise<void>;
    onToolResult: (result: { id: string; output: unknown }) => void;
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

const mocks = vi.hoisted(() => ({
  runs: [] as PendingRun[],
  runAgentHarness: vi.fn(),
  agentSteer: vi.fn(),
  agentThreadArchive: vi.fn(),
  agentThreadFork: vi.fn(),
  claimPrewarmed: vi.fn(),
  approvalsList: vi.fn(),
  approvalsSet: vi.fn(),
  approvalsModeGet: vi.fn(),
  approvalsModeSet: vi.fn(),
  getConfig: vi.fn(),
  gitAutoCommit: vi.fn(),
  gitAutoCommitUpdate: vi.fn(),
  gitHeadOid: vi.fn(),
  gitLog: vi.fn(),
  gitShow: vi.fn(),
  gitStatus: vi.fn(),
  usageRecord: vi.fn(),
  checkProjectBudget: vi.fn(),
  buildWorkspaceContext: vi.fn(),
  retrieveProjectChunks: vi.fn(),
  readFileContent: vi.fn(),
  createSkill: vi.fn(),
  refetchSkills: vi.fn(),
  skillEntries: [] as Array<Record<string, unknown>>,
  skillsLoaded: true,
  runSummaryProps: [] as Array<{
    todos: unknown[];
    turn: { chatId: string; turnId: string } | null;
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
  approvalsList: (...args: unknown[]) => mocks.approvalsList(...args),
  approvalsSet: (...args: unknown[]) => mocks.approvalsSet(...args),
  approvalsModeGet: (...args: unknown[]) => mocks.approvalsModeGet(...args),
  approvalsModeSet: (...args: unknown[]) => mocks.approvalsModeSet(...args),
  getConfig: (...args: unknown[]) => mocks.getConfig(...args),
  gitAutoCommit: (...args: unknown[]) => mocks.gitAutoCommit(...args),
  gitAutoCommitUpdate: (...args: unknown[]) => mocks.gitAutoCommitUpdate(...args),
  gitHeadOid: (...args: unknown[]) => mocks.gitHeadOid(...args),
  gitLog: (...args: unknown[]) => mocks.gitLog(...args),
  gitShow: (...args: unknown[]) => mocks.gitShow(...args),
  gitStatus: (...args: unknown[]) => mocks.gitStatus(...args),
  usageRecord: (...args: unknown[]) => mocks.usageRecord(...args),
  readFileContent: (...args: unknown[]) => mocks.readFileContent(...args),
}));

vi.mock("@/lib/ai-budget", () => ({
  checkProjectBudget: (...args: unknown[]) => mocks.checkProjectBudget(...args),
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

vi.mock("@/components/ai/chat-parts", () => ({
  AgentPlan: () => null,
  AgentRunSummary: (props: {
    todos: unknown[];
    turn: { chatId: string; turnId: string } | null;
  }) => {
    mocks.runSummaryProps.push(props);
    return null;
  },
  InfoHint: () => null,
  MessageItem: () => null,
  Shimmer: () => null,
  formatError: (error: unknown) => String(error),
  formatToolOutput: (output: unknown) =>
    typeof output === "string" ? output : JSON.stringify(output),
}));

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
let useChatGoalStore: typeof import("@/store/chat-goal").useChatGoalStore;
let autoCommitNow: typeof import("@/lib/auto-commit").autoCommitNow;
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
  ({ createElement } = await import("react"));
  ({ act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ createAppQueryClient } = await import("@/lib/query"));
  ({ ChatCore } = await import("./ChatCore"));
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
  ({ useChatGoalStore } = await import("@/store/chat-goal"));
  ({ autoCommitNow } = await import("@/lib/auto-commit"));
  ({ activeChatRun, endChatRun } = await import("./chat-run-registry"));
});

afterEach(() => cleanup());

beforeEach(() => {
  const active = activeChatRun();
  if (active) endChatRun(active);
  mocks.runs.length = 0;
  mocks.runSummaryProps.length = 0;
  mocks.textareaProps = null;
  mocks.goalInputProps = null;
  mocks.modelSelectorProps = null;
  mocks.agentSteer.mockReset().mockResolvedValue(undefined);
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
  mocks.gitAutoCommit.mockReset().mockResolvedValue(undefined);
  mocks.gitAutoCommitUpdate.mockReset().mockResolvedValue(false);
  mocks.gitHeadOid.mockReset().mockResolvedValue(null);
  mocks.gitLog.mockReset().mockResolvedValue([]);
  mocks.gitShow.mockReset().mockResolvedValue("");
  mocks.gitStatus.mockReset().mockResolvedValue([]);
  mocks.usageRecord.mockReset().mockResolvedValue(undefined);
  mocks.checkProjectBudget.mockReset().mockResolvedValue("ok");
  mocks.buildWorkspaceContext.mockReset().mockResolvedValue("");
  mocks.retrieveProjectChunks.mockReset().mockResolvedValue([]);
  mocks.readFileContent.mockReset().mockResolvedValue("");
  mocks.createSkill.mockReset().mockResolvedValue({
    id: "recorded-review",
    name: "Recorded Review",
    description: "Repeat the review approach from this chat.",
    instructions: "Review this draft before enabling it.",
    source: "user",
    enabled: false,
    removable: true,
    validation: { status: "valid" },
  });
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
  useChatGoalStore.setState({ goalsByProject: {}, loaded: {} });
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
    expect(rendered.getByRole("button", { name: "Voice input (coming soon)" })).toBeVisible();
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

  it("shows only the persona dot and chevron until a persona is active", async () => {
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
    expect(inactiveTrigger).not.toHaveTextContent("Persona");
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
    expect(rendered.getByText("Queued for the next turn: Reserve this follow-up")).toBeTruthy();

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
    const steerAck = deferred<void>();
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
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"].map((item) => item.status)).toEqual([
      "pending",
      "pending",
    ]);

    await act(async () => steerAck.resolve());
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

  it("injects enabled OpenResearch metadata and loads its full instructions on demand", async () => {
    mocks.skillEntries.push(
      {
        id: "openresearch",
        name: "OpenResearch (orx)",
        description:
          "Ground research in literature and run or inspect experiments with the local orx CLI.",
        instructions:
          "Before using it, check whether `orx` is available on PATH. Run `orx --help` for the full interface.",
        source: "first-party",
        enabled: true,
        removable: false,
        validation: { status: "valid" },
      },
      {
        id: "citation-audit",
        name: "Citation Audit",
        description: "Check every citation.",
        instructions: "Inspect every bibliography entry.",
        source: "user",
        enabled: false,
        removable: true,
        validation: { status: "valid" },
      },
      {
        id: "broken",
        name: "Broken Skill",
        description: "This skill is invalid.",
        instructions: "Do not load this.",
        source: "user",
        enabled: false,
        removable: true,
        validation: {
          status: "invalid",
          code: "missing-description",
          message: "Missing description.",
        },
      },
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

  it("waits for the initial skills query before assembling a run", async () => {
    const skill = {
      id: "proof-review",
      name: "Proof Review",
      description: "Review a proof for logical gaps.",
      instructions: "Read each claim and verify its dependencies.",
      source: "user",
      enabled: true,
      removable: true,
      validation: { status: "valid" },
    };
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
    await waitFor(() => expect(mocks.refetchSkills).toHaveBeenCalledTimes(2));
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

  it("adds the plan posture only after Plan mode is turned on", async () => {
    const rendered = await renderChat();
    const toggle = rendered.getByRole("button", { name: "Plan mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    submit(rendered, "Run without planning posture");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.system).not.toContain(
      "Plan mode: Produce and maintain a step plan with update_todos. Work through the plan step by step before finishing.",
    );
    await act(async () => finishRun(0, "Done"));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveClass("bg-violet-500/15", "text-violet-600");
    expect(toggle.className).not.toContain("amber-");
    submit(rendered, "Run with planning posture");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.system).toContain(
      "Plan mode: Produce and maintain a step plan with update_todos. Work through the plan step by step before finishing.",
    );
    await act(async () => finishRun(1, "Planned"));
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

  it("opens the real MCP status settings from the slash command", async () => {
    await renderChat();
    changeComposer("/mcp");
    pressComposerKey("Enter");

    expect(useSettingsStore.getState()).toMatchObject({
      settingsInitialSection: "mcp",
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
      expect(chatQueryClient.getQueryData(["skills"])).toEqual([
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

  it("opens the browser dock from the plus menu", async () => {
    const rendered = await renderChat();
    openAttachMenu(rendered);
    fireEvent.click(rendered.getByRole("menuitem", { name: /Attach browser/ }));

    expect(useSettingsStore.getState().browserOpen).toBe(true);
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
    fireEvent.click(rendered.getByRole("menuitem", { name: /Plan mode/ }));

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
    expect(rendered.queryByRole("option", { name: /Plan mode/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Archive/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Fork chat/ })).toBeNull();

    changeComposer("");
    openAttachMenu(rendered);
    expect(rendered.queryByRole("menuitem", { name: /Plan mode/ })).toBeNull();
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
    expect(rendered.queryByRole("option", { name: /Plan mode/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Archive/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Fork chat/ })).toBeNull();
    expect(rendered.queryByRole("option", { name: /Record a skill/ })).toBeNull();

    changeComposer("");
    openAttachMenu(rendered);
    expect(rendered.queryByRole("menuitem", { name: /Files/ })).toBeNull();
    expect(rendered.queryByRole("menuitem", { name: /^Goal/ })).toBeNull();
    expect(rendered.queryByRole("menuitem", { name: /Plan mode/ })).toBeNull();
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
      expect(mocks.runSummaryProps.at(-1)?.turn).toMatchObject({ chatId: "chat-1" }),
    );
    await act(async () => finishRun(0, "Edited"));
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

  it("marks tracked files committed when an in-turn auto commit succeeds", async () => {
    mocks.gitLog.mockResolvedValue([
      { oid: "head-0", short: "head-0", time: 1, message: "Before" },
    ]);
    mocks.gitAutoCommitUpdate.mockResolvedValue(true);
    mocks.gitHeadOid.mockResolvedValue("head-1");
    mocks.gitShow.mockResolvedValue("alpha\ngamma\n");
    const rendered = await renderChat();
    act(() => {
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: "alpha\nbeta\n", dirty: false },
        },
      }));
    });
    submit(rendered, "Edit and compile");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await act(async () => {
      await mocks.runs[0].options.handlers.onToolCall({
        id: "write-1",
        name: "write_file",
        args: { path: "main.tex", content: "alpha\ngamma\n" },
      });
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: "alpha\ngamma\n", dirty: false },
        },
      }));
      mocks.runs[0].options.handlers.onToolResult({
        id: "write-1",
        output: { success: true, path: "main.tex" },
      });
      await autoCommitNow(useFilesStore.getState().projectId ?? "");
    });

    await waitFor(() => {
      const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
      expect(turn?.committedFiles).toEqual([
        expect.objectContaining({ path: "main.tex", commitId: "head-1" }),
      ]);
      expect(turn?.changedFiles).toEqual({});
    });
    await act(async () => finishRun(0, "Committed"));
  });

  it("reconciles a commit made through run_command", async () => {
    mocks.gitLog.mockResolvedValue([
      { oid: "head-0", short: "head-0", time: 1, message: "Before" },
    ]);
    mocks.gitHeadOid.mockResolvedValue("head-2");
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

  it("keeps an empty untracked file changed after an unrelated commit", async () => {
    mocks.gitLog.mockResolvedValue([
      { oid: "head-0", short: "head-0", time: 1, message: "Before" },
    ]);
    mocks.gitHeadOid.mockResolvedValue("head-other");
    mocks.gitStatus.mockResolvedValue([{ path: "empty.md", status: "?", staged: false }]);
    mocks.gitShow.mockResolvedValue("");
    const rendered = await renderChat();
    submit(rendered, "Create an empty file, then commit something else");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    await act(async () => {
      await mocks.runs[0].options.handlers.onToolCall({
        id: "create-1",
        name: "create_file",
        args: { path: "empty.md", is_dir: false },
      });
      useFilesStore.setState((state) => ({
        files: { ...state.files, "empty.md": { content: "", dirty: false } },
      }));
      mocks.runs[0].options.handlers.onToolResult({
        id: "create-1",
        output: { success: true, path: "empty.md", is_dir: false },
      });
      await mocks.runs[0].options.handlers.onToolCall({
        id: "commit-other",
        name: "run_command",
        args: { command: "git commit -m unrelated" },
      });
      mocks.runs[0].options.handlers.onToolResult({
        id: "commit-other",
        output: {
          exec: true,
          command: "git commit -m unrelated",
          output: "",
          exit_code: 0,
          status: "Success",
        },
      });
    });

    await waitFor(() => {
      const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
      expect(turn?.changedFiles["empty.md"]).toMatchObject({ created: true });
      expect(turn?.committedFiles).toEqual([]);
    });
    await act(async () => finishRun(0, "Still changed"));
  });

  it("reconciles an unannounced HEAD advance before finalizing the turn", async () => {
    mocks.gitLog.mockResolvedValue([
      { oid: "head-0", short: "head-0", time: 1, message: "Before" },
    ]);
    mocks.gitHeadOid.mockResolvedValue("head-final");
    mocks.gitShow.mockResolvedValue("new\n");
    const rendered = await renderChat();
    act(() => {
      useFilesStore.setState((state) => ({
        files: { ...state.files, "notes.md": { content: "old\n", dirty: false } },
      }));
    });
    submit(rendered, "Edit and finish after an external commit");
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
      finishRun(0, "Done");
    });
    await waitFor(() => expect(activeChatRun()).toBeNull());

    const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.committedFiles).toEqual([
      expect.objectContaining({ path: "notes.md", commitId: "head-final" }),
    ]);
    expect(turn?.changedFiles).toEqual({});
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
