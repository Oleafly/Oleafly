import { JSDOM } from "jsdom";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentUsage } from "@oleafly/ai-core";
import type { ModelMessage, ToolSet } from "@/lib/chat-types";
import { TREE_DRAG_TYPE } from "@/lib/tree-drag";
import type { ChatMessage, ChatTurnChanges, StoredChat } from "@/store/chats";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };

// The built-in assistant's composer and the UI around it: drafts and
// attachments, effort and web per chat, the usage meter, and regenerate,
// retry, edit and resend. The agent loop itself is covered by
// ChatCore.agent-loop.test.tsx; the setup here follows that file.

interface RunOutcome {
  text: string;
  usage: { input: number; output: number };
  steps: number;
  stopped_at_cap: boolean;
  error: string | null;
  stop_reason?: string | null;
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

// The attachment store, in memory: a put returns `sha-<name>`.
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
  // One model offers effort levels; every other model has none.
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

// Normalizing keeps the file as it is; a test adds pages, text or page
// images for a file by name.
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
          // Hands the image it loaded to the run, as the real tool does.
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
    formatError: (error: unknown) => String(error),
    formatToolOutput: (output: unknown) =>
      typeof output === "string" ? output : JSON.stringify(output),
  };
});

let ChatCore: typeof import("./ChatCore").ChatCore;
let resetProviderConfigCache: typeof import("./provider-config").resetProviderConfigCache;
let LATEX_ENGINE: typeof import("@/lib/document-engine").LATEX_ENGINE;
let formatUsd: typeof import("@/lib/ai-pricing").formatUsd;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let useChatsStore: typeof import("@/store/chats").useChatsStore;
let useComposerDrafts: typeof import("@/store/composer-drafts").useComposerDrafts;
let builtinComposerId: typeof import("@/store/composer-drafts").builtinComposerId;
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
  ({ resetProviderConfigCache } = await import("./provider-config"));
  ({ LATEX_ENGINE } = await import("@/lib/document-engine"));
  ({ formatUsd } = await import("@/lib/ai-pricing"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ useChatsStore } = await import("@/store/chats"));
  ({ useComposerDrafts, builtinComposerId } = await import("@/store/composer-drafts"));
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
  // Load the lazy pieces before timing interactions with them.
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

async function renderChat(): Promise<RenderResult> {
  const rendered = render(
    createElement(
      QueryClientProvider,
      { client: createAppQueryClient() },
      createElement(ChatCore),
    ),
  );
  await waitFor(() => {
    expect(rendered.container.querySelector('[data-tour-configured="true"]')).not.toBeNull();
  });
  return rendered;
}

function composerBox(): HTMLTextAreaElement {
  const box = document.querySelector("[data-chat-composer] textarea");
  if (!(box instanceof HTMLTextAreaElement)) throw new Error("composer missing");
  return box;
}

function changeComposer(text: string) {
  fireEvent.change(composerBox(), { target: { value: text } });
}

function pressEnter() {
  fireEvent.keyDown(composerBox(), { key: "Enter" });
}

function sendFromComposer(text: string) {
  changeComposer(text);
  pressEnter();
}

async function completeRun(index: number, text: string, outcome: Partial<RunOutcome> = {}) {
  await act(async () => {
    const run = mocks.runs[index];
    run.options.handlers.onText(text);
    run.resolve({
      text,
      usage: { input: 0, output: 0 },
      steps: 1,
      stopped_at_cap: false,
      error: null,
      ...outcome,
    });
  });
  await waitFor(() => expect(activeChatRun()).toBeNull());
}

function lastUserContent(index: number) {
  return mocks.runs[index].options.messages.at(-1)?.content;
}

function plainTranscript(messages: ModelMessage[]) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function savedMessages(chatId = "chat-1"): ChatMessage[] {
  return useChatsStore.getState().byId(chatId)?.messages ?? [];
}

function seedChat(messages: ChatMessage[], extra: Partial<StoredChat> = {}) {
  useChatsStore.setState((state) => ({
    chats: state.chats.map((chat) =>
      chat.id === "chat-1" ? { ...chat, ...extra, messages } : chat,
    ),
  }));
}

function composerDraft() {
  // Each chat has its own draft; the chat on show is the active one.
  const { projectId, activeId } = { ...useFilesStore.getState(), ...useChatsStore.getState() };
  return useComposerDrafts.getState().drafts[builtinComposerId(projectId, activeId)];
}

function fileInput(rendered: RenderResult): HTMLInputElement {
  const input = rendered.container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("attachment input missing");
  return input;
}

async function attach(rendered: RenderResult, files: File[]) {
  fireEvent.change(fileInput(rendered), { target: { files } });
  for (const file of files) {
    await waitFor(() =>
      expect(rendered.getByText(file.name)).toHaveAttribute("data-status", "ready"),
    );
  }
}

function textFile(name: string, text: string) {
  return new File([text], name, { type: "text/plain", lastModified: 1 });
}

function imageFile(name: string) {
  return new File(["png-bytes"], name, { type: "image/png", lastModified: 1 });
}

function pdfFile(name: string, body = "%PDF-1.7") {
  return new File([body], name, { type: "application/pdf", lastModified: 1 });
}

function treeTransfer(path: string) {
  return {
    types: [TREE_DRAG_TYPE],
    files: [],
    effectAllowed: "move",
    dropEffect: "none",
    getData: (type: string) => (type === TREE_DRAG_TYPE ? path : ""),
  };
}

function configureModel(model: { id: string; name?: string; metadata?: Record<string, unknown> }) {
  mocks.getConfig.mockResolvedValue({
    ai_provider: "openai",
    ai_model: model.id,
    ai_api_key: "test-key",
    ai_keys: { openai: "test-key" },
    ai_provider_models: model.metadata
      ? {
          openai: [
            {
              id: model.id,
              name: model.name ?? model.id,
              enabled: true,
              source: "fetched",
              trust: "verified",
              metadata: model.metadata,
            },
          ],
        }
      : {},
    ai_model_probes: {},
    ai_custom_providers: [],
    ai_system_prompt: "",
    ai_personas: [],
  });
}

function textOnlyMetadata(name: string) {
  return {
    name,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCall: true,
    reasoning: false,
    attachment: true,
    structuredOutput: false,
    status: "active",
  };
}

function skillEntry(overrides: Record<string, unknown> & { id: string }): Record<string, unknown> {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function effortLabel(level: string) {
  return enAi.effort.ariaLabel.replace("{{level}}", level);
}

function pickEffort(rendered: RenderResult, name: string | RegExp) {
  fireEvent.pointerDown(rendered.getByTestId("ai-effort-selector"), { button: 0, ctrlKey: false });
  fireEvent.click(rendered.getByRole("menuitemradio", { name }));
}

function webToggle(rendered: RenderResult) {
  return rendered.getByRole("button", { name: enAi.web.ariaLabel });
}

function usageButton(rendered: RenderResult) {
  return rendered.getByRole("button", { name: enAi.header.usageAriaLabel });
}

function turnChangesFor(paths: string[]): ChatTurnChanges {
  return {
    snapshotId: "snap-1",
    files: paths.map((path, index) => ({
      index,
      path,
      change: "modified",
      beforeSize: 1,
      afterSize: 2,
      added: 1,
      removed: 1,
      alsoEditedHere: false,
      build: false,
    })),
    moreFiles: 0,
    skipped: [],
    overlapped: false,
    unavailable: null,
  };
}

/** The props the transcript last rendered for one message. */
function rowProps(messageId: string): MessageItemProps | undefined {
  for (let index = mocks.messageItemProps.length - 1; index >= 0; index -= 1) {
    const props = mocks.messageItemProps[index];
    if (props.msg.id === messageId) return props;
  }
  return undefined;
}

/** Runs a message action the way a click on its button does. */
async function messageAction(action: "regenerate" | "edit", messageId: string) {
  const onMessageAction = mocks.messageItemProps.at(-1)?.onMessageAction;
  if (!onMessageAction) throw new Error("message actions are not wired");
  await act(async () => {
    onMessageAction(action, messageId);
  });
}

describe("ChatCore composer, drafts and attachments", () => {
  it("keeps a draft's attachments when the panel remounts", async () => {
    const first = await renderChat();
    changeComposer("Compare with my notes");
    await attach(first, [textFile("notes.txt", "draft notes")]);
    first.unmount();

    const second = await renderChat();
    expect(composerBox()).toHaveValue("Compare with my notes");
    expect(second.getByText("notes.txt")).toHaveAttribute("data-status", "ready");

    pressEnter();
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(lastUserContent(0)).toEqual([
      { type: "text", text: "Compare with my notes" },
      { type: "text", text: 'Attached file "notes.txt":\n\ndraft notes' },
    ]);
    await waitFor(() => expect(second.queryByText("notes.txt")).toBeNull());
    expect(composerBox()).toHaveValue("");
    expect(composerDraft()).toBeUndefined();
    await completeRun(0, "Compared.");
  });

  it("keeps each project's draft when switching projects", async () => {
    const rendered = await renderChat();
    const firstProject = useFilesStore.getState().projectId as string;
    changeComposer("Draft for the first project");
    await attach(rendered, [textFile("first.txt", "first")]);

    act(() => {
      useFilesStore.setState({ projectId: "composer-project-other", projectName: "Other project" });
    });
    expect(composerBox()).toHaveValue("");
    expect(rendered.queryByText("first.txt")).toBeNull();
    changeComposer("Draft for the other project");

    act(() => {
      useFilesStore.setState({ projectId: firstProject, projectName: "Test project" });
    });
    expect(composerBox()).toHaveValue("Draft for the first project");
    expect(rendered.getByText("first.txt")).toHaveAttribute("data-status", "ready");
    expect(useComposerDrafts.getState().drafts["composer-project-other:builtin"]).toEqual({
      text: "Draft for the other project",
      attachments: [],
    });
  });

  it("sends image attachments by reference and inlines text files", async () => {
    normalizeExtras.set("scan.pdf", {
      pages: 3,
      pageImages: [{ mime: "image/png", bytes: new Uint8Array([1, 2]) }],
    });
    const rendered = await renderChat();
    await attach(rendered, [
      imageFile("plot.png"),
      textFile("notes.txt", "draft notes"),
      pdfFile("scan.pdf"),
    ]);

    sendFromComposer("Compare the plot, the notes and the scan");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(lastUserContent(0)).toEqual([
      { type: "text", text: "Compare the plot, the notes and the scan" },
      { type: "attachment", sha256: "sha-plot.png", name: "plot.png", mime: "image/png" },
      { type: "text", text: 'Attached file "notes.txt":\n\ndraft notes' },
      { type: "attachment", sha256: "sha-scan.pdf", name: "scan.pdf", mime: "application/pdf" },
      {
        type: "attachment",
        sha256: "sha-scan.pdf page 1.png",
        name: "scan.pdf page 1.png",
        mime: "image/png",
      },
    ]);
    await completeRun(0, "Compared.");
  });

  it("saves each attachment's hash, size and pages on the user message", async () => {
    normalizeExtras.set("paper.pdf", { pages: 12, text: "[Page 1]\nAbstract" });
    normalizeExtras.set("scan.pdf", {
      pages: 2,
      pageImages: [{ mime: "image/png", bytes: new Uint8Array([7]) }],
    });
    const rendered = await renderChat();
    await attach(rendered, [
      textFile("notes.txt", "draft notes"),
      pdfFile("paper.pdf", "%PDF-1.7 paper"),
      pdfFile("scan.pdf", "%PDF scan"),
    ]);

    sendFromComposer("Summarise the paper");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    const user = savedMessages().at(-2);
    expect(user).toMatchObject({ role: "user", content: "Summarise the paper" });
    expect(user?.turnId).toBe(mocks.runs[0].options.clientTurnId);
    expect(user?.attachments).toEqual([
      { name: "notes.txt", mediaType: "text/plain", sha256: "sha-notes.txt", size: 11, kind: "text" },
      {
        name: "paper.pdf",
        mediaType: "application/pdf",
        sha256: "sha-paper.pdf",
        size: 14,
        kind: "pdf",
        pages: 12,
        hasText: true,
      },
      {
        name: "scan.pdf",
        mediaType: "application/pdf",
        sha256: "sha-scan.pdf",
        size: 9,
        kind: "pdf",
        pages: 2,
        hasText: false,
        pageImages: [{ sha256: "sha-scan.pdf page 1.png", mime: "image/png" }],
      },
    ]);
    await completeRun(0, "Summarised.");
  });

  it("sends attachments again on the next message from recent turns", async () => {
    const rendered = await renderChat();
    await attach(rendered, [imageFile("plot.png"), textFile("notes.txt", "draft notes")]);
    sendFromComposer("Read these");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Read them.");

    sendFromComposer("What changed since then?");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Read these" },
          { type: "attachment", sha256: "sha-plot.png", name: "plot.png", mime: "image/png" },
          { type: "text", text: 'Attached file "notes.txt":\n\ndraft notes' },
        ],
      },
      { role: "assistant", content: "Read them." },
      { role: "user", content: "What changed since then?" },
    ]);
    await completeRun(1, "Nothing yet.");
  });

  it("waits for attachments that are still being prepared before sending", async () => {
    const rendered = await renderChat();
    const reading = deferred<string>();
    const slow = textFile("slow.txt", "unused");
    Object.defineProperty(slow, "text", { value: () => reading.promise });
    fireEvent.change(fileInput(rendered), { target: { files: [slow] } });
    await waitFor(() =>
      expect(rendered.getByText("slow.txt")).toHaveAttribute("data-status", "processing"),
    );

    sendFromComposer("Read the slow file");
    expect(rendered.getByRole("button", { name: enAi.composer.send })).toBeDisabled();
    fireEvent.click(rendered.getByTitle(enAi.suggestions.recompile));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mocks.runs).toHaveLength(0);
    expect(activeChatRun()).toBeNull();
    expect(composerBox()).toHaveValue("Read the slow file");

    await act(async () => reading.resolve("slow contents"));
    await waitFor(() =>
      expect(rendered.getByText("slow.txt")).toHaveAttribute("data-status", "ready"),
    );
    pressEnter();
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(lastUserContent(0)).toEqual([
      { type: "text", text: "Read the slow file" },
      { type: "text", text: 'Attached file "slow.txt":\n\nslow contents' },
    ]);
    await completeRun(0, "Read it.");
  });

  it("sends the message text alone when its attachments cannot be prepared", async () => {
    const rendered = await renderChat();
    await attach(rendered, [textFile("notes.txt", "draft notes")]);
    attachmentReadFailures.add("sha-notes.txt");

    sendFromComposer("Use the notes");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.messages).toEqual([{ role: "user", content: "Use the notes" }]);
    expect(mocks.logError).toHaveBeenCalledWith(
      "prepare chat messages",
      expect.objectContaining({ message: "attachment store unavailable" }),
    );
    expect(savedMessages().at(-2)?.attachments).toEqual([
      expect.objectContaining({ name: "notes.txt", sha256: "sha-notes.txt" }),
    ]);
    await completeRun(0, "Used them.");
  });

  it("mentions a project file dropped on the composer", async () => {
    useFilesStore.setState({
      tree: [
        { path: "figures", is_dir: true },
        { path: "figures/plot.png", is_dir: false },
      ],
    });
    const rendered = await renderChat();
    changeComposer("Compare");
    composerBox().setSelectionRange(7, 7);
    const root = rendered.container.querySelector("[data-chat-composer]");
    if (!(root instanceof HTMLElement)) throw new Error("composer root missing");

    const file = treeTransfer("figures/plot.png");
    fireEvent.dragEnter(root, { dataTransfer: file });
    expect(rendered.getByText(enAi.attachments.dropProjectFile)).toBeTruthy();
    fireEvent.drop(root, { dataTransfer: file });
    expect(composerBox()).toHaveValue("Compare @figures/plot.png ");
    expect(rendered.queryByText(enAi.attachments.dropProjectFile)).toBeNull();

    fireEvent.drop(root, { dataTransfer: treeTransfer("figures") });
    expect(composerBox()).toHaveValue("Compare @figures/plot.png @figures/ ");
  });

  it("notes when the selected model cannot read attached images", async () => {
    configureModel({ id: "gpt-text", name: "GPT Text", metadata: textOnlyMetadata("GPT Text") });
    const rendered = await renderChat();
    expect(rendered.queryByTestId("ai-attachment-notice")).toBeNull();

    await attach(rendered, [imageFile("plot.png")]);
    const notice = rendered.getByTestId("ai-attachment-notice");
    // An <output> carries the status role itself.
    expect(rendered.getAllByRole("status")).toContain(notice);
    expect(notice).toHaveTextContent(
      enAi.attachments.visionUnsupported.replace("{{model}}", "GPT Text"),
    );

    fireEvent.click(rendered.getByRole("button", { name: "Remove attachment plot.png" }));
    expect(rendered.queryByTestId("ai-attachment-notice")).toBeNull();

    await attach(rendered, [pdfFile("scan.pdf")]);
    expect(rendered.getByTestId("ai-attachment-notice")).toHaveTextContent(
      enAi.attachments.scannedPdf.replace("{{name}}", "scan.pdf").replace("{{model}}", "GPT Text"),
    );
  });

  it("shows the too-long notice with an export action", async () => {
    seedChat([
      { id: "u1", role: "user", content: "Write the survey" },
      { id: "a1", role: "assistant", content: "Here is the survey." },
    ]);
    useChatsStore.setState({ saveProblems: { "chat-1": "tooLarge" } });
    mocks.exportChatMarkdown
      .mockResolvedValueOnce("saved")
      .mockResolvedValueOnce("cancelled")
      .mockRejectedValueOnce(new Error("disk full"));
    const rendered = await renderChat();

    const banner = rendered.getByTestId("ai-chat-too-large");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(enAi.conversation.tooLargeToSave);
    const exportButton = within(banner).getByRole("button", {
      name: enAi.conversation.exportChat,
    });

    fireEvent.click(exportButton);
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(enAi.conversation.exported),
    );
    expect(mocks.exportChatMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "chat-1",
        messages: [expect.objectContaining({ id: "u1" }), expect.objectContaining({ id: "a1" })],
      }),
      "Test project",
    );

    fireEvent.click(exportButton);
    await waitFor(() => expect(mocks.exportChatMarkdown).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();

    fireEvent.click(exportButton);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(enAi.conversation.exportFailed),
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "export chat",
      expect.objectContaining({ message: "disk full" }),
    );

    act(() => useChatsStore.setState({ saveProblems: { "chat-2": "tooLarge" } }));
    expect(rendered.queryByTestId("ai-chat-too-large")).toBeNull();
  });

  it("warns when new messages in a chat could not be saved", async () => {
    const rendered = await renderChat();
    expect(rendered.queryByTestId("ai-chat-save-failed")).toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("oleafly:chat-save-failed", { detail: { chatId: "chat-1" } }),
      );
    });

    expect(rendered.getByTestId("ai-chat-save-failed")).toHaveTextContent(
      enAi.conversation.saveFailed,
    );
  });

  it("opens an older chat that was loaded as a stub", async () => {
    const projectId = useFilesStore.getState().projectId as string;
    const body: StoredChat = {
      id: "chat-2",
      projectId,
      title: "Earlier review",
      createdAt: 1,
      updatedAt: 2,
      headOid: null,
      messages: [
        { id: "u2", role: "user", content: "Review section 2" },
        { id: "a2", role: "assistant", content: "Section 2 reads well." },
      ],
    };
    useChatsStore.setState((state) => ({
      chats: [...state.chats, { ...body, messages: [], stub: true, messageCount: 2 }],
    }));
    mocks.chatRead.mockResolvedValue(JSON.stringify(body));
    const rendered = await renderChat();

    fireEvent.click(rendered.getByRole("button", { name: new RegExp(enAi.home.recentChats, "i") }));
    const entry = rendered.getByTitle("Earlier review");
    expect(entry).toHaveTextContent(enAi.home.recentMessages_other.replace("{{count}}", "2"));
    fireEvent.click(entry);

    await waitFor(() => expect(useChatsStore.getState().activeId).toBe("chat-2"));
    expect(mocks.chatRead).toHaveBeenCalledWith(projectId, "chat-2");
    expect(useChatsStore.getState().byId("chat-2")).toEqual(body);
    await waitFor(() =>
      expect(rendered.container.querySelectorAll("[data-message-role]")).toHaveLength(2),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("says when an older chat cannot be opened", async () => {
    const projectId = useFilesStore.getState().projectId as string;
    const stub: StoredChat = {
      id: "chat-3",
      projectId,
      title: "Unreadable chat",
      createdAt: 1,
      updatedAt: 2,
      headOid: null,
      messages: [],
      stub: true,
      messageCount: 4,
    };
    useChatsStore.setState((state) => ({ chats: [...state.chats, stub] }));
    mocks.chatRead.mockRejectedValue(new Error("unreadable"));
    await renderChat();

    await act(async () => {
      mocks.historyProps?.onOpen(stub);
    });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(enAi.history.openFailed));
    expect(mocks.logError).toHaveBeenCalledWith(
      "open chat",
      expect.objectContaining({ message: "unreadable" }),
    );
    expect(useChatsStore.getState().activeId).toBe("chat-1");

    mocks.toastError.mockClear();
    await act(async () => {
      mocks.historyProps?.onOpen({ ...stub, id: "chat-gone" });
    });
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(enAi.history.openFailed));
    expect(useChatsStore.getState().activeId).toBe("chat-1");
  });

  it("tells the history how many chats could not be loaded", async () => {
    useChatsStore.setState({ skippedOnLoad: 3 });
    await renderChat();

    expect(mocks.historyProps?.skipped).toBe(3);
  });

  it("keeps the composer hooks the tours and e2e specs use", async () => {
    const rendered = await renderChat();

    const textarea = rendered.container.querySelector('textarea[placeholder*="Ask AI"]');
    expect(textarea).toBe(composerBox());
    expect(textarea).toHaveAttribute("data-tour", "ai-input");
    expect(textarea).toHaveAttribute("role", "combobox");
    expect(rendered.container.querySelector('[data-tour="ai-attachments"]')).toBe(
      rendered.getByRole("button", { name: enAi.composer.addContext }),
    );

    const controls = rendered.getByTestId("ai-composer-controls");
    const left = rendered.getByTestId("ai-composer-controls-left");
    const right = rendered.getByTestId("ai-composer-controls-right");
    expect(controls).toContainElement(left);
    expect(controls).toContainElement(right);
    expect(left.querySelector('[data-tour="ai-prompts"]')).not.toBeNull();
    expect(left.querySelector('[data-tour="ai-persona"]')).not.toBeNull();
    expect(right.querySelector('[data-tour="ai-provider-model"]')).not.toBeNull();

    const usage = right.querySelector('[data-tour="ai-usage"]');
    expect(usage?.querySelector('button[aria-label="View AI usage"]')).toBe(
      usageButton(rendered),
    );
    expect(usage?.querySelector('[data-testid="ai-context-ring"]')).not.toBeNull();
    const header = rendered.container.querySelector('[data-tour="ai-assistant-header"]');
    expect(header?.querySelector('[aria-label="View AI usage"]')).toBeNull();
    expect(rendered.container.querySelector('[data-tour="ai-assistant"]')).toHaveAttribute(
      "data-tour-has-usage",
      "false",
    );
  });

  it("lets the message box measure the chat panel it sits in", async () => {
    const rendered = await renderChat();

    expect(composerBox().closest("[data-composer-panel]")).toBe(
      rendered.container.querySelector('[data-tour="ai-assistant"]'),
    );
  });

  it("keeps a tool screenshot by reference once it is stored", async () => {
    mocks.storeToolImage.mockResolvedValue({ sha256: "sha-shot", mime: "image/png" });
    await renderChat();
    sendFromComposer("Look at the figure");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    const run = mocks.runs[0].options;
    const image = "data:image/png;base64,UExPVA==";

    await act(async () => {
      await run.handlers.onToolCall({ id: "img-1", name: "load_image", args: { path: "plot.png" } });
      await run.tools.load_image.execute?.({ image });
      run.handlers.onToolResult({ id: "img-1", output: { loaded: true } });
    });
    await completeRun(0, "It shows a rising curve.");

    expect(mocks.storeToolImage).toHaveBeenCalledWith(useFilesStore.getState().projectId, image);
    const tool = savedMessages().at(-1)?.toolCalls?.[0];
    expect(tool).toMatchObject({
      id: "img-1",
      name: "load_image",
      status: "done",
      imageRef: { sha256: "sha-shot", mime: "image/png" },
    });
    // Once the file is stored the chat holds the reference only, not the base64 as well.
    expect(tool).not.toHaveProperty("image");
  });

  it("keeps the inline screenshot when it could not be stored", async () => {
    mocks.storeToolImage.mockResolvedValue(null);
    await renderChat();
    sendFromComposer("Look at the figure");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    const run = mocks.runs[0].options;
    const image = "data:image/png;base64,UExPVA==";

    await act(async () => {
      await run.handlers.onToolCall({ id: "img-1", name: "load_image", args: { path: "plot.png" } });
      await run.tools.load_image.execute?.({ image });
      run.handlers.onToolResult({ id: "img-1", output: { loaded: true } });
    });
    await completeRun(0, "It shows a rising curve.");

    const tool = savedMessages().at(-1)?.toolCalls?.[0];
    expect(tool).toMatchObject({ id: "img-1", image });
    expect(tool).not.toHaveProperty("imageRef");
  });

  it("saves streamed text without indexing and indexes the finished reply", async () => {
    await renderChat();
    const saveMessages = vi.spyOn(useChatsStore.getState(), "saveMessages");
    try {
      sendFromComposer("Stream a reply");
      await waitFor(() => expect(mocks.runs).toHaveLength(1));
      act(() => mocks.runs[0].options.handlers.onText("Partial reply"));
      await waitFor(
        () =>
          expect(saveMessages).toHaveBeenCalledWith("chat-1", expect.any(Array), { index: false }),
        { timeout: 2_000 },
      );

      await completeRun(0, " done.");
      const last = saveMessages.mock.calls.at(-1);
      expect(last?.[0]).toBe("chat-1");
      expect(last?.[1].at(-1)?.content).toBe("Partial reply done.");
      expect(last?.[2]).toBeUndefined();
    } finally {
      saveMessages.mockRestore();
    }
  });
});

describe("ChatCore effort, web and usage", () => {
  it("sends the chosen effort when the model offers it and none on Auto", async () => {
    configureModel({ id: EFFORT_MODEL });
    seedChat([], { effort: "max" });
    const rendered = await renderChat();
    expect(rendered.getByTestId("ai-effort-selector")).toHaveAccessibleName(
      effortLabel(enAi.effort.auto),
    );

    sendFromComposer("Plan the proof");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.effort).toBeUndefined();
    await completeRun(0, "Planned.");

    pickEffort(rendered, enAi.effort.levels.high);
    expect(useChatsStore.getState().byId("chat-1")?.effort).toBe("high");
    expect(rendered.getByTestId("ai-effort-selector")).toHaveAccessibleName(
      effortLabel(enAi.effort.levels.high),
    );
    sendFromComposer("Prove it");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.effort).toBe("high");
    await completeRun(1, "Proved.");

    pickEffort(rendered, new RegExp(enAi.effort.auto));
    expect(useChatsStore.getState().byId("chat-1")).not.toHaveProperty("effort");
    sendFromComposer("Once more");
    await waitFor(() => expect(mocks.runs).toHaveLength(3));
    expect(mocks.runs[2].options.effort).toBeUndefined();
    await completeRun(2, "Done.");
  });

  it("hides the effort selector for models without effort choices", async () => {
    const rendered = await renderChat();
    expect(rendered.queryByTestId("ai-effort-selector")).toBeNull();

    act(() => mocks.modelSelectorProps?.onChange?.("openai", EFFORT_MODEL));
    expect(rendered.getByTestId("ai-effort-selector")).toBeTruthy();

    act(() => mocks.modelSelectorProps?.onChange?.("openai", "gpt-4o"));
    expect(rendered.queryByTestId("ai-effort-selector")).toBeNull();
  });

  it("remembers effort and web for each chat", async () => {
    configureModel({ id: EFFORT_MODEL });
    const rendered = await renderChat();
    pickEffort(rendered, enAi.effort.levels.high);
    fireEvent.click(webToggle(rendered));
    expect(useChatsStore.getState().byId("chat-1")).toMatchObject({
      effort: "high",
      web: { search: true, fetch: true },
    });

    fireEvent.click(rendered.getByRole("button", { name: enAi.header.newChat }));
    expect(rendered.getByTestId("ai-effort-selector")).toHaveAccessibleName(
      effortLabel(enAi.effort.auto),
    );
    expect(webToggle(rendered)).toHaveAttribute("aria-pressed", "false");

    pickEffort(rendered, enAi.effort.levels.medium);
    expect(rendered.getByTestId("ai-effort-selector")).toHaveAccessibleName(
      effortLabel(enAi.effort.levels.medium),
    );
    sendFromComposer("Start a new topic");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.effort).toBe("medium");
    expect(mocks.runs[0].options.web).toBeUndefined();
    const created = useChatsStore.getState().activeId as string;
    expect(created).not.toBe("chat-1");
    expect(useChatsStore.getState().byId(created)?.effort).toBe("medium");
    expect(useChatsStore.getState().byId(created)).not.toHaveProperty("web");
    await completeRun(0, "Started.");

    act(() => mocks.historyProps?.onOpen(useChatsStore.getState().byId("chat-1") as StoredChat));
    expect(rendered.getByTestId("ai-effort-selector")).toHaveAccessibleName(
      effortLabel(enAi.effort.levels.high),
    );
    expect(webToggle(rendered)).toHaveAttribute("aria-pressed", "true");
    sendFromComposer("Back to the first topic");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.effort).toBe("high");
    expect(mocks.runs[1].options.web).toEqual({ search: true, fetch: true });
    await completeRun(1, "Back again.");
  });

  it("turns web on for a new chat started from a literature quick start", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "oleafly-literature-sweep",
        name: "Oleafly Literature Sweep",
        description: "Build a reading list.",
        instructions: "Search the literature and write research/reading-list.md.",
      }),
    );
    const rendered = await renderChat();

    fireEvent.click(rendered.getByRole("button", { name: enAi.header.newChat }));
    fireEvent.click(rendered.getByTitle(enAi.suggestions.literatureSweep));
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.web).toEqual({ search: true, fetch: true });
    const sweep = useChatsStore.getState().activeId as string;
    expect(sweep).not.toBe("chat-1");
    expect(useChatsStore.getState().byId(sweep)?.web).toEqual({ search: true, fetch: true });
    await completeRun(0, "Swept.");
    expect(webToggle(rendered)).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(rendered.getByRole("button", { name: enAi.header.newChat }));
    expect(webToggle(rendered)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(rendered.getByTitle(enAi.suggestions.recompile));
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.web).toBeUndefined();
    const recompile = useChatsStore.getState().activeId as string;
    expect(recompile).not.toBe(sweep);
    expect(useChatsStore.getState().byId(recompile)).not.toHaveProperty("web");
    await completeRun(1, "Compiled.");
  });

  it("turns web on in the open empty chat a literature quick start runs in", async () => {
    mocks.skillEntries.push(
      skillEntry({
        id: "oleafly-literature-sweep",
        name: "Oleafly Literature Sweep",
        description: "Build a reading list.",
        instructions: "Search the literature and write research/reading-list.md.",
      }),
    );
    const rendered = await renderChat();

    fireEvent.click(rendered.getByTitle(enAi.suggestions.literatureSweep));
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.web).toEqual({ search: true, fetch: true });
    expect(useChatsStore.getState().activeId).toBe("chat-1");
    expect(useChatsStore.getState().byId("chat-1")?.web).toEqual({ search: true, fetch: true });
    await completeRun(0, "Swept.");
  });

  it("sends web tools only when the toggle is on", async () => {
    const rendered = await renderChat();
    expect(webToggle(rendered)).toHaveAttribute("aria-pressed", "false");
    sendFromComposer("No web yet");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.web).toBeUndefined();
    expect(webToggle(rendered)).toBeDisabled();
    await completeRun(0, "Answered.");

    fireEvent.click(webToggle(rendered));
    expect(webToggle(rendered)).toHaveAttribute("aria-pressed", "true");
    sendFromComposer("Search the web");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.runs[1].options.web).toEqual({ search: true, fetch: true });
    await completeRun(1, "Searched.");

    fireEvent.click(webToggle(rendered));
    expect(webToggle(rendered)).toHaveAttribute("aria-pressed", "false");
    expect(useChatsStore.getState().byId("chat-1")).not.toHaveProperty("web");
    sendFromComposer("Offline again");
    await waitFor(() => expect(mocks.runs).toHaveLength(3));
    expect(mocks.runs[2].options.web).toBeUndefined();
    await completeRun(2, "Offline.");
  });

  it("shows context use in the composer ring and the last run in the popover", async () => {
    const rendered = await renderChat();
    expect(rendered.getByTestId("ai-context-ring")).toHaveAttribute("data-state", "unknown");
    sendFromComposer("Measure the context");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    act(() =>
      mocks.runs[0].options.handlers.onUsage?.(
        { input: 1200, output: 340 },
        { lastStep: { input: 160_000, output: 0 }, contextWindow: 200_000 },
      ),
    );
    await waitFor(() =>
      expect(rendered.getByTestId("ai-context-ring")).toHaveAttribute("data-tone", "warning"),
    );
    fireEvent.mouseEnter(usageButton(rendered).parentElement as HTMLElement);
    expect(await rendered.findByRole("tooltip")).toHaveTextContent(
      enAi.usage.contextShare.replace("{{percent}}", "80%"),
    );

    fireEvent.click(usageButton(rendered));
    const lastRun = await rendered.findByTestId("ai-run-usage");
    expect(lastRun).toHaveTextContent("1,200");
    expect(lastRun).toHaveTextContent("340");
    expect(rendered.getByTestId("usage-context")).toHaveTextContent(
      enAi.usage.contextUsed.replace("{{used}}", "160,000").replace("{{size}}", "200,000"),
    );
    await completeRun(0, "Measured.");
    expect(useChatsStore.getState().byId("chat-1")?.usage).toMatchObject({
      inputTokens: 1200,
      outputTokens: 340,
      context: { used: 160_000, size: 200_000 },
    });
    expect(rendered.container.querySelector('[data-tour="ai-assistant"]')).toHaveAttribute(
      "data-tour-has-usage",
      "true",
    );

    rendered.unmount();
    const again = await renderChat();
    expect(again.getByTestId("ai-context-ring")).toHaveAttribute("data-tone", "warning");
  });

  it("measures the context against the model's own window when the catalog knows it", async () => {
    configureModel({
      id: "gpt-4o",
      name: "GPT-4o",
      metadata: { ...textOnlyMetadata("GPT-4o"), contextWindow: 400_000 },
    });
    const rendered = await renderChat();
    sendFromComposer("Measure again");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    act(() =>
      mocks.runs[0].options.handlers.onUsage?.(
        { input: 900, output: 100 },
        { lastStep: { input: 160_000, output: 0 } },
      ),
    );
    await waitFor(() =>
      expect(rendered.getByTestId("ai-context-ring")).toHaveAttribute("data-state", "known"),
    );
    expect(rendered.getByTestId("ai-context-ring")).toHaveAttribute("data-tone", "normal");
    fireEvent.click(usageButton(rendered));
    expect(await rendered.findByTestId("usage-context")).toHaveTextContent(
      enAi.usage.contextUsed.replace("{{used}}", "160,000").replace("{{size}}", "400,000"),
    );
    await completeRun(0, "Measured.");
    expect(useChatsStore.getState().byId("chat-1")?.usage?.context).toEqual({
      used: 160_000,
      size: 400_000,
    });
  });

  it("fills the chat's estimated cost from the usage ledger after a run", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-cost");
    mocks.queryUsageReport.mockImplementation(async (filter: { sessionIds: string[] }) => ({
      totals: filter.sessionIds.includes("thread-cost")
        ? { costKnownRecords: 2, estimatedCostUsd: 0.42 }
        : { costKnownRecords: 0, estimatedCostUsd: 0 },
    }));
    const rendered = await renderChat();
    sendFromComposer("Price this run");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    act(() => mocks.runs[0].options.handlers.onUsage?.({ input: 100, output: 20 }));
    await completeRun(0, "Priced.");

    await waitFor(
      () => expect(useChatsStore.getState().byId("chat-1")?.usage?.estimatedUsd).toBe(0.42),
      { timeout: 4_000 },
    );
    expect(mocks.queryUsageReport).toHaveBeenCalledWith(
      expect.objectContaining({ sessionIds: ["thread-cost"], pageSize: 1 }),
    );
    fireEvent.click(usageButton(rendered));
    expect(await rendered.findByTestId("ai-chat-usage")).toHaveTextContent(formatUsd(0.42));
  }, 20_000);

  it("keeps the chat's cost when the usage ledger cannot be read", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-ledger-down");
    mocks.queryUsageReport.mockRejectedValue(new Error("ledger locked"));
    await renderChat();
    sendFromComposer("Price this run");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    act(() => mocks.runs[0].options.handlers.onUsage?.({ input: 100, output: 20 }));
    await completeRun(0, "Not priced.");

    await waitFor(
      () =>
        expect(mocks.logError).toHaveBeenCalledWith(
          "chat cost",
          expect.objectContaining({ message: "ledger locked" }),
        ),
      { timeout: 4_000 },
    );
    expect(mocks.queryUsageReport).toHaveBeenCalledWith(
      expect.objectContaining({ sessionIds: ["thread-ledger-down"] }),
    );
    expect(useChatsStore.getState().byId("chat-1")?.usage?.estimatedUsd).toBe(0);
  }, 20_000);

  it("notes trimmed history in the usage popover", async () => {
    seedChat(
      Array.from({ length: 26 }, (_, index): ChatMessage => ({
        id: `m${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `Message ${index}`,
      })),
    );
    const rendered = await renderChat();
    sendFromComposer("Continue the long chat");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.messages).toHaveLength(25);

    fireEvent.click(usageButton(rendered));
    expect(await rendered.findByTestId("usage-notes")).toHaveTextContent(
      enAi.usage.historyTrimmed_other.replace("{{count}}", "24"),
    );
    await completeRun(0, "Continued.");
  });

  it("shows the stall notice and retry status from the catalog", async () => {
    const stallChecks: Array<() => void> = [];
    const nativeSetInterval = window.setInterval.bind(window);
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...rest: unknown[]
    ) => {
      if (timeout === 5_000 && typeof handler === "function") stallChecks.push(handler as () => void);
      return nativeSetInterval(handler, timeout, ...rest);
    }) as typeof window.setInterval);
    try {
      await renderChat();
      sendFromComposer("Take your time");
      await waitFor(() => expect(mocks.runs).toHaveLength(1));
      await waitFor(() => expect(mocks.shimmerText).toBe(enAi.chat.reasoning.thinking));
      await waitFor(() => expect(stallChecks).toHaveLength(1));

      const startedAt = activeChatRun()?.lastPartAt ?? 0;
      const now = vi.spyOn(Date, "now").mockReturnValue(startedAt + 25_000);
      try {
        act(() => stallChecks[0]());
      } finally {
        now.mockRestore();
      }
      expect(mocks.shimmerText).toBe(enAi.conversation.stillWorking.replace("{{seconds}}", "25"));

      act(() => mocks.runs[0].options.handlers.onRetry?.(2, 3));
      expect(mocks.shimmerText).toBe(
        enAi.conversation.retrying.replace("{{attempt}}", "2").replace("{{max}}", "3"),
      );
      await completeRun(0, "Done at last.");
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it("saves a stable stopped marker and marks failed replies", async () => {
    mocks.runAgentHarness.mockImplementationOnce(
      (options: HarnessOptions) =>
        new Promise((_resolve, reject) => {
          options.onRequestId?.("request-stop");
          options.handlers.onStep?.(0);
          options.handlers.onText("Started.");
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const rendered = await renderChat();
    sendFromComposer("Long task");
    await waitFor(() =>
      expect(rendered.getByRole("button", { name: enAi.composer.stop })).toBeTruthy(),
    );
    fireEvent.click(rendered.getByRole("button", { name: enAi.composer.stop }));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    await waitFor(() => expect(savedMessages().at(-1)?.content).toBe("Started.\n\n_Stopped._"));
    expect(savedMessages().at(-1)?.failed).toBeUndefined();

    sendFromComposer("Try once more");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Half an answer", { error: "the provider failed" });
    expect(savedMessages().at(-1)).toMatchObject({
      role: "assistant",
      content: "Half an answer\n\nthe provider failed",
      failed: true,
    });

    mocks.runAgentHarness.mockImplementationOnce(() =>
      Promise.reject(new Error("socket hang up")),
    );
    sendFromComposer("And again");
    await waitFor(() => expect(savedMessages().at(-1)?.content).toBe("Error: socket hang up"));
    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(savedMessages().at(-1)?.failed).toBe(true);
  });

  it("adds the output limit marker when the model ran out of room", async () => {
    await renderChat();
    sendFromComposer("Write the whole chapter");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Chapter one begins", { stop_reason: "max_tokens" });
    expect(savedMessages().at(-1)?.content).toBe(
      "Chapter one begins\n\n_The reply reached the model's output limit. Send another message to continue._",
    );
    expect(savedMessages().at(-1)?.failed).toBeUndefined();

    sendFromComposer("Keep going");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    await completeRun(1, "Chapter two", { stop_reason: "max_tokens", stopped_at_cap: true });
    expect(savedMessages().at(-1)?.content).toBe(
      "Chapter two\n\n_Reached the step safety limit. You can continue by sending another message._",
    );

    sendFromComposer("Finish it");
    await waitFor(() => expect(mocks.runs).toHaveLength(3));
    await completeRun(2, "Chapter three", { stop_reason: "max_tokens", error: "the provider failed" });
    expect(savedMessages().at(-1)).toMatchObject({
      content: "Chapter three\n\nthe provider failed",
      failed: true,
    });
  });

  it("shows the notices a run sends about attachments and web search", async () => {
    await renderChat();
    sendFromComposer("Use everything");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    const handlers = mocks.runs[0].options.handlers;

    act(() => {
      handlers.onNotice?.("attachment_sent_as_text", "paper.pdf");
      handlers.onNotice?.("attachment_sent_as_text", "paper.pdf");
      handlers.onNotice?.("attachment_skipped", "scan.pdf");
      handlers.onNotice?.("web_search_unavailable", null);
      handlers.onNotice?.("something_else", "ignored");
    });
    await completeRun(0, "Done.");

    expect(savedMessages().at(-1)?.notices).toEqual([
      enAi.attachments.sentAsText.replace("{{name}}", "paper.pdf"),
      enAi.attachments.skipped.replace("{{name}}", "scan.pdf"),
      enAi.web.searchUnavailable,
    ]);
  });
});

describe("ChatCore drafts per chat and queued follow-ups", () => {
  function otherChat(): StoredChat {
    const projectId = useFilesStore.getState().projectId as string;
    const chat: StoredChat = {
      id: "chat-2",
      projectId,
      title: "Earlier review",
      createdAt: 1,
      updatedAt: 2,
      headOid: null,
      messages: [{ id: "u9", role: "user", content: "Review section 2" }],
    };
    useChatsStore.setState((state) => ({ chats: [...state.chats, chat] }));
    return chat;
  }

  it("keeps the text of each chat in that chat", async () => {
    const other = otherChat();
    await renderChat();
    changeComposer("About the first chat");

    act(() => mocks.historyProps?.onOpen(other));
    await waitFor(() => expect(useChatsStore.getState().activeId).toBe("chat-2"));
    expect(composerBox()).toHaveValue("");
    changeComposer("About the second chat");

    act(() => mocks.historyProps?.onOpen(useChatsStore.getState().byId("chat-1") as StoredChat));
    await waitFor(() => expect(composerBox()).toHaveValue("About the first chat"));
    act(() => mocks.historyProps?.onOpen(other));
    await waitFor(() => expect(composerBox()).toHaveValue("About the second chat"));
    // Enter sends into the chat the text belongs to, never into another.
    pressEnter();
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(plainTranscript(mocks.runs[0].options.messages).at(-1)).toEqual({ role: "user", content: "About the second chat" });
    await completeRun(0, "Done.");
    expect(savedMessages("chat-1")).toEqual([]);
  });

  it("gives a new chat an empty box and keeps what was typed in the chat it left", async () => {
    const rendered = await renderChat();
    changeComposer("Half a thought");

    fireEvent.click(rendered.getByRole("button", { name: enAi.header.newChat }));

    expect(composerBox()).toHaveValue("");
    changeComposer("Text for the new chat");
    const projectId = useFilesStore.getState().projectId as string;
    expect(useComposerDrafts.getState().drafts[builtinComposerId(projectId, "chat-1")]?.text).toBe("Half a thought");
    expect(useComposerDrafts.getState().drafts[builtinComposerId(projectId)]?.text).toBe("Text for the new chat");
  });

  it("moves what is typed after pressing send into the chat the send creates", async () => {
    useChatsStore.setState({ activeId: null });
    await renderChat();
    const projectId = useFilesStore.getState().projectId as string;
    sendFromComposer("First message");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    const created = useChatsStore.getState().activeId as string;
    expect(created).toBeTruthy();

    changeComposer("Typed while it answers");

    expect(useComposerDrafts.getState().drafts[builtinComposerId(projectId, created)]?.text).toBe("Typed while it answers");
    expect(useComposerDrafts.getState().drafts[builtinComposerId(projectId)]).toBeUndefined();
    await completeRun(0, "Answer.");
  });

  it("sends a queued follow-up on the model picked after it was queued", async () => {
    await renderChat();
    sendFromComposer("First question");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    sendFromComposer("Second question");
    act(() => mocks.modelSelectorProps?.onChange?.("openai", "gpt-4o-mini"));

    // The queued message follows at once, so the run registry is not empty in between.
    await act(async () => {
      mocks.runs[0].options.handlers.onText("First answer.");
      mocks.runs[0].resolve({ text: "First answer.", usage: { input: 0, output: 0 }, steps: 1, stopped_at_cap: false, error: null });
    });

    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    const second = mocks.runs[1].options as unknown as { providerOverride?: { provider_id: string; model_id: string } };
    expect(second.providerOverride).toEqual({ provider_id: "openai", model_id: "gpt-4o-mini" });
    expect((mocks.runs[0].options as unknown as { providerOverride?: { model_id: string } }).providerOverride?.model_id).toBe("gpt-4o");
    await completeRun(1, "Second answer.");
  });

  it("does not switch chats while a send is still preparing", async () => {
    let release: () => void = () => {};
    mocks.mcpAgentToolsList.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve([]); }),
    );
    const other = otherChat();
    await renderChat();
    sendFromComposer("For the first chat");
    await waitFor(() => expect(mocks.mcpAgentToolsList).toHaveBeenCalled());

    await act(async () => {
      mocks.historyProps?.onOpen(other);
    });
    expect(useChatsStore.getState().activeId).toBe("chat-1");

    release();
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(plainTranscript(mocks.runs[0].options.messages)).toEqual([{ role: "user", content: "For the first chat" }]);
    expect(useChatsStore.getState().activeId).toBe("chat-1");
    expect(savedMessages("chat-2").map((message) => message.content)).toEqual(["Review section 2"]);
    await completeRun(0, "Done.");
  });
});

describe("ChatCore message actions", () => {
  it("regenerates the latest reply from the same prompt and attachments", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-1");
    const rendered = await renderChat();
    await attach(rendered, [textFile("notes.txt", "draft notes")]);
    sendFromComposer("Summarise the notes");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Here is the summary.");
    const [user, reply] = savedMessages();
    mocks.agentThreadRead.mockResolvedValue([{ turnId: "turn-a", clientTurnId: user.turnId }]);
    await waitFor(() => expect(rowProps(reply.id as string)?.regenerateKind).toBe("regenerate"));

    await messageAction("regenerate", reply.id as string);
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.agentThreadRead).toHaveBeenCalledWith("thread-1");
    expect(mocks.agentThreadRollback).toHaveBeenCalledWith("thread-1", 1);
    expect(mocks.runs[1].options.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Summarise the notes" },
          { type: "text", text: 'Attached file "notes.txt":\n\ndraft notes' },
        ],
      },
    ]);
    await completeRun(1, "A better summary.");

    const messages = savedMessages();
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "Summarise the notes"],
      ["assistant", "A better summary."],
    ]);
    expect(messages[0].attachments).toEqual([
      expect.objectContaining({ name: "notes.txt", sha256: "sha-notes.txt" }),
    ]);
    expect(messages.some((message) => message.id === reply.id)).toBe(false);
  });

  it("asks before replacing a reply that changed files", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-1");
    mocks.agentTurnFinish.mockResolvedValue(turnChangesFor(["main.tex", "refs.bib"]));
    const rendered = await renderChat();
    sendFromComposer("Tidy the bibliography");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Tidied.");
    await waitFor(() => expect(savedMessages().at(-1)?.turnChanges?.files).toHaveLength(2));
    const replyId = savedMessages().at(-1)?.id as string;
    await waitFor(() => expect(rowProps(replyId)?.regenerateKind).toBe("regenerate"));

    await messageAction("regenerate", replyId);
    const dialog = await rendered.findByRole("alertdialog", {
      name: enAi.messageActions.replaceTitle,
    });
    expect(dialog).toHaveTextContent(
      enAi.messageActions.replaceDescription_other.replace("{{count}}", "2"),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/ }));
    expect(rendered.queryByRole("alertdialog")).toBeNull();
    expect(mocks.runs).toHaveLength(1);
    expect(mocks.agentThreadRead).not.toHaveBeenCalled();

    await messageAction("regenerate", replyId);
    const confirm = await rendered.findByRole("alertdialog", {
      name: enAi.messageActions.replaceTitle,
    });
    fireEvent.click(
      within(confirm).getByRole("button", {
        name: new RegExp(enAi.messageActions.replaceConfirm),
      }),
    );
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(plainTranscript(mocks.runs[1].options.messages)).toEqual([
      { role: "user", content: "Tidy the bibliography" },
    ]);
    await completeRun(1, "Tidied again.");
  });

  it("retries a failed reply", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-1");
    await renderChat();
    sendFromComposer("Summarise the draft");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "", { error: "the provider failed" });
    const failed = savedMessages().at(-1) as ChatMessage;
    expect(failed.failed).toBe(true);
    await waitFor(() => expect(rowProps(failed.id as string)?.regenerateKind).toBe("retry"));

    await messageAction("regenerate", failed.id as string);
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(plainTranscript(mocks.runs[1].options.messages)).toEqual([
      { role: "user", content: "Summarise the draft" },
    ]);
    await completeRun(1, "Here is the summary.");

    const messages = savedMessages();
    expect(messages).toHaveLength(2);
    const retried = messages[1];
    expect(retried).toMatchObject({ role: "assistant", content: "Here is the summary." });
    expect(retried.failed).toBeUndefined();
    await waitFor(() =>
      expect(rowProps(retried.id as string)?.regenerateKind).toBe("regenerate"),
    );
  });

  it("edits the latest message in place", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-1");
    const rendered = await renderChat();
    sendFromComposer("Draw the table");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Here is the table.");
    const [user, reply] = savedMessages();
    mocks.agentThreadRead.mockResolvedValue([{ turnId: "turn-a", clientTurnId: user.turnId }]);
    await waitFor(() => expect(rowProps(user.id as string)?.editable).toBe(true));

    await messageAction("edit", user.id as string);
    expect(rendered.getByTestId("ai-edit-banner")).toHaveTextContent(
      enAi.messageActions.editingLatest,
    );
    expect(composerBox()).toHaveValue("Draw the table");

    sendFromComposer("Fix the table");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
    expect(composerBox()).toHaveValue("");
    expect(mocks.agentThreadRollback).toHaveBeenCalledWith("thread-1", 1);
    expect(plainTranscript(mocks.runs[1].options.messages)).toEqual([
      { role: "user", content: "Fix the table" },
    ]);
    await completeRun(1, "Fixed the table.");

    expect(savedMessages().map((message) => message.content)).toEqual([
      "Fix the table",
      "Fixed the table.",
    ]);
    expect(savedMessages().some((message) => message.id === reply.id)).toBe(false);
  });

  it("asks before an edit replaces a reply that changed files", async () => {
    seedChat([
      { id: "u1", role: "user", content: "Rewrite the intro", turnId: "turn-1" },
      { id: "a1", role: "assistant", content: "Rewrote it.", turnChanges: turnChangesFor(["main.tex"]) },
    ]);
    const rendered = await renderChat();
    await waitFor(() => expect(rowProps("u1")?.editable).toBe(true));

    await messageAction("edit", "u1");
    sendFromComposer("Rewrite only the first paragraph");
    const dialog = await rendered.findByRole("alertdialog", {
      name: enAi.messageActions.replaceTitle,
    });
    expect(dialog).toHaveTextContent(
      enAi.messageActions.replaceDescription_one.replace("{{count}}", "1"),
    );
    expect(mocks.runs).toHaveLength(0);

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: new RegExp(enAi.messageActions.replaceConfirm),
      }),
    );
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(plainTranscript(mocks.runs[0].options.messages)).toEqual([
      { role: "user", content: "Rewrite only the first paragraph" },
    ]);
    await completeRun(0, "Rewrote the first paragraph.");
    expect(savedMessages().map((message) => message.content)).toEqual([
      "Rewrite only the first paragraph",
      "Rewrote the first paragraph.",
    ]);
  });

  it("edits an earlier message into a new chat and keeps the original", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-1");
    const rendered = await renderChat();
    const projectId = useFilesStore.getState().projectId;
    sendFromComposer("First request");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "First reply.");
    sendFromComposer("Second request");
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    await completeRun(1, "Second reply.");
    const original = savedMessages();
    expect(original).toHaveLength(4);
    mocks.agentThreadRead.mockResolvedValue(
      original
        .filter((message) => message.role === "user")
        .map((message, index) => ({ turnId: `turn-${index}`, clientTurnId: message.turnId })),
    );
    await waitFor(() => expect(rowProps(original[0].id as string)?.editable).toBe(true));

    await messageAction("edit", original[0].id as string);
    expect(rendered.getByTestId("ai-edit-banner")).toHaveTextContent(
      enAi.messageActions.editingEarlier,
    );
    sendFromComposer("Revised first request");
    await waitFor(() => expect(mocks.runs).toHaveLength(3));

    expect(mocks.agentThreadFork).toHaveBeenCalledWith("thread-1", projectId, 2);
    expect(mocks.agentThreadRollback).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(enAi.messageActions.forked);
    const forkId = useChatsStore.getState().activeId as string;
    expect(forkId).not.toBe("chat-1");
    expect(useAgentTurnsStore.getState().threadByChat[forkId]).toBe("thread-forked");
    expect(useChatsStore.getState().byId(forkId)?.threadId).toBe("thread-forked");
    expect(mocks.runs[2].options.threadId).toBe("thread-forked");
    expect(plainTranscript(mocks.runs[2].options.messages)).toEqual([
      { role: "user", content: "Revised first request" },
    ]);
    await completeRun(2, "Revised reply.");

    expect(savedMessages(forkId).map((message) => message.content)).toEqual([
      "Revised first request",
      "Revised reply.",
    ]);
    expect(savedMessages("chat-1")).toEqual(original);
  });

  it("forks an earlier message of a chat that has no thread yet", async () => {
    seedChat([
      { id: "u1", role: "user", content: "Outline the paper", turnId: "turn-1" },
      { id: "a1", role: "assistant", content: "Here is an outline." },
      { id: "u2", role: "user", content: "Expand section 2", turnId: "turn-2" },
      { id: "a2", role: "assistant", content: "Expanded it." },
    ]);
    await renderChat();
    await waitFor(() => expect(rowProps("u1")?.editable).toBe(true));

    await messageAction("edit", "u1");
    sendFromComposer("Outline the paper in five parts");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));

    expect(mocks.agentThreadRead).not.toHaveBeenCalled();
    expect(mocks.agentThreadFork).not.toHaveBeenCalled();
    const forkId = useChatsStore.getState().activeId as string;
    expect(forkId).not.toBe("chat-1");
    expect(mocks.runs[0].options.threadId).not.toBe("thread-forked");
    expect(plainTranscript(mocks.runs[0].options.messages)).toEqual([
      { role: "user", content: "Outline the paper in five parts" },
    ]);
    await completeRun(0, "Here is a five-part outline.");
    expect(savedMessages("chat-1").map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("cancelling an edit restores the draft that was there before", async () => {
    seedChat([
      {
        id: "u1",
        role: "user",
        content: "Plot the results",
        turnId: "turn-1",
        attachments: [
          { name: "plot.png", mediaType: "image/png", sha256: "sha-plot.png", size: 9, kind: "image" },
          { name: "old.pdf", mediaType: "application/pdf" },
        ],
      },
      { id: "a1", role: "assistant", content: "Here is the plot." },
      { id: "u2", role: "user", content: "Label the axes", turnId: "turn-2" },
      { id: "a2", role: "assistant", content: "Labelled them." },
    ]);
    const rendered = await renderChat();
    changeComposer("Unsent draft");
    await attach(rendered, [textFile("notes.txt", "draft notes")]);
    await waitFor(() => expect(rowProps("u1")?.editable).toBe(true));

    await messageAction("edit", "u1");
    expect(rendered.getByTestId("ai-edit-banner")).toHaveTextContent(
      enAi.messageActions.editingEarlier,
    );
    expect(composerBox()).toHaveValue("Plot the results");
    expect(rendered.queryByText("notes.txt")).toBeNull();
    expect(rendered.getByText("plot.png")).toHaveAttribute("data-status", "ready");
    expect(rendered.queryByText("old.pdf")).toBeNull();
    await waitFor(() =>
      expect(composerDraft()?.attachments[0]?.thumbnailUrl).toBe("blob:attachment"),
    );
    expect(mocks.attachmentObjectUrl).toHaveBeenCalledWith(
      useFilesStore.getState().projectId,
      "sha-plot.png",
      "image/png",
    );

    await messageAction("edit", "u2");
    expect(rendered.getByTestId("ai-edit-banner")).toHaveTextContent(
      enAi.messageActions.editingLatest,
    );
    expect(composerBox()).toHaveValue("Label the axes");
    expect(rendered.queryByText("plot.png")).toBeNull();

    fireEvent.click(rendered.getByRole("button", { name: enAi.messageActions.cancelEdit }));
    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
    expect(composerBox()).toHaveValue("Unsent draft");
    expect(rendered.getByText("notes.txt")).toHaveAttribute("data-status", "ready");
    expect(rendered.queryByText("plot.png")).toBeNull();
    expect(mocks.runs).toHaveLength(0);
    expect(savedMessages().map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  async function editWithDraft(): Promise<RenderResult> {
    seedChat([
      { id: "u1", role: "user", content: "Plot the results", turnId: "turn-1" },
      { id: "a1", role: "assistant", content: "Here is the plot." },
      { id: "u2", role: "user", content: "Label the axes", turnId: "turn-2" },
      { id: "a2", role: "assistant", content: "Labelled them." },
    ]);
    const rendered = await renderChat();
    changeComposer("Unsent draft");
    await attach(rendered, [textFile("notes.txt", "draft notes")]);
    await waitFor(() => expect(rowProps("u1")?.editable).toBe(true));
    await messageAction("edit", "u1");
    expect(composerBox()).toHaveValue("Plot the results");
    expect(rendered.queryByText("notes.txt")).toBeNull();
    return rendered;
  }

  it("puts the draft from before an edit back when a new chat starts", async () => {
    const rendered = await editWithDraft();

    fireEvent.click(rendered.getByRole("button", { name: enAi.header.newChat }));

    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
    // The draft goes back to the chat it was typed in; the new chat has its own box.
    const projectId = useFilesStore.getState().projectId as string;
    expect(useComposerDrafts.getState().drafts[builtinComposerId(projectId, "chat-1")]?.text).toBe("Unsent draft");
    expect(composerBox()).toHaveValue("");
    expect(rendered.queryByText("notes.txt")).toBeNull();
    expect(savedMessages().map((message) => message.content)).toContain("Plot the results");
    act(() => mocks.historyProps?.onOpen(useChatsStore.getState().byId("chat-1") as StoredChat));
    await waitFor(() => expect(composerBox()).toHaveValue("Unsent draft"));
    expect(rendered.getByText("notes.txt")).toHaveAttribute("data-status", "ready");
  });

  it("puts the draft from before an edit back when another chat opens", async () => {
    const projectId = useFilesStore.getState().projectId as string;
    const other: StoredChat = {
      id: "chat-2",
      projectId,
      title: "Earlier review",
      createdAt: 1,
      updatedAt: 2,
      headOid: null,
      messages: [{ id: "u9", role: "user", content: "Review section 2" }],
    };
    useChatsStore.setState((state) => ({ chats: [...state.chats, other] }));
    const rendered = await editWithDraft();

    act(() => mocks.historyProps?.onOpen(other));

    await waitFor(() => expect(useChatsStore.getState().activeId).toBe("chat-2"));
    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
    // Each chat has its own draft: it went back to chat-1 and is not in chat-2's box.
    expect(composerBox()).toHaveValue("");
    expect(rendered.queryByText("notes.txt")).toBeNull();
    act(() => mocks.historyProps?.onOpen(useChatsStore.getState().byId("chat-1") as StoredChat));
    await waitFor(() => expect(useChatsStore.getState().activeId).toBe("chat-1"));
    expect(composerBox()).toHaveValue("Unsent draft");
    expect(rendered.getByText("notes.txt")).toHaveAttribute("data-status", "ready");
  });

  it("keeps the draft from before an edit with its project when the project changes", async () => {
    const firstProject = useFilesStore.getState().projectId as string;
    const rendered = await editWithDraft();

    act(() => {
      useFilesStore.setState({ projectId: "composer-project-elsewhere", projectName: "Other project" });
    });
    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
    expect(composerBox()).toHaveValue("");

    act(() => {
      useFilesStore.setState({ projectId: firstProject, projectName: "Test project" });
    });
    expect(composerBox()).toHaveValue("Unsent draft");
    expect(rendered.getByText("notes.txt")).toHaveAttribute("data-status", "ready");
    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
  });

  it("offers no message actions while a reply streams", async () => {
    seedChat([
      { id: "u1", role: "user", content: "First question", turnId: "turn-1" },
      { id: "a1", role: "assistant", content: "First answer." },
    ]);
    await renderChat();
    await waitFor(() => expect(rowProps("a1")?.regenerateKind).toBe("regenerate"));
    expect(rowProps("u1")?.editable).toBe(true);

    sendFromComposer("Second question");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await waitFor(() => expect(rowProps("u1")?.editable).toBeUndefined());
    for (const message of savedMessages()) {
      expect(rowProps(message.id as string)?.regenerateKind).toBeUndefined();
      expect(rowProps(message.id as string)?.editable).toBeUndefined();
    }
    await messageAction("regenerate", "a1");
    await messageAction("edit", "u1");
    expect(mocks.runs).toHaveLength(1);
    expect(mocks.agentThreadRead).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="ai-edit-banner"]')).toBeNull();

    await completeRun(0, "Second answer.");
    const latest = savedMessages().at(-1)?.id as string;
    await waitFor(() => expect(rowProps(latest)?.regenerateKind).toBe("regenerate"));
    expect(rowProps("a1")?.regenerateKind).toBeUndefined();
    expect(rowProps("u1")?.editable).toBe(true);
  });

  it("regenerates a chat saved before 0.4.8 without touching its thread", async () => {
    seedChat(
      [
        { id: "u1", role: "user", content: "Old question" },
        { id: "a1", role: "assistant", content: "Old answer." },
      ],
      { threadId: "thread-old" },
    );
    mocks.agentThreadRead.mockResolvedValue([{ turnId: "turn-a", clientTurnId: null }]);
    await renderChat();
    await waitFor(() => expect(rowProps("a1")?.regenerateKind).toBe("regenerate"));

    await messageAction("regenerate", "a1");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.agentThreadRead).toHaveBeenCalledWith("thread-old");
    expect(mocks.agentThreadRollback).not.toHaveBeenCalled();
    expect(mocks.runs[0].options.threadId).toBe("thread-old");
    expect(plainTranscript(mocks.runs[0].options.messages)).toEqual([
      { role: "user", content: "Old question" },
    ]);
    await completeRun(0, "A newer answer.");
    expect(savedMessages().map((message) => message.content)).toEqual([
      "Old question",
      "A newer answer.",
    ]);
  });

  it("keeps replaying when the thread cannot be rolled back", async () => {
    seedChat(
      [
        { id: "u1", role: "user", content: "Hello", turnId: "turn-1" },
        { id: "a1", role: "assistant", content: "Hi." },
      ],
      { threadId: "thread-1" },
    );
    mocks.agentThreadRead.mockResolvedValue([{ turnId: "turn-a", clientTurnId: "turn-1" }]);
    mocks.agentThreadRollback.mockRejectedValue(new Error("rollback refused"));
    await renderChat();
    await waitFor(() => expect(rowProps("a1")?.regenerateKind).toBe("regenerate"));

    await messageAction("regenerate", "a1");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.agentThreadRollback).toHaveBeenCalledWith("thread-1", 1);
    expect(mocks.logError).toHaveBeenCalledWith(
      "roll back thread",
      expect.objectContaining({ message: "rollback refused" }),
    );
    expect(plainTranscript(mocks.runs[0].options.messages)).toEqual([
      { role: "user", content: "Hello" },
    ]);
    await completeRun(0, "Hi again.");
  });

  it("keeps the turn when a regenerate cannot start", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-1");
    await renderChat();
    sendFromComposer("Summarise the notes");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Here is the summary.");
    const [user, reply] = savedMessages();
    mocks.agentThreadRead.mockResolvedValue([{ turnId: "turn-a", clientTurnId: user.turnId }]);
    await waitFor(() => expect(rowProps(reply.id as string)?.regenerateKind).toBe("regenerate"));

    mocks.checkProjectBudget.mockResolvedValue("blocked");
    await messageAction("regenerate", reply.id as string);
    await waitFor(() => expect(mocks.checkProjectBudget).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    // The budget stopped the run: the question and the answer are still there, on screen, on disk and in the thread.
    expect(mocks.runs).toHaveLength(1);
    expect(mocks.agentThreadRollback).not.toHaveBeenCalled();
    expect(savedMessages().map((message) => message.content)).toEqual(["Summarise the notes", "Here is the summary."]);
    expect(rowProps(reply.id as string)).toBeDefined();

    mocks.checkProjectBudget.mockResolvedValue("ok");
    await messageAction("regenerate", reply.id as string);
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(mocks.agentThreadRollback).toHaveBeenCalledWith("thread-1", 1);
    await completeRun(1, "A second summary.");
  });

  it("keeps an edit and its text when the run cannot start", async () => {
    mocks.claimPrewarmed.mockResolvedValue("thread-1");
    const rendered = await renderChat();
    sendFromComposer("Draw the table");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Here is the table.");
    const [user] = savedMessages();
    mocks.agentThreadRead.mockResolvedValue([{ turnId: "turn-a", clientTurnId: user.turnId }]);
    await waitFor(() => expect(rowProps(user.id as string)?.editable).toBe(true));
    await messageAction("edit", user.id as string);
    changeComposer("Draw the table with borders");

    mocks.checkProjectBudget.mockResolvedValue("blocked");
    pressEnter();
    await waitFor(() => expect(mocks.checkProjectBudget).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(activeChatRun()).toBeNull());

    expect(mocks.runs).toHaveLength(1);
    expect(rendered.getByTestId("ai-edit-banner")).toBeTruthy();
    expect(composerBox()).toHaveValue("Draw the table with borders");
    expect(savedMessages().map((message) => message.content)).toEqual(["Draw the table", "Here is the table."]);

    mocks.checkProjectBudget.mockResolvedValue("ok");
    pressEnter();
    await waitFor(() => expect(mocks.runs).toHaveLength(2));
    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
    expect(lastUserContent(1)).toBe("Draw the table with borders");
    await completeRun(1, "Here it is with borders.");
  });

  it("says which files of an older message cannot be sent again", async () => {
    seedChat([
      {
        id: "u1",
        role: "user",
        content: "Read these",
        turnId: "turn-1",
        attachments: [
          { name: "old.pdf", mediaType: "application/pdf" },
          { name: "plot.png", mediaType: "image/png", sha256: "sha-plot.png", size: 9, kind: "image" },
          { name: "table.csv", mediaType: "text/csv" },
        ],
      },
      { id: "a1", role: "assistant", content: "Read them." },
    ]);
    await renderChat();
    await waitFor(() => expect(rowProps("a1")?.regenerateKind).toBe("regenerate"));

    await messageAction("regenerate", "a1");

    expect(mocks.toastInfo).toHaveBeenCalledWith("Files from an older version can't be sent again: old.pdf, table.csv.");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    await completeRun(0, "Read again.");
  });

  it("stops a run and clears the transcript when its chat is deleted from the history", async () => {
    mocks.runAgentHarness.mockImplementationOnce(
      (options: HarnessOptions) =>
        new Promise((_resolve, reject) => {
          options.onRequestId?.("request-delete");
          options.handlers.onStep?.(0);
          options.handlers.onText("Started.");
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const rendered = await renderChat();
    sendFromComposer("Long task");
    await waitFor(() => expect(rendered.getByRole("button", { name: enAi.composer.stop })).toBeTruthy());
    const chatId = useChatsStore.getState().activeId as string;

    act(() => mocks.historyProps?.onDelete(chatId));

    await waitFor(() => expect(activeChatRun()).toBeNull());
    expect(useChatsStore.getState().byId(chatId)).toBeUndefined();
    expect(useChatsStore.getState().activeId).toBeNull();
    expect(rendered.queryByText("Long task")).toBeNull();
    // The next message starts a chat of its own, not a copy of the deleted one.
    sendFromComposer("Another question");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(plainTranscript(mocks.runs[0].options.messages)).toEqual([{ role: "user", content: "Another question" }]);
    await completeRun(0, "Another answer.");
    const fresh = useChatsStore.getState().chats.filter((chat) => chat.id !== chatId);
    expect(fresh.flatMap((chat) => chat.messages.map((message) => message.content))).not.toContain("Long task");
  });

  it("says when a reply could not be sent again", async () => {
    seedChat(
      [
        { id: "u1", role: "user", content: "Hello", turnId: "turn-1" },
        { id: "a1", role: "assistant", content: "Hi." },
      ],
      { threadId: "thread-1" },
    );
    mocks.agentThreadRead.mockRejectedValue(new Error("thread store locked"));
    await renderChat();
    await waitFor(() => expect(rowProps("a1")?.regenerateKind).toBe("regenerate"));

    await messageAction("regenerate", "a1");
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(enAi.messageActions.failed),
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "replay message",
      expect.objectContaining({ message: "thread store locked" }),
    );
    expect(mocks.runs).toHaveLength(0);
    expect(savedMessages().map((message) => message.id)).toEqual(["u1", "a1"]);
  });

  it("runs the approved plan again when its reply is regenerated", async () => {
    usePlanModeStore.getState().setEnabled(useFilesStore.getState().projectId, true);
    seedChat([
      { id: "u1", role: "user", content: "Plan the edit", turnId: "turn-1" },
      { id: "a1", role: "assistant", content: "Here is the plan." },
      { id: "u2", role: "user", content: "Carry out the approved plan.", turnId: "turn-2" },
      { id: "a2", role: "assistant", content: "Done." },
    ]);
    await renderChat();
    await waitFor(() => expect(rowProps("a2")?.regenerateKind).toBe("regenerate"));
    expect(rowProps("u1")?.editable).toBe(true);
    expect(rowProps("u2")?.editable).toBeUndefined();

    await messageAction("regenerate", "a2");
    await waitFor(() => expect(mocks.runs).toHaveLength(1));
    expect(mocks.runs[0].options.system).toContain("Plan mode: the user approved this plan:");
    expect(plainTranscript(mocks.runs[0].options.messages).at(-1)).toEqual({
      role: "user",
      content: "Carry out the approved plan.",
    });
    await completeRun(0, "Done again.");
  });

  it("ignores message actions it cannot apply", async () => {
    seedChat([
      { id: "a0", role: "assistant", content: "Welcome back." },
      { id: "u1", role: "user", content: "Hello", turnId: "turn-1" },
      { id: "a1", role: "assistant", content: "Hi." },
    ]);
    const rendered = await renderChat();
    await waitFor(() => expect(rowProps("a1")?.regenerateKind).toBe("regenerate"));
    expect(rowProps("a0")?.regenerateKind).toBeUndefined();

    await messageAction("regenerate", "a0");
    await messageAction("edit", "a1");
    await messageAction("edit", "missing");

    expect(mocks.runs).toHaveLength(0);
    expect(mocks.agentThreadRead).not.toHaveBeenCalled();
    expect(rendered.queryByTestId("ai-edit-banner")).toBeNull();
    expect(composerBox()).toHaveValue("");
  });
});
