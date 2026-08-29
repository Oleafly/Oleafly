import { JSDOM } from "jsdom";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import type { ChatMessage, StoredChat } from "@/store/chats";

interface HarnessOptions {
  messages: ModelMessage[];
  tools: ToolSet;
  onRequestId?: (requestId: string) => void;
  handlers: {
    onText: (text: string) => void;
    onToolCall: (call: { id: string; name: string; args: unknown }) => void;
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
  claimPrewarmed: vi.fn(),
  approvalsList: vi.fn(),
  approvalsSet: vi.fn(),
  getConfig: vi.fn(),
  gitAutoCommit: vi.fn(),
  gitLog: vi.fn(),
  usageRecord: vi.fn(),
  checkProjectBudget: vi.fn(),
  buildWorkspaceContext: vi.fn(),
  retrieveProjectChunks: vi.fn(),
  textareaProps: null as null | {
    onChange: (event: { target: { value: string } }) => void;
    onKeyDown: (event: {
      key: string;
      shiftKey: boolean;
      nativeEvent: { isComposing: boolean };
      preventDefault: () => void;
    }) => void;
  },
}));

vi.mock("./agent-turn", () => ({
  runAgentHarness: (options: HarnessOptions) => mocks.runAgentHarness(options),
}));

vi.mock("@/lib/agent-backend", () => ({
  agentSteer: (...args: unknown[]) => mocks.agentSteer(...args),
  agentThreadClaimPrewarmed: (...args: unknown[]) => mocks.claimPrewarmed(...args),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  approvalsList: (...args: unknown[]) => mocks.approvalsList(...args),
  approvalsSet: (...args: unknown[]) => mocks.approvalsSet(...args),
  getConfig: (...args: unknown[]) => mocks.getConfig(...args),
  gitAutoCommit: (...args: unknown[]) => mocks.gitAutoCommit(...args),
  gitLog: (...args: unknown[]) => mocks.gitLog(...args),
  usageRecord: (...args: unknown[]) => mocks.usageRecord(...args),
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

vi.mock("@/lib/skills", () => ({
  useSkills: () => ({ data: [] }),
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
        }),
      },
    ],
  },
}));

vi.mock("@/components/ai/AttachmentChips", () => ({
  AttachmentChips: () => null,
}));

vi.mock("@/components/ai/ChatHistoryModal", () => ({
  ChatHistoryModal: () => null,
}));

vi.mock("@/components/ai/ModelSelector", () => ({
  ModelSelector: () => null,
}));

vi.mock("@/components/ai/SubagentActivity", () => ({
  SubagentActivity: () => null,
}));

vi.mock("@/components/branding/OleaflyAssistantMascot", () => ({
  OleaflyAssistantMascot: () => null,
}));

vi.mock("@/components/ai/chat-parts", () => ({
  AgentPlan: () => null,
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

let ChatCore: typeof import("./ChatCore").ChatCore;
let LATEX_ENGINE: typeof import("@/lib/document-engine").LATEX_ENGINE;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let useChatsStore: typeof import("@/store/chats").useChatsStore;
let useSettingsStore: typeof import("@/store/settings").useSettingsStore;
let useAgentTurnsStore: typeof import("@/store/agent-turns").useAgentTurnsStore;
let activeChatRun: typeof import("./chat-run-registry").activeChatRun;
let endChatRun: typeof import("./chat-run-registry").endChatRun;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let createElement: typeof import("react").createElement;
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
    HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
    CustomEvent: { configurable: true, value: dom.window.CustomEvent },
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

  vi.resetModules();
  ({ createElement } = await import("react"));
  ({ act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react"));
  ({ ChatCore } = await import("./ChatCore"));
  ({ LATEX_ENGINE } = await import("@/lib/document-engine"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ useChatsStore } = await import("@/store/chats"));
  ({ useSettingsStore } = await import("@/store/settings"));
  ({ useAgentTurnsStore } = await import("@/store/agent-turns"));
  ({ activeChatRun, endChatRun } = await import("./chat-run-registry"));
});

afterEach(() => cleanup());

beforeEach(() => {
  const active = activeChatRun();
  if (active) endChatRun(active);
  mocks.runs.length = 0;
  mocks.textareaProps = null;
  mocks.agentSteer.mockReset().mockResolvedValue(undefined);
  mocks.claimPrewarmed.mockReset().mockResolvedValue(null);
  mocks.approvalsList.mockReset().mockResolvedValue({});
  mocks.approvalsSet.mockReset().mockResolvedValue(undefined);
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
  mocks.gitLog.mockReset().mockResolvedValue([]);
  mocks.usageRecord.mockReset().mockResolvedValue(undefined);
  mocks.checkProjectBudget.mockReset().mockResolvedValue("ok");
  mocks.buildWorkspaceContext.mockReset().mockResolvedValue("");
  mocks.retrieveProjectChunks.mockReset().mockResolvedValue([]);
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
  useSettingsStore.setState({ chatFloating: false, figureModeOpen: false });
  useAgentTurnsStore.getState().reset();
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
  const rendered = render(createElement(ChatCore));
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

function plainTranscript(messages: ModelMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

describe("ChatCore agent turns", () => {
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

  it("steers a queued follow-up into the active backend run", async () => {
    const rendered = await renderChat();
    submit(rendered, "First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    submit(rendered, "Use this now");
    fireEvent.click(rendered.getByRole("button", { name: "Steer now" }));

    await waitFor(() => {
      expect(mocks.agentSteer).toHaveBeenCalledWith("request-1", "Use this now");
      expect(rendered.getByText("Steered into the running turn: Use this now")).toBeTruthy();
    });

    await act(async () => finishRun(0, "First response"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(mocks.runs).toHaveLength(1);
  });

  it("uses a persisted project approval without showing ToolConfirm", async () => {
    mocks.approvalsList.mockResolvedValue({ write_file: "allow" });
    const rendered = await renderChat();
    submit(rendered, "Update the file");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    mocks.runs[0].options.handlers.onToolCall({
      id: "call-1",
      name: "write_file",
      args: { path: "main.tex" },
    });
    const result = await mocks.runs[0].options.tools.write_file.execute?.({
      path: "main.tex",
    });

    expect(result).toEqual({ approved: true });
    expect(rendered.queryByRole("alertdialog", { name: "Confirm AI edit" })).toBeNull();

    await act(async () => finishRun(0, "Updated"));
  });
});
