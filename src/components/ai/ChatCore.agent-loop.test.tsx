import { JSDOM } from "jsdom";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@oleafly/ai-core";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import type { ChatMessage, StoredChat } from "@/store/chats";

interface HarnessOptions {
  messages: ModelMessage[];
  tools: ToolSet;
  onRequestId?: (requestId: string) => void;
  onRawEvent?: (event: AgentEvent) => void;
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

vi.mock("./agent-turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-turn")>()),
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
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
    HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
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
    fireEvent.click(steerButton);
    fireEvent.click(steerButton);

    await waitFor(() => {
      expect(mocks.agentSteer).toHaveBeenCalledWith("request-1", {
        role: "user",
        content: [{ type: "text", text: "Use this now" }],
      });
    });
    expect(mocks.agentSteer).toHaveBeenCalledTimes(1);
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

  it("never auto-approves a persisted shell allow decision", async () => {
    mocks.approvalsList.mockResolvedValue({ run_command: "allow" });
    const rendered = await renderChat();
    submit(rendered, "Run a command");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    mocks.runs[0].options.handlers.onToolCall({
      id: "call-1",
      name: "run_command",
      args: { command: "echo unsafe" },
    });
    const result = mocks.runs[0].options.tools.run_command.execute?.({
      command: "echo unsafe",
    });

    await waitFor(() =>
      expect(rendered.getByRole("alertdialog", { name: "Confirm command" })).toBeTruthy(),
    );
    fireEvent.click(rendered.getByRole("button", { name: "Reject" }));
    await expect(result).resolves.toEqual({ approved: false });
    await act(async () => finishRun(0, "Not run"));
  });
});
