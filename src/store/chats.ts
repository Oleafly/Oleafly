import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import { loadProjectChats, saveProjectChats } from "@/lib/tauri";

export interface ToolEntry {
  name: string;
  status: "running" | "done" | "error";
  output?: string;
  // For gated edits: whether the user approved or rejected the change. Left a
  // persistent trace in the chat after the approval prompt is dismissed.
  approval?: "approved" | "rejected";
}

// Only the name + media type are persisted (never the bytes) to protect
// storage quota; the bytes exist only in-session for the model call.
export interface AttachmentMeta {
  name: string;
  mediaType: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolEntry[];
  attachments?: AttachmentMeta[];
  // Legacy single-block chain-of-thought; still read for chats persisted
  // before reasoningBlocks existed.
  reasoning?: string;
  // Legacy duration for the single `reasoning` block.
  reasoningMs?: number;
  // Chain-of-thought phases in arrival order. An agentic run can think
  // between tool calls, so each phase records how many tool calls existed
  // when it began (its interleave anchor). `ms` is set when the phase ends;
  // undefined means it is still streaming.
  reasoningBlocks?: ReasoningBlockData[];
}

export interface ReasoningBlockData {
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
}

interface ChatsState {
  projectId: string | null;
  chats: StoredChat[]; // current project, newest-first
  activeId: string | null;
  load: (projectId: string) => Promise<void>;
  create: (projectId: string, headOid: string | null) => StoredChat;
  saveMessages: (chatId: string, messages: ChatMessage[]) => void;
  patchTitleIfEmpty: (chatId: string, title: string) => void;
  addUsage: (
    chatId: string,
    delta: {
      inputTokens: number;
      outputTokens: number;
      steps: number;
      // Precomputed with the model price; this store does not compute it.
      estimatedUsd?: number;
    },
  ) => void;
  addUsageForProject: (
    projectId: string,
    chatId: string,
    delta: {
      inputTokens: number;
      outputTokens: number;
      steps: number;
      estimatedUsd?: number;
    },
  ) => Promise<void>;
  remove: (chatId: string) => void;
  setActive: (chatId: string | null) => void;
  byId: (chatId: string) => StoredChat | undefined;
}

const legacyKey = (pid: string) => `openleaf.chats.${pid}`;

const MAX_CHATS_PER_PROJECT = 50;
const MAX_CACHED_PROJECTS = 16;

const migratedLegacy = new Set<string>();

function rememberMigration(projectId: string) {
  migratedLegacy.delete(projectId);
  migratedLegacy.add(projectId);
  if (migratedLegacy.size > MAX_CACHED_PROJECTS) {
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

function notifyQuota() {
  try {
    window.dispatchEvent(new CustomEvent("openleaf:chats-quota-exceeded"));
  } catch {
    /* non-browser / test env */
  }
}

function capChats(chats: StoredChat[]): StoredChat[] {
  if (chats.length <= MAX_CHATS_PER_PROJECT) return chats;
  return [...chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS_PER_PROJECT);
}

async function persistAll(pid: string, chats: StoredChat[]): Promise<void> {
  const capped = capChats(chats);
  const json = JSON.stringify(capped);
  if (isTauri()) {
    try {
      await saveProjectChats(pid, json);
    } catch {
      const trimmed = capChats(capped).slice(0, Math.max(1, Math.floor(MAX_CHATS_PER_PROJECT / 2)));
      try {
        await saveProjectChats(pid, JSON.stringify(trimmed));
      } catch {
        notifyQuota();
      }
    }
    return;
  }
  try {
    localStorage.setItem(legacyKey(pid), json);
  } catch {
    try {
      const trimmed = [...capped]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, Math.floor(MAX_CHATS_PER_PROJECT / 2)));
      localStorage.setItem(legacyKey(pid), JSON.stringify(trimmed));
    } catch {
      notifyQuota();
    }
  }
}

const persistChains = new Map<string, Promise<void>>();

function queuePersist(projectId: string, chats: StoredChat[]): Promise<void> {
  const previous = persistChains.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => persistAll(projectId, chats));
  persistChains.set(projectId, next);
  const cleanup = () => {
    if (persistChains.get(projectId) === next) persistChains.delete(projectId);
  };
  void next.then(cleanup, cleanup);
  return next;
}

async function readAll(pid: string): Promise<StoredChat[]> {
  if (isTauri()) {
    try {
      const raw = await loadProjectChats(pid);
      let chats = parseChats(raw);
      // One-shot migration: pull legacy localStorage chats into disk if disk is empty.
      if (chats.length === 0 && !migratedLegacy.has(pid)) {
        const legacy = readLegacyLocal(pid);
        if (legacy.length > 0) {
          chats = legacy;
          // Clear the localStorage copy only after the disk write confirmed;
          // otherwise a failed save would lose the whole history.
          try {
            await saveProjectChats(pid, JSON.stringify(capChats(legacy)));
            clearLegacyLocal(pid);
          } catch {
            /* keep the legacy copy; migration re-runs on a later session */
          }
        }
        rememberMigration(pid);
      }
      return chats;
    } catch {
      return readLegacyLocal(pid);
    }
  }
  return readLegacyLocal(pid);
}

function newId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 60) + "…" : t || "New chat";
}

// In-memory mirror used by create/save when an async load hasn't finished yet
// for the active project. Keyed by project id.
const memoryByProject = new Map<string, StoredChat[]>();

function cacheProjectChats(projectId: string, chats: StoredChat[]) {
  memoryByProject.delete(projectId);
  memoryByProject.set(projectId, chats);
  if (memoryByProject.size > MAX_CACHED_PROJECTS) {
    const oldest = memoryByProject.keys().next().value;
    if (oldest) memoryByProject.delete(oldest);
  }
}

function applyUsage(
  chats: StoredChat[],
  chatId: string,
  delta: { inputTokens: number; outputTokens: number; steps: number; estimatedUsd?: number },
): StoredChat[] {
  return chats.map((chat) => {
    if (chat.id !== chatId) return chat;
    const previous = chat.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      steps: 0,
      runs: 0,
      estimatedUsd: 0,
    };
    return {
      ...chat,
      usage: {
        inputTokens: previous.inputTokens + Math.max(0, delta.inputTokens || 0),
        outputTokens: previous.outputTokens + Math.max(0, delta.outputTokens || 0),
        steps: previous.steps + Math.max(0, delta.steps || 0),
        runs: previous.runs + 1,
        estimatedUsd: (previous.estimatedUsd ?? 0) + Math.max(0, delta.estimatedUsd || 0),
      },
    };
  });
}

// Monotonic ticket for load(); a resolved load only applies if it is still
// the newest request (same staleness pattern as the compile/preflight/index
// stores).
let loadSeq = 0;

export const useChatsStore = create<ChatsState>((set, get) => ({
  projectId: null,
  chats: [],
  activeId: null,

  load: async (projectId) => {
    // Staleness guard: only the latest requested load may write state. The
    // store's own projectId is NOT a valid reference here; on a normal A->B
    // switch it still holds A when B's load resolves.
    const my = ++loadSeq;
    const loaded = await readAll(projectId);
    const chats = memoryByProject.get(projectId) ?? loaded;
    cacheProjectChats(projectId, chats);
    if (my !== loadSeq) return; // a newer load superseded this one
    set({ projectId, chats, activeId: null });
  },

  create: (projectId, headOid) => {
    const chat: StoredChat = {
      id: newId(),
      projectId,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      headOid,
    };
    const existing = memoryByProject.get(projectId) ?? get().chats.filter((c) => c.projectId === projectId);
    const next = [chat, ...existing.filter((c) => c.id !== chat.id)];
    cacheProjectChats(projectId, next);
    void queuePersist(projectId, next);
    set({ projectId, chats: next, activeId: chat.id });
    return chat;
  },

  saveMessages: (chatId, messages) => {
    const { projectId } = get();
    if (!projectId) return;
    const chats = memoryByProject.get(projectId) ?? get().chats;
    // A debounced save can fire after the user switched projects (load
    // replaced projectId/chats). If the chat isn't in the current project's
    // list, writing here would needlessly rewrite the new project's chats and
    // silently drop this update. Skip it rather than corrupt the wrong project.
    if (!chats.some((c) => c.id === chatId)) return;
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
        : c
    );
    cacheProjectChats(projectId, updated);
    void queuePersist(projectId, updated);
    set({ chats: updated.sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  patchTitleIfEmpty: (chatId, title) => {
    const { projectId } = get();
    if (!projectId) return;
    const chats = memoryByProject.get(projectId) ?? get().chats;
    const updated = chats.map((c) =>
      c.id === chatId && (c.title === "New chat" || !c.title)
        ? { ...c, title: titleFrom(title) }
        : c
    );
    cacheProjectChats(projectId, updated);
    void queuePersist(projectId, updated);
    set({ chats: updated });
  },

  addUsage: (chatId, delta) => {
    const { projectId } = get();
    if (!projectId) return;
    const chats = memoryByProject.get(projectId) ?? get().chats;
    if (!chats.some((c) => c.id === chatId)) return;
    const updated = applyUsage(chats, chatId, delta);
    cacheProjectChats(projectId, updated);
    void queuePersist(projectId, updated);
    set({ chats: updated });
  },

  addUsageForProject: async (projectId, chatId, delta) => {
    const cached = memoryByProject.get(projectId);
    const loaded = cached ?? await readAll(projectId);
    const chats = memoryByProject.get(projectId) ?? loaded;
    if (!chats.some((chat) => chat.id === chatId)) return;
    const updated = applyUsage(chats, chatId, delta);
    cacheProjectChats(projectId, updated);
    if (get().projectId === projectId) set({ chats: updated });
    await queuePersist(projectId, updated);
    if (get().projectId === projectId) {
      set({ chats: memoryByProject.get(projectId) ?? updated });
    }
  },

  remove: (chatId) => {
    const { projectId, activeId } = get();
    if (!projectId) return;
    const chats = memoryByProject.get(projectId) ?? get().chats;
    const updated = chats.filter((c) => c.id !== chatId);
    cacheProjectChats(projectId, updated);
    void queuePersist(projectId, updated);
    set({ chats: updated, activeId: activeId === chatId ? null : activeId });
  },

  setActive: (chatId) => set({ activeId: chatId }),

  byId: (chatId) => get().chats.find((c) => c.id === chatId),
}));

// E2E / devtools: inspect and seed per-chat usage without a model call.
if (typeof window !== "undefined") {
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
