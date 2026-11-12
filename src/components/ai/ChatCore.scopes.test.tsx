import { JSDOM } from "jsdom";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentUsage } from "@oleafly/ai-core";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import type { ChatMessage, StoredChat } from "@/store/chats";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };

interface RunOutcome {
  text: string;
  usage: { input: number; output: number };
  steps: number;
  stopped_at_cap: boolean;
  error: string | null;
  stop_reason?: string | null;
  error_kind?: string | null;
}

interface HarnessOptions {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  signal?: AbortSignal;
  threadId?: string;
  clientTurnId?: string;
  effort?: string;
  web?: { search: boolean; fetch: boolean };
  onRequestId?: (requestId: string) => void;
  handlers: {
    onStep?: (step: number) => void;
    onText: (text: string) => void;
    onToolCall: (call: { id: string; name: string; args: unknown }) => void | Promise<void>;
    onToolResult: (result: { id: string; output: unknown }) => void;
    onUsage?: (
      usage: AgentUsage,
      extras?: { lastStep?: AgentUsage; contextWindow?: number },
    ) => void;
    onRetry?: (attempt: number, max: number) => void;
    onNotice?: (code: string, detail: string | null) => void;
    onReasoningStart?: () => void;
    onReasoningDelta?: (chunk: string) => void;
    onReasoningEnd?: () => void;
  };
}

interface PendingRun {
  options: HarnessOptions;
  resolve: (outcome: RunOutcome) => void;
}

interface MessageItemProps {
  msg: ChatMessage;
  live?: boolean;
  regenerateKind?: "regenerate" | "retry";
  editable?: boolean;
  onMessageAction?: (action: "regenerate" | "edit", messageId: string) => void;
}

const { EFFORT_MODEL } = vi.hoisted(() => ({ EFFORT_MODEL: "gpt-effort" }));

const mocks = vi.hoisted(() => ({
  runs: [] as PendingRun[],
  runAgentHarness: vi.fn(),
  agentProbeModel: vi.fn(),
  agentWebSearchReady: vi.fn(),
  agentSteer: vi.fn(),
  agentThreadRead: vi.fn(),
  agentThreadArchive: vi.fn(),
  agentThreadFork: vi.fn(),
  agentThreadRollback: vi.fn(),
  agentThreadDelete: vi.fn(),
  claimPrewarmed: vi.fn(),
  providerCredit: vi.fn(),
  approvalsList: vi.fn(),
  approvalsSet: vi.fn(),
  approvalsModeGet: vi.fn(),
  approvalsModeSet: vi.fn(),
  chatRead: vi.fn(),
  getConfig: vi.fn(),
  gitHeadOid: vi.fn(),
  gitLog: vi.fn(),
  gitShow: vi.fn(),
  gitStatus: vi.fn(),
  mcpAgentToolsList: vi.fn(),
  readFileContent: vi.fn(),
  flushOpenFilesToDisk: vi.fn(),
  agentTurnBegin: vi.fn(),
  agentTurnFinish: vi.fn(),
  agentTurnStatus: vi.fn(),
  agentTurnRevert: vi.fn(),
  checkProjectBudget: vi.fn(),
  buildWorkspaceContext: vi.fn(),
  retrieveProjectChunks: vi.fn(),
  toastError: vi.fn(),
  toastErrorUnique: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
  logError: vi.fn(),
  refetchSkills: vi.fn(),
  skillEntries: [] as Array<Record<string, unknown>>,
  storeToolImage: vi.fn(),
  attachmentObjectUrl: vi.fn(),
  queryUsageReport: vi.fn(),
  exportChatMarkdown: vi.fn(),
  shimmerText: null as string | null,
  messageItemProps: [] as MessageItemProps[],
  modelSelectorProps: null as null | {
    modelId?: string;
    onChange?: (providerId: string, modelId: string) => void;
  },
  historyProps: null as null | {
    open: boolean;
    skipped?: number;
    onOpen: (chat: StoredChat) => void;
    onDelete: (chatId: string) => void;
  },
}));

const { attachmentStore, attachmentReadFailures, normalizeExtras } = vi.hoisted(() => ({
  attachmentStore: new Map<string, { name: string; mime: string; bytes: Uint8Array }>(),
  attachmentReadFailures: new Set<string>(),
  normalizeExtras: new Map<string, Record<string, unknown>>(),
}));

vi.mock("./agent-turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-turn")>()),
  runAgentHarness: (options: HarnessOptions) => mocks.runAgentHarness(options),
}));

vi.mock("@oleafly/ai-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/ai-core")>()),
  effortChoicesFor: (_providerId: string, modelId: string) =>
    modelId === EFFORT_MODEL ? ["low", "medium", "high"] : [],
}));

vi.mock("@/lib/agent-backend", () => ({
  agentSteer: (...args: unknown[]) => mocks.agentSteer(...args),
  agentThreadRead: (...args: unknown[]) => mocks.agentThreadRead(...args),
  agentThreadArchive: (...args: unknown[]) => mocks.agentThreadArchive(...args),
  agentThreadFork: (...args: unknown[]) => mocks.agentThreadFork(...args),
  agentThreadRollback: (...args: unknown[]) => mocks.agentThreadRollback(...args),
  agentThreadDelete: (...args: unknown[]) => mocks.agentThreadDelete(...args),
  agentThreadClaimPrewarmed: (...args: unknown[]) => mocks.claimPrewarmed(...args),
  providerCredit: (...args: unknown[]) => mocks.providerCredit(...args),
}));

vi.mock("@/lib/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/attachments")>();
  return {
    ...actual,
    attachmentPut: async (_scope: string | null, name: string, mime: string, bytes: Uint8Array) => {
      const sha256 = `sha-${name}`;
      attachmentStore.set(sha256, { name, mime, bytes });
      return { sha256, name, mime, size: bytes.length, pages: null, hasText: false };
    },
    attachmentPutText: async (_scope: string | null, sha256: string) => {
      const entry = attachmentStore.get(sha256);
      return {
        sha256,
        name: entry?.name ?? "",
        mime: entry?.mime ?? "",
        size: 0,
        pages: null,
        hasText: true,
      };
    },
    attachmentRead: async (_scope: string | null, sha256: string) => {
      const entry = attachmentStore.get(sha256);
      if (!entry) throw new Error("missing");
      return entry.bytes.slice().buffer;
    },
    attachmentText: async (_scope: string | null, sha256: string) => {
      if (attachmentReadFailures.has(sha256)) throw new Error("attachment store unavailable");
      const entry = attachmentStore.get(sha256);
      return entry ? new TextDecoder().decode(entry.bytes) : null;
    },
    attachmentGc: async () => 0,
    storeToolImage: (...args: unknown[]) => mocks.storeToolImage(...args),
    attachmentObjectUrl: (...args: unknown[]) => mocks.attachmentObjectUrl(...args),
  };
});

vi.mock("@/lib/attachments-normalize", () => ({
  normalizeAttachment: async (file: File) => ({
    name: file.name,
    mime: file.type || "text/plain",
    bytes: new TextEncoder().encode(await file.text()),
    ...normalizeExtras.get(file.name),
  }),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  agentProbeModel: (...args: unknown[]) => mocks.agentProbeModel(...args),
  agentWebSearchReady: (...args: unknown[]) => mocks.agentWebSearchReady(...args),
  approvalsList: (...args: unknown[]) => mocks.approvalsList(...args),
  approvalsSet: (...args: unknown[]) => mocks.approvalsSet(...args),
  approvalsModeGet: (...args: unknown[]) => mocks.approvalsModeGet(...args),
  approvalsModeSet: (...args: unknown[]) => mocks.approvalsModeSet(...args),
  chatRead: (...args: unknown[]) => mocks.chatRead(...args),
  getConfig: (...args: unknown[]) => mocks.getConfig(...args),
  gitHeadOid: (...args: unknown[]) => mocks.gitHeadOid(...args),
  gitLog: (...args: unknown[]) => mocks.gitLog(...args),
  gitShow: (...args: unknown[]) => mocks.gitShow(...args),
  gitStatus: (...args: unknown[]) => mocks.gitStatus(...args),
  mcpAgentToolsList: (...args: unknown[]) => mocks.mcpAgentToolsList(...args),
  readFileContent: (...args: unknown[]) => mocks.readFileContent(...args),
}));

vi.mock("@/lib/external-file-changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external-file-changes")>()),
  flushOpenFilesToDisk: (...args: unknown[]) => mocks.flushOpenFilesToDisk(...args),
}));

vi.mock("@/lib/agent-turns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-turns")>()),
  agentTurnBegin: (...args: unknown[]) => mocks.agentTurnBegin(...args),
  agentTurnFinish: (...args: unknown[]) => mocks.agentTurnFinish(...args),
  agentTurnStatus: (...args: unknown[]) => mocks.agentTurnStatus(...args),
  agentTurnRevert: (...args: unknown[]) => mocks.agentTurnRevert(...args),
}));

vi.mock("@/lib/ai-budget", () => ({
  checkProjectBudget: (...args: unknown[]) => mocks.checkProjectBudget(...args),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    errorUnique: (...args: unknown[]) => mocks.toastErrorUnique(...args),
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    info: (...args: unknown[]) => mocks.toastInfo(...args),
  },
}));

vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mocks.logError(...args),
}));

vi.mock("@/lib/ai-context", () => ({
  buildWorkspaceContext: (...args: unknown[]) => mocks.buildWorkspaceContext(...args),
}));

vi.mock("@/lib/ai-rag", () => ({
  formatRagContext: () => "",
  retrieveProjectChunks: (...args: unknown[]) => mocks.retrieveProjectChunks(...args),
}));

vi.mock("@/lib/usage-report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage-report")>()),
  queryUsageReport: (...args: unknown[]) => mocks.queryUsageReport(...args),
}));

vi.mock("@/lib/chat-export", () => ({
  exportChatMarkdown: (...args: unknown[]) => mocks.exportChatMarkdown(...args),
}));

vi.mock("@/lib/skills", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/skills")>()),
  useSkills: () => ({ data: mocks.skillEntries, refetch: mocks.refetchSkills }),
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
        create: () => ({
          read_file: { execute: async () => ({ content: "" }) },
          update_todos: { execute: async () => ({ ok: true }) },
        }),
      },
      {
        id: "figure-tools",
        mode: "chat",
        source: { kind: "figure" },
        create: ({ onImage }: { onImage?: (dataUrl: string) => void }) => ({
          preview_figure: { execute: async () => ({ success: true }) },
          insert_figure: { execute: async () => ({ success: true }) },
          load_image: {
            execute: async (input: unknown) => {
              const image = (input as { image?: string } | null)?.image;
              if (image) onImage?.(image);
              return { loaded: true };
            },
          },
        }),
      },
    ],
  },
}));

vi.mock("@/components/ai/AttachmentChips", async () => {
  const React = await import("react");
  return {
    AttachmentChips: ({
      items,
      onRemove,
    }: {
      items: Array<{ id: string; name: string; status?: string }>;
      onRemove?: (id: string) => void;
    }) =>
      React.createElement(
        "div",
        null,
        items.map((item) =>
          React.createElement(
            React.Fragment,
            { key: item.id },
            React.createElement("span", { "data-status": item.status }, item.name),
            React.createElement("button", {
              type: "button",
              "aria-label": `Remove attachment ${item.name}`,
              onClick: () => onRemove?.(item.id),
            }),
          ),
        ),
      ),
  };
});

vi.mock("@/components/ai/ChatHistoryModal", () => ({
  ChatHistoryModal: (props: NonNullable<typeof mocks.historyProps>) => {
    mocks.historyProps = props;
    return null;
  },
}));

vi.mock("@/components/ai/ModelSelector", async () => {
  const React = await import("react");
  return {
    ModelSelector: (props: NonNullable<typeof mocks.modelSelectorProps>) => {
      mocks.modelSelectorProps = props;
      return React.createElement(
        "button",
        { "aria-label": "AI model", type: "button" },
        props.modelId ?? "Select a model",
      );
    },
  };
});

vi.mock("@/components/ai/SubagentActivity", () => ({
  SubagentActivity: () => null,
}));

vi.mock("@/store/acp-sessions", () => {
  const state = {
    open: async () => undefined,
    permissions: {} as Record<string, unknown[]>,
  };
  const useAcpSessionsStore = Object.assign(
    <T,>(selector: (value: typeof state) => T) => selector(state),
    { getState: () => state },
  );
  return { useAcpSessionsStore, attachAcpListeners: async () => () => {} };
});

vi.mock("@/components/branding/OleaflyAssistantMascot", () => ({
  OleaflyAssistantMascot: () => null,
}));

vi.mock("@/components/ai/chat-parts", async () => {
  const React = await import("react");
  return {
    AgentStatusPill: () => React.createElement("div", { "data-testid": "agent-status-pill" }),
    AgentRunSummary: () => React.createElement("div", { "data-testid": "agent-run-summary" }),
    InfoHint: () => null,
    MessageItem: (props: MessageItemProps) => {
      mocks.messageItemProps.push(props);
      return null;
    },
    Shimmer: ({ text }: { text: string }) => {
      mocks.shimmerText = text;
      return null;
    },
    formatError: (error: unknown, _label?: string, kind?: string | null) =>
      kind ? `[${kind}] ${String(error)}` : String(error),
    formatToolOutput: (output: unknown) =>
      typeof output === "string" ? output : JSON.stringify(output),
  };
});

let ChatCore: typeof import("./ChatCore").ChatCore;
let resetProviderConfigCache: typeof import("./provider-config").resetProviderConfigCache;
let LATEX_ENGINE: typeof import("@/lib/document-engine").LATEX_ENGINE;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let useChatsStore: typeof import("@/store/chats").useChatsStore;
let useComposerDrafts: typeof import("@/store/composer-drafts").useComposerDrafts;
let useSettingsStore: typeof import("@/store/settings").useSettingsStore;
let useApprovalModeStore: typeof import("@/store/approval-mode").useApprovalModeStore;
let useAgentTurnsStore: typeof import("@/store/agent-turns").useAgentTurnsStore;
let useAgentTodoStore: typeof import("@/store/agent-todos").useAgentTodoStore;
let useAgentFileChangesStore: typeof import("@/store/agent-file-changes").useAgentFileChangesStore;
let usePlanModeStore: typeof import("@/store/plan-mode").usePlanModeStore;
let usePlanApprovalStore: typeof import("@/store/plan-approval").usePlanApprovalStore;
let useChatGoalStore: typeof import("@/store/chat-goal").useChatGoalStore;
let useAiToolSettingsStore: typeof import("@/store/ai-tool-settings").useAiToolSettingsStore;
let useAssistantRuntimeStore: typeof import("@/store/assistant-runtime").useAssistantRuntimeStore;
let useAgentHandoffStore: typeof import("@/store/agent-handoff").useAgentHandoffStore;
let activeChatRun: typeof import("./chat-run-registry").activeChatRun;
let endChatRun: typeof import("./chat-run-registry").endChatRun;
let act: typeof import("@testing-library/react").act;
let cleanup: typeof import("@testing-library/react").cleanup;
let fireEvent: typeof import("@testing-library/react").fireEvent;
let render: typeof import("@testing-library/react").render;
let waitFor: typeof import("@testing-library/react").waitFor;
let within: typeof import("@testing-library/react").within;
let createElement: typeof import("react").createElement;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let createAppQueryClient: typeof import("@/lib/query").createAppQueryClient;
let projectSequence = 0;
let AssistantScopeProvider: typeof import("./assistant-scope").AssistantScopeProvider;
let WORKSPACE_FEATURES: typeof import("./assistant-scope").WORKSPACE_FEATURES;
let shownChats: typeof import("@/store/chats").shownChats;
let Fragment: typeof import("react").Fragment;

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
  await (await import("./acp/tests/ui-fixtures")).initTestI18n();
  ({ createElement } = await import("react"));
  ({ act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ createAppQueryClient } = await import("@/lib/query"));
  ({ ChatCore } = await import("./ChatCore"));
  ({ AssistantScopeProvider, WORKSPACE_FEATURES } = await import("./assistant-scope"));
  ({ shownChats } = await import("@/store/chats"));
  ({ Fragment } = await import("react"));
  ({ resetProviderConfigCache } = await import("./provider-config"));
  ({ LATEX_ENGINE } = await import("@/lib/document-engine"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ useChatsStore } = await import("@/store/chats"));
  ({ useComposerDrafts } = await import("@/store/composer-drafts"));
  ({ useSettingsStore } = await import("@/store/settings"));
  ({ useApprovalModeStore } = await import("@/store/approval-mode"));
  ({ useAgentTurnsStore } = await import("@/store/agent-turns"));
  ({ useAgentTodoStore } = await import("@/store/agent-todos"));
  ({ useAgentFileChangesStore } = await import("@/store/agent-file-changes"));
  ({ usePlanModeStore } = await import("@/store/plan-mode"));
  ({ usePlanApprovalStore } = await import("@/store/plan-approval"));
  ({ useChatGoalStore } = await import("@/store/chat-goal"));
  ({ useAiToolSettingsStore } = await import("@/store/ai-tool-settings"));
  ({ useAssistantRuntimeStore } = await import("@/store/assistant-runtime"));
  ({ useAgentHandoffStore } = await import("@/store/agent-handoff"));
  ({ activeChatRun, endChatRun } = await import("./chat-run-registry"));
  await import("@/components/usage/UsageReport");
  await import("./usage/UsagePopover");
  await import("@/lib/attachments-intake");
  await import("@/lib/chat-attachments");
}, 60_000);

afterEach(() => cleanup());

beforeEach(() => {
  const active = activeChatRun();
  if (active) endChatRun(active);
  resetProviderConfigCache();
  mocks.runs.length = 0;
  mocks.messageItemProps.length = 0;
  mocks.modelSelectorProps = null;
  mocks.historyProps = null;
  mocks.shimmerText = null;
  attachmentStore.clear();
  attachmentReadFailures.clear();
  normalizeExtras.clear();
  mocks.agentProbeModel
    .mockReset()
    .mockResolvedValue({ verdict: "verified", reason: "", probedAt: 1 });
  mocks.agentWebSearchReady.mockReset().mockResolvedValue(true);
  mocks.agentSteer.mockReset().mockResolvedValue({ status: "delivered" });
  mocks.agentThreadRead.mockReset().mockResolvedValue([]);
  mocks.agentThreadArchive.mockReset().mockResolvedValue(true);
  mocks.agentThreadFork.mockReset().mockResolvedValue("thread-forked");
  mocks.agentThreadRollback.mockReset().mockResolvedValue([]);
  mocks.agentThreadDelete.mockReset().mockResolvedValue(undefined);
  mocks.claimPrewarmed.mockReset().mockResolvedValue(null);
  mocks.providerCredit.mockReset().mockResolvedValue(null);
  mocks.approvalsList.mockReset().mockResolvedValue({});
  mocks.approvalsSet.mockReset().mockResolvedValue(undefined);
  mocks.approvalsModeGet.mockReset().mockResolvedValue("approve-for-me");
  mocks.approvalsModeSet.mockReset().mockResolvedValue(undefined);
  mocks.chatRead.mockReset().mockRejectedValue(new Error("no chat file"));
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
  mocks.gitHeadOid.mockReset().mockResolvedValue(null);
  mocks.gitLog.mockReset().mockResolvedValue([]);
  mocks.gitShow.mockReset().mockResolvedValue("");
  mocks.gitStatus.mockReset().mockResolvedValue([]);
  mocks.mcpAgentToolsList.mockReset().mockResolvedValue([]);
  mocks.readFileContent.mockReset().mockResolvedValue("");
  mocks.flushOpenFilesToDisk.mockReset().mockResolvedValue(undefined);
  mocks.agentTurnBegin.mockReset().mockResolvedValue({ snapshotId: "snap-1", unavailable: null });
  mocks.agentTurnFinish.mockReset().mockResolvedValue({
    snapshotId: "snap-1",
    files: [],
    moreFiles: 0,
    skipped: [],
    overlapped: false,
    unavailable: null,
  });
  mocks.agentTurnStatus.mockReset().mockResolvedValue({ expired: false, files: [] });
  mocks.agentTurnRevert.mockReset();
  mocks.checkProjectBudget.mockReset().mockResolvedValue("ok");
  mocks.buildWorkspaceContext.mockReset().mockResolvedValue("");
  mocks.retrieveProjectChunks.mockReset().mockResolvedValue([]);
  mocks.toastError.mockReset();
  mocks.toastErrorUnique.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastInfo.mockReset();
  mocks.logError.mockReset().mockResolvedValue(undefined);
  mocks.refetchSkills.mockReset().mockResolvedValue(undefined);
  mocks.skillEntries.length = 0;
  mocks.storeToolImage.mockReset().mockResolvedValue(null);
  mocks.attachmentObjectUrl.mockReset().mockResolvedValue("blob:attachment");
  mocks.queryUsageReport
    .mockReset()
    .mockResolvedValue({ totals: { costKnownRecords: 0, estimatedCostUsd: 0 } });
  mocks.exportChatMarkdown.mockReset().mockResolvedValue("saved");
  mocks.runAgentHarness.mockReset().mockImplementation(
    (options: HarnessOptions) =>
      new Promise((resolve) => {
        options.onRequestId?.(`request-${mocks.runs.length + 1}`);
        options.handlers.onStep?.(0);
        mocks.runs.push({ options, resolve });
      }),
  );
  try {
    localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    void 0;
  }
  const projectId = `composer-project-${++projectSequence}`;
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
    tree: [],
  });
  useChatsStore.setState({
    projectId,
    chats: [chat],
    activeId: chat.id,
    live: {},
    saveProblems: {},
    skippedOnLoad: 0,
  });
  useComposerDrafts.setState({ drafts: {} });
  useSettingsStore.setState({
    chatFloating: false,
    settingsInitialSection: "general",
    settingsOpen: false,
    settingsScrollTarget: null,
    aiComposerHeight: 56,
  });
  useApprovalModeStore.setState({ modes: {}, loaded: {}, persisted: {} });
  useAgentTurnsStore.getState().reset();
  useAgentTodoStore.getState().clear();
  useAgentFileChangesStore.setState({ turns: {}, activeTurnByChat: {}, lastTurnByChat: {} });
  usePlanModeStore.setState({ enabledByProject: {}, loaded: {} });
  usePlanApprovalStore.setState({ byChat: {}, loaded: {} });
  useChatGoalStore.setState({ goalsByProject: {}, loaded: {} });
  useAiToolSettingsStore.setState({ enabledByName: {} });
  useAssistantRuntimeStore.setState({ runtime: "built-in", handoffRuntime: null });
  useAgentHandoffStore.setState({ pendingPrompt: null, autoSend: false, pendingImages: [] });
});


const NOTE_SCOPE = "note:note-1";

interface ScopedRun extends HarnessOptions {
  projectId?: string | null;
  networkNeedsApproval?: boolean;
  guardToolCall?: (call: { id: string; name: string; args: unknown }) => string | null;
}

const noteCalls = vi.hoisted(() => ({
  context: vi.fn(async (_query: string) => "NOTE CONTEXT"),
  setRuntime: vi.fn(),
  pick: vi.fn((_provider: string, _model: string) => true),
  readNote: vi.fn(async () => ({ markdown: "# Masks" })),
}));

type ScopeValue = import("./assistant-scope").AssistantScopeValue;
type LayoutParts = import("./assistant-scope").AssistantLayoutParts;

function noteScope(overrides: Partial<ScopeValue> = {}): ScopeValue {
  return {
    key: NOTE_SCOPE,
    kind: "note",
    projectId: "note-1",
    projectName: "Masks",
    projectKind: "note",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    tree: [{ path: "assets/plot.png", is_dir: false }],
    currentProjectId: () => "note-1",
    currentTree: () => [{ path: "assets/plot.png", is_dir: false }],
    mainDoc: () => "note.md",
    cachedContent: () => undefined,
    toolAdditions: (run) => [
      {
        id: "note",
        source: { kind: "project" },
        tools: {
          read_note: {
            description: "Read the note",
            execute: async () => {
              expect(run.projectId).toBe("note-1");
              return noteCalls.readNote();
            },
          },
        },
      },
    ],
    excludedNames: ["read_file"],
    contextBlock: (query) => noteCalls.context(query),
    networkNeedsApproval: true,
    systemPrompt: (input) => `NOTE PROMPT tools=${input.tools.join(",")} ctx=${input.context}`,
    guardToolCall: (call) =>
      (call.args as { path?: string } | null)?.path === "note.md" ? "Use propose_note_edits for note.md" : null,
    setRuntime: noteCalls.setRuntime,
    features: {
      ...WORKSPACE_FEATURES,
      checkpoints: false,
      turnChanges: false,
      outputs: false,
      handoff: false,
      figures: false,
      promptShortcuts: false,
      homeSuggestions: false,
    },
    composer: {
      placeholder: "Ask about this note",
      modelGroups: [{ id: "cli", name: "CLI agents", models: [{ id: "claude", name: "Claude" }] }],
      onPickModelGroup: (provider, model) => provider === "cli" && noteCalls.pick(provider, model),
      slashCommands: (send) => [
        {
          id: "research:proofread",
          label: "Proofread selection",
          description: "Works on this note",
          icon: () => null,
          action: () => send("Proofread the note."),
        },
      ],
      frame: (node, working) => createElement("div", { "data-testid": "note-frame", "data-working": String(working) }, node),
      textareaLabel: "Note assistant",
    },
    layout: {
      render: (parts: LayoutParts) =>
        createElement(
          "section",
          { "data-testid": "note-layout", "data-working": String(parts.working), "data-messages": String(parts.hasMessages) },
          createElement("div", { ref: parts.scrollRef, onScroll: parts.onScroll }, parts.messages),
          parts.footer,
          parts.setup ?? parts.composer,
          parts.dialogs,
          createElement("button", { type: "button", "data-testid": "note-new-chat", onClick: parts.newChat }),
          createElement("button", { type: "button", "data-testid": "note-history", onClick: parts.openHistory }),
          createElement("button", { type: "button", "data-testid": "note-stop", onClick: parts.stop }),
          createElement("output", { "data-testid": "note-chat-count" }, String(parts.chatCount)),
        ),
    },
    ...overrides,
  };
}

async function renderBoth(scope: ScopeValue = noteScope()): Promise<RenderResult> {
  const rendered = render(
    createElement(
      QueryClientProvider,
      { client: createAppQueryClient() },
      createElement(
        Fragment,
        null,
        createElement(ChatCore),
        createElement(AssistantScopeProvider, { value: scope, children: createElement(ChatCore) }),
      ),
    ),
  );
  await waitFor(() => {
    expect(rendered.container.querySelector('[data-tour-configured="true"]')).not.toBeNull();
    expect(rendered.getByTestId("note-layout").querySelector("[data-chat-composer] textarea")).not.toBeNull();
  });
  return rendered;
}

function workspaceBox(): HTMLTextAreaElement {
  const box = document.querySelector('[data-tour="ai-assistant"] [data-chat-composer] textarea');
  if (!(box instanceof HTMLTextAreaElement)) throw new Error("workspace composer missing");
  return box;
}

function noteBox(): HTMLTextAreaElement {
  const box = document.querySelector('[data-testid="note-layout"] [data-chat-composer] textarea');
  if (!(box instanceof HTMLTextAreaElement)) throw new Error("note composer missing");
  return box;
}

function sendIn(box: HTMLTextAreaElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

async function finish(index: number, text: string) {
  await act(async () => {
    const run = mocks.runs[index];
    run.options.handlers.onText(text);
    run.resolve({ text, usage: { input: 1, output: 1 }, steps: 1, stopped_at_cap: false, error: null });
  });
}

describe("two assistant scopes side by side", () => {
  beforeEach(() => {
    noteCalls.context.mockClear();
    noteCalls.setRuntime.mockClear();
    noteCalls.pick.mockClear();
    noteCalls.readNote.mockClear();
    const running = activeChatRun(NOTE_SCOPE);
    if (running) endChatRun(running);
    useChatsStore.setState({ shownByScope: {} });
  });

  it("runs a note turn while a workspace turn is still running, each in its own project", async () => {
    const workspaceProject = useFilesStore.getState().projectId;
    await renderBoth();
    sendIn(workspaceBox(), "Fix the build");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    sendIn(noteBox(), "Plan the ablation");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));

    const workspaceRun = mocks.runs[0].options as ScopedRun;
    const noteRun = mocks.runs[1].options as ScopedRun;
    expect(workspaceRun.projectId).toBe(workspaceProject);
    expect(noteRun.projectId).toBe("note-1");
    expect(activeChatRun()?.projectId).toBe(workspaceProject);
    expect(activeChatRun(NOTE_SCOPE)?.projectId).toBe("note-1");
    expect(useAgentTurnsStore.getState().queuedByChat["chat-1"] ?? []).toEqual([]);

    expect(noteRun.system).toContain("NOTE PROMPT");
    expect(noteRun.networkNeedsApproval).toBe(true);
    expect(workspaceRun.networkNeedsApproval).toBeUndefined();
    expect(noteRun.system).toContain("ctx=NOTE CONTEXT");
    expect(noteRun.system).not.toContain("You are Oleafly AI");
    expect(workspaceRun.system).toContain("You are Oleafly AI");
    expect(noteCalls.context).toHaveBeenCalledWith("Plan the ablation");
    expect(mocks.buildWorkspaceContext).toHaveBeenCalledTimes(1);
    expect(Object.keys(noteRun.tools)).toContain("read_note");
    expect(Object.keys(noteRun.tools)).not.toContain("read_file");
    expect(Object.keys(workspaceRun.tools)).toContain("read_file");
    expect(Object.keys(workspaceRun.tools)).not.toContain("read_note");
    expect(await noteRun.tools.read_note.execute?.({})).toEqual({ markdown: "# Masks" });

    expect(noteRun.guardToolCall?.({ id: "1", name: "write_file", args: { path: "note.md" } })).toBe(
      "Use propose_note_edits for note.md",
    );
    expect(noteRun.guardToolCall?.({ id: "2", name: "write_file", args: { path: "assets/a.csv" } })).toBeNull();
    expect(workspaceRun.guardToolCall?.({ id: "3", name: "write_file", args: { path: "note.md" } })).toBeNull();
    expect(mocks.agentTurnBegin).toHaveBeenCalledTimes(1);
    expect(mocks.agentTurnBegin).toHaveBeenCalledWith(workspaceProject, expect.any(String));
    expect(screen().getByTestId("note-layout")).toHaveAttribute("data-working", "true");
    expect(screen().getByTestId("note-frame")).toHaveAttribute("data-working", "true");

    await finish(1, "Here is a plan.");
    await waitFor(() => expect(activeChatRun(NOTE_SCOPE)).toBeNull());
    expect(activeChatRun()).not.toBeNull();
    const noteChats = shownChats(useChatsStore.getState(), NOTE_SCOPE).chats;
    expect(noteChats).toHaveLength(1);
    expect(noteChats[0].projectId).toBe("note-1");
    expect(noteChats[0].messages.at(-1)?.content).toBe("Here is a plan.");
    expect(useChatsStore.getState().chats.map((chat) => chat.id)).toEqual(["chat-1"]);
    expect(screen().getByTestId("note-chat-count")).toHaveTextContent("1");

    await finish(0, "Build fixed.");
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(useChatsStore.getState().byId("chat-1")?.messages.at(-1)?.content).toBe("Build fixed.");
  });

  it("keeps a note run going when the workspace switches project, and stops only its own run", async () => {
    await renderBoth();
    sendIn(workspaceBox(), "Fix the build");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    sendIn(noteBox(), "Summarize");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));

    act(() => {
      useFilesStore.setState({ projectId: "another-paper", projectName: "Another" });
    });
    expect(mocks.runs[0].options.signal?.aborted).toBe(true);
    expect(mocks.runs[1].options.signal?.aborted).toBe(false);
    expect(activeChatRun(NOTE_SCOPE)).not.toBeNull();

    fireEvent.click(screen().getByTestId("note-stop"));
    expect(mocks.runs[1].options.signal?.aborted).toBe(true);
    await act(async () => {
      mocks.runs[1].resolve({ text: "", usage: { input: 0, output: 0 }, steps: 0, stopped_at_cap: false, error: null });
    });
    await waitFor(() => expect(activeChatRun(NOTE_SCOPE)).toBeNull());
  });

  it("keeps a project note's draft, goal and plan mode apart from its project's assistant", async () => {
    const project = useFilesStore.getState().projectId as string;
    useChatsStore.setState({ activeId: null });
    useChatGoalStore.getState().setGoal(project, "Ship the paper");
    usePlanModeStore.getState().setEnabled(project, true);
    await renderBoth(noteScope({ projectId: project, currentProjectId: () => project, storageKey: `${project}#plan` }));
    fireEvent.change(workspaceBox(), { target: { value: "Unsent project prompt" } });
    expect(noteBox()).toHaveValue("");
    const layout = screen().getByTestId("note-layout");
    expect(within(layout).queryByText("Ship the paper")).toBeNull();
    sendIn(noteBox(), "Plan the ablation");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(workspaceBox()).toHaveValue("Unsent project prompt");
    expect(useChatGoalStore.getState().goal(project)).toBe("Ship the paper");
    expect(usePlanModeStore.getState().isEnabled(`${project}#plan`)).toBe(false);
  });

  it("uses the scope's placeholder, label, slash commands and extra model groups", async () => {
    await renderBoth();
    expect(noteBox()).toHaveAttribute("placeholder", "Ask about this note");
    expect(noteBox()).toHaveAccessibleName("Note assistant");
    expect(workspaceBox()).toHaveAttribute("placeholder", enAi.composer.placeholderDefault);
    const groups = (mocks.modelSelectorProps as unknown as { groups: { id: string }[] }).groups.map((group) => group.id);
    expect(groups).toContain("cli");
    act(() => mocks.modelSelectorProps?.onChange?.("cli", "claude"));
    expect(noteCalls.pick).toHaveBeenCalledWith("cli", "claude");
    act(() => mocks.modelSelectorProps?.onChange?.("openai", "gpt-4o-mini"));
    expect(mocks.modelSelectorProps?.modelId).toBe("gpt-4o-mini");

    fireEvent.change(noteBox(), { target: { value: "/" } });
    fireEvent.click(await within(screen().getByTestId("note-layout")).findByText("Proofread selection"));
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(lastUserContentOf(0)).toContain("Proofread the note.");
    expect((mocks.runs[0].options as ScopedRun).projectId).toBe("note-1");
  });

  it("remembers the model picked in a scope that keeps model memory, on mount and on New chat", async () => {
    const memory = { saved: null as null | { providerId: string; modelId: string } };
    const modelMemory = {
      read: vi.fn(() => memory.saved),
      save: vi.fn((choice: { providerId: string; modelId: string }) => {
        memory.saved = choice;
      }),
    };
    const first = await renderBoth(noteScope({ modelMemory }));
    expect(mocks.modelSelectorProps?.modelId).toBe("gpt-4o");
    act(() => mocks.modelSelectorProps?.onChange?.("openai", "gpt-4o-mini"));
    expect(modelMemory.save).toHaveBeenCalledWith({ providerId: "openai", modelId: "gpt-4o-mini" });
    first.unmount();
    await renderBoth(noteScope({ modelMemory }));
    await waitFor(() => expect(mocks.modelSelectorProps?.modelId).toBe("gpt-4o-mini"));
    memory.saved = { providerId: "openai", modelId: "gpt-4.1" };
    act(() => fireEvent.click(screen().getByTestId("note-new-chat")));
    expect(mocks.modelSelectorProps?.modelId).toBe("gpt-4.1");
    memory.saved = { providerId: "anthropic", modelId: "claude" };
    act(() => fireEvent.click(screen().getByTestId("note-new-chat")));
    expect(mocks.modelSelectorProps?.modelId).toBe("gpt-4o");
  });

  it("starts a new note chat and opens the note's history from the layout", async () => {
    await renderBoth();
    sendIn(noteBox(), "First question");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await finish(0, "Answer");
    await waitFor(() => expect(activeChatRun(NOTE_SCOPE)).toBeNull());
    expect(screen().getByTestId("note-layout")).toHaveAttribute("data-messages", "true");
    fireEvent.click(screen().getByTestId("note-new-chat"));
    await waitFor(() => expect(screen().getByTestId("note-layout")).toHaveAttribute("data-messages", "false"));
    expect(shownChats(useChatsStore.getState(), NOTE_SCOPE).activeId).toBeNull();
    fireEvent.click(screen().getByTestId("note-history"));
    await waitFor(() => expect(mocks.historyProps?.open).toBe(true));
  });

  it("attaches the notes a message mentions and skips the workspace's checkpoints", async () => {
    const attachments = vi.fn(async (text: string) =>
      text.includes("note:Ablations")
        ? [{ id: "note-mention:note-2", name: "Ablations (note note-2)", mediaType: "text/plain", dataUrl: "data:text/plain;base64,QWJsYXRpb25z" }]
        : [],
    );
    const items = vi.fn(() => [{ id: "note-mention:note-2", label: "Ablations", kind: "file" as const, path: "note:Ablations" }]);
    mocks.gitLog.mockClear();
    await renderBoth(noteScope({ mentions: { paths: ["note:Ablations"], items, attachments } }));
    sendIn(noteBox(), 'Compare with @"note:Ablations" please');
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(attachments).toHaveBeenCalledWith('Compare with @"note:Ablations" please');
    expect(JSON.stringify(mocks.runs[0].options.messages.at(-1)?.content)).toContain("Ablations (note note-2)");
    expect(mocks.gitLog).not.toHaveBeenCalledWith("note-1");
    expect(mocks.gitHeadOid).not.toHaveBeenCalledWith("note-1");
    await finish(0, "Compared.");
    await waitFor(() => expect(activeChatRun(NOTE_SCOPE)).toBeNull());
    const chat = shownChats(useChatsStore.getState(), NOTE_SCOPE).chats[0];
    expect(chat.messages[0].mentions).toEqual(["note:Ablations"]);
  });

  it("shows the assistant's sign-in prompt in the note layout when no provider is set up", async () => {
    mocks.getConfig.mockResolvedValue({
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_keys: {},
      ai_provider_models: {},
      ai_custom_providers: [],
      ai_system_prompt: "",
      ai_personas: [],
    });
    render(
      createElement(
        QueryClientProvider,
        { client: createAppQueryClient() },
        createElement(AssistantScopeProvider, { value: noteScope(), children: createElement(ChatCore) }),
      ),
    );
    const layout = await waitFor(() => screen().getByTestId("note-layout"));
    await waitFor(() => expect(within(layout).getByText(enAi.provider.connectTitle)).toBeInTheDocument());
    expect(layout.querySelector("[data-chat-composer]")).toBeNull();
    fireEvent.click(within(layout).getByRole("button", { name: enAi.provider.connectButton }));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });
});

function screen() {
  return within(document.body);
}

function lastUserContentOf(index: number): string {
  const content = mocks.runs[index].options.messages.at(-1)?.content;
  return typeof content === "string" ? content : JSON.stringify(content);
}
