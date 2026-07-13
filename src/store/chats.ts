import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import { loadProjectChats, saveProjectChats } from "@/lib/tauri";

export interface ToolEntry {
  name: string;
  status: "running" | "done" | "error";
  output?: string;
  /** For gated edits: whether the user approved or rejected the change. Left a
   *  persistent trace in the chat after the approval prompt is dismissed. */
  approval?: "approved" | "rejected";
}

/** Lightweight metadata for a file/image the user attached to a message. Only
 *  the name + media type are persisted (never the bytes) to protect storage
 *  quota; the bytes exist only in-session for the model call. */
export interface AttachmentMeta {
  name: string;
  mediaType: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolEntry[];
  attachments?: AttachmentMeta[];
  /** Legacy single-block chain-of-thought; still read for chats persisted
   *  before reasoningBlocks existed. */
  reasoning?: string;
  /** Legacy duration for the single `reasoning` block. */
  reasoningMs?: number;
  /** Chain-of-thought phases in arrival order. An agentic run can think
   *  between tool calls, so each phase records how many tool calls existed
   *  when it began (its interleave anchor). `ms` is set when the phase ends;
   *  undefined means it is still streaming. */
  reasoningBlocks?: ReasoningBlockData[];
}

export interface ReasoningBlockData {
  text: string;
  ms?: number;
  beforeTool: number;
}

/** Aggregated model usage for one chat conversation (sum of agent runs). */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  steps: number;
  /** Number of completed agent runs that reported usage. */
  runs: number;
  /** Rough USD estimate from list prices (not billing). */
  estimatedUsd?: number;
}

export interface StoredChat {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Git HEAD oid captured when the chat was started, used to warn the user
   *  that an older chat refers to an older project snapshot. */
  headOid: string | null;
  /** Cumulative token/step usage across agent runs in this chat. */
  usage?: ChatUsage;
}

interface ChatsState {
  projectId: string | null;
  chats: StoredChat[]; // current project, newest-first
  activeId: string | null;
  /** Load chats for a project from disk (Tauri) or localStorage (browser). */
  load: (projectId: string) => Promise<void>;
  create: (projectId: string, headOid: string | null) => StoredChat;
  saveMessages: (chatId: string, messages: ChatMessage[]) => void;
  patchTitleIfEmpty: (chatId: string, title: string) => void;
  /** Add a run's token usage into the chat's cumulative totals. */
  addUsage: (
    chatId: string,
    delta: {
      inputTokens: number;
      outputTokens: number;
      steps: number;
      /** Optional USD estimate for this run (precomputed with the model price). */
      estimatedUsd?: number;
    },
  ) => void;
  remove: (chatId: string) => void;
  setActive: (chatId: string | null) => void;
  byId: (chatId: string) => StoredChat | undefined;
}

const legacyKey = (pid: string) => `openleaf.chats.${pid}`;

/** Keep history bounded so storage never grows without limit. */
const MAX_CHATS_PER_PROJECT = 50;

/** Projects whose legacy localStorage payload has already been migrated this session. */
const migratedLegacy = new Set<string>();

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

/** Notify the app that persistence failed even after pruning, so the UI can
 *  tell the user their chat history has stopped being saved. */
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

/** Persist chats: disk in Tauri, localStorage in the browser/dev without IPC. */
function writeAll(pid: string, chats: StoredChat[]) {
  const capped = capChats(chats);
  const json = JSON.stringify(capped);
  if (isTauri()) {
    void saveProjectChats(pid, json).catch(() => {
      // Disk write failed (full disk / permissions). Retry once with a smaller
      // set so recent chats still land rather than failing silently.
      const trimmed = capChats(capped).slice(0, Math.max(1, Math.floor(MAX_CHATS_PER_PROJECT / 2)));
      void saveProjectChats(pid, JSON.stringify(trimmed)).catch(() => notifyQuota());
    });
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
        migratedLegacy.add(pid);
      }
      return chats;
    } catch {
      // Fall back to any localStorage remnant if the disk read fails.
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
    const chats = await readAll(projectId);
    memoryByProject.set(projectId, chats);
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
    memoryByProject.set(projectId, next);
    writeAll(projectId, next);
    set({ projectId, chats: next, activeId: chat.id });
    return chat;
  },

  saveMessages: (chatId, messages) => {
    const { projectId, chats } = get();
    if (!projectId) return;
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
    memoryByProject.set(projectId, updated);
    writeAll(projectId, updated);
    set({ chats: updated.sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  patchTitleIfEmpty: (chatId, title) => {
    const { projectId, chats } = get();
    if (!projectId) return;
    const updated = chats.map((c) =>
      c.id === chatId && (c.title === "New chat" || !c.title)
        ? { ...c, title: titleFrom(title) }
        : c
    );
    memoryByProject.set(projectId, updated);
    writeAll(projectId, updated);
    set({ chats: updated });
  },

  addUsage: (chatId, delta) => {
    const { projectId, chats } = get();
    if (!projectId) return;
    if (!chats.some((c) => c.id === chatId)) return;
    const updated = chats.map((c) => {
      if (c.id !== chatId) return c;
      const prev = c.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        steps: 0,
        runs: 0,
        estimatedUsd: 0,
      };
      return {
        ...c,
        usage: {
          inputTokens: prev.inputTokens + Math.max(0, delta.inputTokens || 0),
          outputTokens: prev.outputTokens + Math.max(0, delta.outputTokens || 0),
          steps: prev.steps + Math.max(0, delta.steps || 0),
          runs: prev.runs + 1,
          estimatedUsd: (prev.estimatedUsd ?? 0) + Math.max(0, delta.estimatedUsd || 0),
        },
        // Do NOT bump updatedAt here: usage is bookkeeping, and touching it
        // would reorder the chat to the top of the sidebar on every token
        // write. saveMessages already bumps updatedAt at the end of a run.
      };
    });
    memoryByProject.set(projectId, updated);
    writeAll(projectId, updated);
    // Preserve existing order (no re-sort) since updatedAt is unchanged.
    set({ chats: updated });
  },

  remove: (chatId) => {
    const { projectId, chats, activeId } = get();
    if (!projectId) return;
    const updated = chats.filter((c) => c.id !== chatId);
    memoryByProject.set(projectId, updated);
    writeAll(projectId, updated);
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
    return s.create(pid, null).id; // create() sets it active with zero usage
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
