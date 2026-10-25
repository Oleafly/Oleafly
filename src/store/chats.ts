import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import type { EffortLevel } from "@oleafly/ai-core";
import type { AttachmentKind, StoredAttachmentRef } from "@/components/ai/composer/types";
import { agentThreadDelete } from "@/lib/agent-backend";
import type { TurnChanges } from "@/lib/agent-turns";
import { attachmentGc } from "@/lib/attachments";
import type { WebSetting } from "@/lib/chat-settings";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { logError } from "@/lib/log";
import { chatDelete, chatRead, chatSave, chatsLoad } from "@/lib/tauri";
import { queuedAttachmentRefs, useAgentTurnsStore } from "@/store/agent-turns";
import { draftAttachmentRefs } from "@/store/composer-drafts";

export interface ToolEntry {
  id?: string;
  name: string;
  status: "running" | "done" | "error";
  output?: string;
  input?: string;
  // A screenshot as a data URL. Chats saved since 0.4.8 keep `imageRef`
  // (a stored attachment) on disk instead; `image` stays in memory.
  image?: string;
  imageRef?: StoredAttachmentRef;
  code?: string;
  // For gated edits: whether the user approved or rejected the change. Left a
  // persistent trace in the chat after the approval prompt is dismissed.
  approval?: "approved" | "rejected";
  // File changes a CLI agent reported for this tool call (ACP `diff` blocks).
  diffs?: ToolDiff[];
}

export interface ToolDiff {
  path: string;
  oldText: string | null;
  newText: string | null;
  // The text was too large to keep in the conversation.
  truncated?: boolean;
}

// The files an agent turn changed, as the turn review card shows them.
// `committed` maps a path to the commit the built-in assistant made for it
// during the turn; those files get no Undo.
export interface ChatTurnChanges extends TurnChanges {
  committed?: Record<string, string>;
}

// The bytes live in the attachment store (by sha256), never in the chat.
export interface AttachmentMeta {
  name: string;
  mediaType: string;
  /** The stored file (0.4.8 and later). Older entries carry only a name. */
  sha256?: string;
  size?: number;
  pages?: number;
  kind?: AttachmentKind;
  hasText?: boolean;
  /** Rendered first pages of a scanned PDF. */
  pageImages?: StoredAttachmentRef[];
}

export interface SubagentEntry {
  id: string;
  label: string;
  state: string;
  detail?: string;
  runtime?: string;
  sessionId?: string;
  providerId?: string;
  modelId?: string;
  agentId?: string;
}

/**
 * The note under a plan-mode reply that left no new plan. "missing": there is
 * no plan yet. "unchanged": a revision kept the plan as it was.
 */
export type ChatPlanNote = "missing" | "unchanged";

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  subagents?: SubagentEntry[];
  // Legacy: chats saved before per-turn Undo existed can still restore this.
  checkpointOid?: string;
  checkpointRestored?: boolean;
  // Files changed by the turn that ended with this message.
  turnChanges?: ChatTurnChanges;
  toolCalls?: ToolEntry[];
  attachments?: AttachmentMeta[];
  steered?: boolean;
  skillId?: string;
  // A skill sent alongside a CLI agent message (shown as a chip).
  skill?: { id: string; name: string };
  mentions?: string[];
  notices?: string[];
  planNote?: ChatPlanNote;
  // Legacy single-block chain-of-thought; still read for chats persisted
  // before reasoningBlocks existed.
  reasoning?: string;
  // Legacy duration for the single `reasoning` block.
  reasoningMs?: number;
  // The run ended with an error; its action is Retry.
  failed?: boolean;
  // The client turn id of the run this user message started.
  turnId?: string;
  // Chain-of-thought phases in arrival order. An agentic run can think
  // between tool calls, so each phase records how many tool calls existed
  // when it began (its interleave anchor). `ms` is set when the phase ends;
  // undefined means it is still streaming.
  reasoningBlocks?: ReasoningBlockData[];
}

export interface ReasoningBlockData {
  id?: string;
  text: string;
  ms?: number;
  beforeTool: number;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  steps: number;
  runs: number;
  // Rough USD estimate from list prices (not billing).
  estimatedUsd?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  // The context the model saw on the latest step, and its window.
  context?: { used: number; size: number };
}

export interface StoredChat {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  // Git HEAD oid captured when the chat was started, used to warn the user
  // that an older chat refers to an older project snapshot.
  headOid: string | null;
  usage?: ChatUsage;
  // The persistent rollout thread this chat maps to. Persisted so reopening
  // the chat after a restart continues the same thread instead of forking a
  // new one, and so deletion can remove the thread's rollout and search rows.
  threadId?: string;
  effort?: EffortLevel;
  web?: WebSetting;
  // Loaded without its messages (past the load budget); `loadChatBody`
  // reads them when the chat is opened.
  stub?: boolean;
  messageCount?: number;
}

/** Why a chat could not be saved; it keeps working in memory. */
export type ChatSaveProblem = "tooLarge";

interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  steps: number;
  // Precomputed with the model price; this store does not compute it.
  estimatedUsd?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  context?: { used: number; size: number };
}

interface ChatsState {
  projectId: string | null;
  chats: StoredChat[]; // current project, newest-first
  activeId: string | null;
  /** Chat files the last load could not read (they stay on disk). */
  skippedOnLoad: number;
  saveProblems: Readonly<Record<string, ChatSaveProblem>>;
  load: (projectId: string) => Promise<void>;
  create: (
    projectId: string,
    headOid: string | null,
    settings?: { effort?: EffortLevel; web?: WebSetting },
  ) => StoredChat;
  /**
   * `index: false` skips the search index (saves while a reply streams).
   * `projectId` saves into that project's chats instead of the one on show.
   */
  saveMessages: (chatId: string, messages: ChatMessage[], opts?: { index?: boolean; projectId?: string }) => void;
  patchTitleIfEmpty: (chatId: string, title: string) => void;
  addUsage: (chatId: string, delta: UsageDelta) => void;
  addUsageForProject: (projectId: string, chatId: string, delta: UsageDelta) => Promise<void>;
  /** `null` clears a setting. */
  setChatSettings: (
    chatId: string,
    patch: { effort?: EffortLevel | null; web?: WebSetting | null },
  ) => void;
  /** Sets the chat's cost from the usage ledger. */
  setChatCost: (chatId: string, usd: number) => void;
  /** Reads a stub's messages; resolves to the full chat. */
  loadChatBody: (chatId: string) => Promise<StoredChat | null>;
  remove: (chatId: string, opts?: { deleteThread?: boolean }) => void;
  setThreadId: (chatId: string, threadId: string) => void;
  setActive: (chatId: string | null) => void;
  byId: (chatId: string) => StoredChat | undefined;
  live: Record<string, ChatMessage[]>;
  setLive: (chatId: string, messages: ChatMessage[]) => void;
  clearLive: (chatId: string) => void;
  liveOrSaved: (chatId: string) => ChatMessage[] | undefined;
}

const legacyKey = (pid: string) => `oleafly.chats.${pid}`;

// The browser build keeps chats in localStorage, capped to fit its quota.
const MAX_BROWSER_CHATS_PER_PROJECT = 50;
// Chat bodies are big, so only the project in use and a few recent ones stay
// cached; a project that is not cached is read from disk again.
const MAX_CACHED_PROJECTS = 4;
const MAX_REMEMBERED_MIGRATIONS = 16;
const CHAT_TOO_LARGE = "[chat_too_large]";
const MAX_CHAT_JSON_LENGTH = 8 * 1024 * 1024;

const migratedLegacy = new Set<string>();

function rememberMigration(projectId: string) {
  migratedLegacy.delete(projectId);
  migratedLegacy.add(projectId);
  if (migratedLegacy.size > MAX_REMEMBERED_MIGRATIONS) {
    const oldest = migratedLegacy.values().next().value;
    if (oldest) migratedLegacy.delete(oldest);
  }
}

function parseChats(raw: string | null): StoredChat[] {
  if (!raw) return [];
  try {
    const arr: StoredChat[] = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function readLegacyLocal(pid: string): StoredChat[] {
  try {
    return parseChats(localStorage.getItem(legacyKey(pid)));
  } catch {
    return [];
  }
}

function clearLegacyLocal(pid: string) {
  try {
    localStorage.removeItem(legacyKey(pid));
  } catch {
    /* ignore */
  }
}

function notify(name: string, detail?: unknown) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    /* non-browser / test env */
  }
}

/** The chat as it goes to disk: screenshots kept by reference drop their data URL. */
export function chatForDisk(chat: StoredChat): StoredChat {
  let changed = false;
  const messages = chat.messages.map((message) => {
    if (!message.toolCalls?.some((tool) => tool.image && tool.imageRef)) return message;
    changed = true;
    return {
      ...message,
      toolCalls: message.toolCalls.map((tool) => {
        if (!(tool.image && tool.imageRef)) return tool;
        const { image: _image, ...rest } = tool;
        return rest;
      }),
    };
  });
  return changed ? { ...chat, messages } : chat;
}

/** Every stored attachment the chats use: user files, PDF page images, screenshots. */
export function chatAttachmentRefs(chats: readonly StoredChat[]): Set<string> {
  const refs = new Set<string>();
  for (const chat of chats) {
    for (const message of chat.messages) addMessageRefs(refs, message);
  }
  return refs;
}

/** The stored attachments of one transcript, saved or not. */
export function messageAttachmentRefs(messages: readonly ChatMessage[]): Set<string> {
  const refs = new Set<string>();
  for (const message of messages) addMessageRefs(refs, message);
  return refs;
}

function addMessageRefs(refs: Set<string>, message: ChatMessage): void {
  for (const attachment of message.attachments ?? []) {
    if (attachment.sha256) refs.add(attachment.sha256);
    for (const page of attachment.pageImages ?? []) refs.add(page.sha256);
  }
  for (const tool of message.toolCalls ?? []) {
    if (tool.imageRef) refs.add(tool.imageRef.sha256);
  }
}

export function chatMessageCount(chat: StoredChat): number {
  return chat.stub ? (chat.messageCount ?? 0) : chat.messages.length;
}

// ---- Browser persistence (localStorage, whole project at once) ----

function capChats(chats: StoredChat[]): StoredChat[] {
  if (chats.length <= MAX_BROWSER_CHATS_PER_PROJECT) return chats;
  return [...chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_BROWSER_CHATS_PER_PROJECT);
}

function persistBrowser(pid: string, chats: StoredChat[]): void {
  const capped = capChats(chats);
  try {
    localStorage.setItem(legacyKey(pid), JSON.stringify(capped));
  } catch {
    try {
      const trimmed = [...capped]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, Math.floor(MAX_BROWSER_CHATS_PER_PROJECT / 2)));
      localStorage.setItem(legacyKey(pid), JSON.stringify(trimmed));
    } catch {
      notify("oleafly:chats-quota-exceeded");
    }
  }
}

const browserChains = new Map<string, Promise<void>>();

function queueBrowserPersist(projectId: string, chats: StoredChat[]): Promise<void> {
  const previous = browserChains.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => persistBrowser(projectId, chats));
  browserChains.set(projectId, next);
  const cleanup = () => {
    if (browserChains.get(projectId) === next) browserChains.delete(projectId);
  };
  void next.then(cleanup, cleanup);
  return next;
}

// ---- Desktop persistence (one file per chat) ----

// The newest chat state of a waiting save: a project evicted from the cache
// before its save runs is still written.
const pendingSaves = new Map<string, { index: boolean; chat: StoredChat | undefined }>();
const runningSaves = new Map<string, Promise<void>>();

function saveKey(projectId: string, chatId: string): string {
  return `${projectId}\u0000${chatId}`;
}

function setSaveProblem(chatId: string, problem: ChatSaveProblem | null) {
  useChatsStore.setState((state) => {
    if (problem === null) {
      if (!(chatId in state.saveProblems)) return state;
      const { [chatId]: _cleared, ...rest } = state.saveProblems;
      return { saveProblems: rest };
    }
    if (state.saveProblems[chatId] === problem) return state;
    return { saveProblems: { ...state.saveProblems, [chatId]: problem } };
  });
}

function isChatTooLarge(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(CHAT_TOO_LARGE);
}

async function drainSaves(projectId: string, chatId: string, key: string): Promise<void> {
  for (;;) {
    const job = pendingSaves.get(key);
    if (!job) return;
    pendingSaves.delete(key);
    // The chat is read when the save runs, so the newest state lands last.
    const chat = memoryByProject.get(projectId)?.find((candidate) => candidate.id === chatId) ?? job.chat;
    if (!chat || chat.stub) continue;
    const json = JSON.stringify(chatForDisk(chat));
    if (json.length > MAX_CHAT_JSON_LENGTH) {
      setSaveProblem(chatId, "tooLarge");
      continue;
    }
    try {
      await chatSave(projectId, chatId, json, job.index);
      setSaveProblem(chatId, null);
    } catch (error) {
      if (isChatTooLarge(error)) {
        setSaveProblem(chatId, "tooLarge");
      } else {
        void logError("save chat", error);
        notify("oleafly:chat-save-failed", { chatId });
      }
    }
  }
}

/** Saves one chat; rapid saves of the same chat coalesce. */
function queueChatSave(projectId: string, chatId: string, index = true, chat?: StoredChat): void {
  const key = saveKey(projectId, chatId);
  const pending = pendingSaves.get(key);
  pendingSaves.set(key, { index: Boolean(pending?.index) || index, chat });
  if (runningSaves.has(key)) return;
  const run = drainSaves(projectId, chatId, key).finally(() => {
    runningSaves.delete(key);
  });
  runningSaves.set(key, run);
}

function persistChange(projectId: string, chatId: string, chats: StoredChat[], index = true) {
  if (isTauri()) queueChatSave(projectId, chatId, index, chats.find((candidate) => candidate.id === chatId));
  else void queueBrowserPersist(projectId, chats);
}

async function collectAttachments(projectId: string, remaining: readonly StoredChat[]) {
  // A list that never met the chat files (a chat created before the first
  // load finished) holds only some of the chats; the files of the others
  // would look unused.
  if (!loadedFromDisk.has(projectId)) return;
  // A stub's attachments are unknown until its body loads.
  if (remaining.some((chat) => chat.stub)) return;
  const keep = new Set([
    ...chatAttachmentRefs(remaining),
    // A reply still streaming has files the saved chat does not list yet (a
    // screenshot stored a moment ago).
    ...Object.values(useChatsStore.getState().live).flatMap((messages) => [...messageAttachmentRefs(messages)]),
    ...draftAttachmentRefs(projectId),
    ...queuedAttachmentRefs(),
  ]);
  try {
    await attachmentGc(projectId, [...keep]);
  } catch (error) {
    void logError("collect attachments", error);
  }
}

/** `fromDisk` is false when the chat files could not be read and the list is whatever else was found. */
async function readAll(pid: string): Promise<{ chats: StoredChat[]; skipped: number; fromDisk: boolean }> {
  if (!isTauri()) return { chats: readLegacyLocal(pid), skipped: 0, fromDisk: false };
  try {
    const loaded = await chatsLoad(pid);
    let chats = parseChats(loaded.json);
    // One-shot migration: pull legacy localStorage chats onto disk.
    if (chats.length === 0 && !migratedLegacy.has(pid)) {
      const legacy = readLegacyLocal(pid);
      if (legacy.length > 0) {
        chats = legacy;
        // Clear the localStorage copy only after every disk write confirmed;
        // otherwise a failed save would lose history.
        const writes = await Promise.allSettled(
          legacy.map((chat) => chatSave(pid, chat.id, JSON.stringify(chatForDisk(chat)), true)),
        );
        if (writes.every((write) => write.status === "fulfilled")) clearLegacyLocal(pid);
      }
      rememberMigration(pid);
    }
    return { chats, skipped: loaded.skipped, fromDisk: true };
  } catch (error) {
    void logError("load chats", error);
    return { chats: readLegacyLocal(pid), skipped: 0, fromDisk: false };
  }
}

function newId() {
  return `chat_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t || "New chat";
}

// In-memory mirror used by create/save when an async load hasn't finished yet
// for the active project. Keyed by project id.
const memoryByProject = new Map<string, StoredChat[]>();

// Projects whose cached list is known to hold every chat file: it came from a
// successful read of them, not only from chats created since.
const loadedFromDisk = new Set<string>();
// Chats deleted whose file may still be there, so a load does not bring them back.
const removedChats = new Set<string>();

function cacheProjectChats(projectId: string, chats: StoredChat[]) {
  memoryByProject.delete(projectId);
  memoryByProject.set(projectId, chats);
  const shown = useChatsStore.getState().projectId;
  for (const candidate of memoryByProject.keys()) {
    if (memoryByProject.size <= MAX_CACHED_PROJECTS) break;
    if (candidate === projectId || candidate === shown) continue;
    memoryByProject.delete(candidate);
    loadedFromDisk.delete(candidate);
  }
}

/** The chats read from disk plus the ones held in memory; memory wins for a chat in both. */
function mergeLoaded(projectId: string, cached: readonly StoredChat[], disk: readonly StoredChat[]): StoredChat[] {
  const byId = new Map<string, StoredChat>();
  for (const chat of disk) if (!removedChats.has(saveKey(projectId, chat.id))) byId.set(chat.id, chat);
  for (const chat of cached) byId.set(chat.id, chat);
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function nonNegative(value: number | undefined): number {
  return Math.max(0, value || 0);
}

function applyUsage(chats: StoredChat[], chatId: string, delta: UsageDelta): StoredChat[] {
  return chats.map((chat) => {
    if (chat.id !== chatId) return chat;
    const previous = chat.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      steps: 0,
      runs: 0,
      estimatedUsd: 0,
    };
    const usage: ChatUsage = {
      inputTokens: previous.inputTokens + nonNegative(delta.inputTokens),
      outputTokens: previous.outputTokens + nonNegative(delta.outputTokens),
      steps: previous.steps + nonNegative(delta.steps),
      runs: previous.runs + 1,
      estimatedUsd: (previous.estimatedUsd ?? 0) + nonNegative(delta.estimatedUsd),
    };
    if (previous.cacheReadTokens !== undefined || delta.cacheReadTokens !== undefined) {
      usage.cacheReadTokens = nonNegative(previous.cacheReadTokens) + nonNegative(delta.cacheReadTokens);
    }
    if (previous.cacheWriteTokens !== undefined || delta.cacheWriteTokens !== undefined) {
      usage.cacheWriteTokens =
        nonNegative(previous.cacheWriteTokens) + nonNegative(delta.cacheWriteTokens);
    }
    const context = delta.context ?? previous.context;
    if (context) usage.context = { ...context };
    return { ...chat, usage };
  });
}

// Monotonic ticket for load(); a resolved load only applies if it is still
// the newest request (same staleness pattern as the compile/preflight/index
// stores).
let loadSeq = 0;

export const useChatsStore = create<ChatsState>((set, get) => {
  // The chats the store edits: the cached list for the current project.
  const current = (projectId: string) => memoryByProject.get(projectId) ?? get().chats;

  const update = (
    projectId: string,
    chatId: string,
    chats: StoredChat[],
    opts?: { index?: boolean; sort?: boolean },
  ) => {
    // Sorted once, and the same array goes to the cache and the store, so a
    // later update that does not sort cannot put the old order back.
    const next = opts?.sort ? [...chats].sort((a, b) => b.updatedAt - a.updatedAt) : chats;
    cacheProjectChats(projectId, next);
    persistChange(projectId, chatId, next, opts?.index ?? true);
    if (get().projectId === projectId) set({ chats: next });
  };

  return {
    projectId: null,
    chats: [],
    activeId: null,
    skippedOnLoad: 0,
    saveProblems: {},

    load: async (projectId) => {
      // Staleness guard: only the latest requested load may write state. The
      // store's own projectId is NOT a valid reference here; on a normal A->B
      // switch it still holds A when B's load resolves.
      const my = ++loadSeq;
      const loaded = await readAll(projectId);
      // A chat created while the files were read is in memory but not in
      // them, and what a chat gained since is newer than the file: merge.
      const cached = memoryByProject.get(projectId);
      const chats = cached ? mergeLoaded(projectId, cached, loaded.chats) : loaded.chats;
      cacheProjectChats(projectId, chats);
      if (loaded.fromDisk) loadedFromDisk.add(projectId);
      if (my !== loadSeq) return; // a newer load superseded this one
      set((state) => {
        const shown = state.projectId === projectId;
        return {
          projectId,
          chats,
          // The chat a run is using keeps being the active one.
          activeId: shown && chats.some((chat) => chat.id === state.activeId) ? state.activeId : null,
          skippedOnLoad: loaded.skipped,
          live: shown ? state.live : {},
        };
      });
    },

    create: (projectId, headOid, settings) => {
      const chat: StoredChat = {
        id: newId(),
        projectId,
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        headOid,
      };
      if (settings?.effort) chat.effort = settings.effort;
      if (settings?.web) chat.web = { ...settings.web };
      const existing =
        memoryByProject.get(projectId) ?? get().chats.filter((c) => c.projectId === projectId);
      const next = [chat, ...existing.filter((c) => c.id !== chat.id)];
      cacheProjectChats(projectId, next);
      persistChange(projectId, chat.id, next);
      set({ projectId, chats: next, activeId: chat.id });
      return chat;
    },

    saveMessages: (chatId, messages, opts) => {
      const projectId = opts?.projectId ?? get().projectId;
      if (!projectId) return;
      // Another project's chats are edited only while they are cached.
      const chats = projectId === get().projectId ? current(projectId) : memoryByProject.get(projectId);
      if (!chats) return;
      // A debounced save can fire after the user switched projects (load
      // replaced projectId/chats). If the chat isn't in the current project's
      // list, writing here would put the update in the wrong place. A stub
      // must load its body first, or the save would drop its history.
      const target = chats.find((c) => c.id === chatId);
      if (!target || target.stub) return;
      const updated = chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages,
              updatedAt: Date.now(),
              title:
                c.title === "New chat" && messages[0]?.role === "user"
                  ? titleFrom(messages[0].content)
                  : c.title,
            }
          : c,
      );
      update(projectId, chatId, updated, { index: opts?.index, sort: true });
    },

    patchTitleIfEmpty: (chatId, title) => {
      const { projectId } = get();
      if (!projectId) return;
      const chats = current(projectId);
      const target = chats.find((c) => c.id === chatId);
      if (!target || (target.title !== "New chat" && target.title)) return;
      const updated = chats.map((c) => (c.id === chatId ? { ...c, title: titleFrom(title) } : c));
      update(projectId, chatId, updated);
    },

    addUsage: (chatId, delta) => {
      const { projectId } = get();
      if (!projectId) return;
      const chats = current(projectId);
      const target = chats.find((c) => c.id === chatId);
      if (!target || target.stub) return;
      update(projectId, chatId, applyUsage(chats, chatId, delta));
    },

    addUsageForProject: async (projectId, chatId, delta) => {
      let chats = memoryByProject.get(projectId);
      let read: Awaited<ReturnType<typeof readAll>> | null = null;
      if (!chats || !loadedFromDisk.has(projectId)) {
        read = await readAll(projectId);
        const memory = memoryByProject.get(projectId);
        chats = memory ? mergeLoaded(projectId, memory, read.chats) : read.chats;
      }
      const target = chats.find((chat) => chat.id === chatId);
      if (!target || target.stub) return;
      update(projectId, chatId, applyUsage(chats, chatId, delta));
      if (read?.fromDisk) loadedFromDisk.add(projectId);
    },

    setChatSettings: (chatId, patch) => {
      const { projectId } = get();
      if (!projectId) return;
      const chats = current(projectId);
      if (!chats.some((c) => c.id === chatId)) return;
      const updated = chats.map((c) => {
        if (c.id !== chatId) return c;
        const next: StoredChat = { ...c };
        if (patch.effort === null) delete next.effort;
        else if (patch.effort !== undefined) next.effort = patch.effort;
        if (patch.web === null) delete next.web;
        else if (patch.web !== undefined) next.web = { ...patch.web };
        return next;
      });
      update(projectId, chatId, updated);
    },

    setChatCost: (chatId, usd) => {
      const { projectId } = get();
      if (!projectId || !Number.isFinite(usd) || usd < 0) return;
      const chats = current(projectId);
      const target = chats.find((c) => c.id === chatId);
      if (!target || target.stub) return;
      const updated = chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              usage: {
                ...(c.usage ?? { inputTokens: 0, outputTokens: 0, steps: 0, runs: 0 }),
                estimatedUsd: usd,
              },
            }
          : c,
      );
      update(projectId, chatId, updated);
    },

    loadChatBody: async (chatId) => {
      const { projectId } = get();
      if (!projectId) return null;
      const chat = current(projectId).find((c) => c.id === chatId);
      if (!chat) return null;
      if (!chat.stub) return chat;
      const body = JSON.parse(await chatRead(projectId, chatId)) as StoredChat;
      if (!body || body.id !== chatId || !Array.isArray(body.messages)) {
        throw new Error(`chat ${chatId} could not be read`);
      }
      const updated = current(projectId).map((c) => (c.id === chatId ? body : c));
      cacheProjectChats(projectId, updated);
      if (get().projectId === projectId) set({ chats: updated });
      return body;
    },

    remove: (chatId, opts) => {
      const { projectId, activeId } = get();
      if (!projectId) return;
      const chats = current(projectId);
      const removed = chats.find((c) => c.id === chatId);
      const updated = chats.filter((c) => c.id !== chatId);
      cacheProjectChats(projectId, updated);
      if (isTauri()) {
        const key = saveKey(projectId, chatId);
        pendingSaves.delete(key);
        removedChats.add(key);
        // Delete after a save still in flight, so it cannot bring the file back.
        const inFlight = runningSaves.get(key) ?? Promise.resolve();
        void inFlight
          .then(() => chatDelete(projectId, chatId))
          .then(() => {
            removedChats.delete(key);
            return collectAttachments(projectId, memoryByProject.get(projectId) ?? updated);
          })
          .catch((error: unknown) => {
            removedChats.delete(key);
            void logError("delete chat", error);
          });
      } else {
        void queueBrowserPersist(projectId, updated);
      }
      set({ chats: updated, activeId: activeId === chatId ? null : activeId });
      setSaveProblem(chatId, null);
      get().clearLive(chatId);
      // Delete the mapped rollout and its search-index rows so a removed chat
      // leaves nothing behind. The persisted mapping wins; the in-memory one
      // covers a chat deleted within the same session before it persisted.
      const threadId =
        removed?.threadId ?? useAgentTurnsStore.getState().threadByChat[chatId];
      if ((opts?.deleteThread ?? true) && threadId)
        void agentThreadDelete(threadId).catch(() => {});
      useAgentTurnsStore.getState().dropChat(chatId);
    },

    setThreadId: (chatId, threadId) => {
      const { projectId } = get();
      if (!projectId) return;
      const chats = current(projectId);
      const target = chats.find((c) => c.id === chatId);
      if (!target || target.threadId === threadId) return;
      const updated = chats.map((c) => (c.id === chatId ? { ...c, threadId } : c));
      update(projectId, chatId, updated);
    },

    setActive: (chatId) => set({ activeId: chatId }),

    byId: (chatId) => get().chats.find((c) => c.id === chatId),

    live: {},

    setLive: (chatId, messages) => set((s) => ({ live: { ...s.live, [chatId]: messages } })),

    clearLive: (chatId) =>
      set((s) => {
        if (!(chatId in s.live)) return s;
        const next = { ...s.live };
        delete next[chatId];
        return { live: next };
      }),

    liveOrSaved: (chatId) => get().live[chatId] ?? get().byId(chatId)?.messages,
  };
});

// E2E / devtools: inspect and seed per-chat usage without a model call.
if (typeof window !== "undefined" && E2E_HOOKS) {
  const w = window as unknown as {
    __chatUsageAdd?: (
      chatId: string,
      delta: { inputTokens: number; outputTokens: number; steps: number },
    ) => void;
    __chatUsageGet?: (chatId: string) => ChatUsage | null;
    __chatEnsureAndUsage?: (delta: {
      inputTokens: number;
      outputTokens: number;
      steps: number;
      estimatedUsd?: number;
    }) => ChatUsage | null;
    __chatStartFresh?: () => string | null;
  };
  // Start a brand-new active chat (zero usage). Lets a usage test assert
  // absolute totals without inheriting usage a prior test left on the active chat.
  w.__chatStartFresh = () => {
    const s = useChatsStore.getState();
    const pid = s.projectId;
    if (!pid) return null;
    return s.create(pid, null).id;
  };
  w.__chatUsageAdd = (chatId, delta) => useChatsStore.getState().addUsage(chatId, delta);
  w.__chatUsageGet = (chatId) => useChatsStore.getState().byId(chatId)?.usage ?? null;
  w.__chatEnsureAndUsage = (delta) => {
    const s = useChatsStore.getState();
    const pid = s.projectId;
    if (!pid) return null;
    let id = s.activeId;
    if (!id) id = s.create(pid, null).id;
    s.addUsage(id, delta);
    return s.byId(id)?.usage ?? null;
  };
}
