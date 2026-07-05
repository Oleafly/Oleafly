import { create } from "zustand";

export interface ToolEntry {
  name: string;
  status: "running" | "done" | "error";
  output?: string;
}

/** Lightweight metadata for a file/image the user attached to a message. Only
 *  the name + media type are persisted (never the bytes) to protect the
 *  localStorage quota; the bytes exist only in-session for the model call. */
export interface AttachmentMeta {
  name: string;
  mediaType: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolEntry[];
  attachments?: AttachmentMeta[];
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
}

interface ChatsState {
  projectId: string | null;
  chats: StoredChat[]; // current project, newest-first
  activeId: string | null;
  load: (projectId: string) => void;
  create: (projectId: string, headOid: string | null) => StoredChat;
  saveMessages: (chatId: string, messages: ChatMessage[]) => void;
  patchTitleIfEmpty: (chatId: string, title: string) => void;
  remove: (chatId: string) => void;
  setActive: (chatId: string | null) => void;
  byId: (chatId: string) => StoredChat | undefined;
}

const key = (pid: string) => `openleaf.chats.${pid}`;

/** Keep history bounded so localStorage (~5 MB/origin) never silently fills. */
const MAX_CHATS_PER_PROJECT = 50;

function readAll(pid: string): StoredChat[] {
  try {
    const raw = localStorage.getItem(key(pid));
    const arr: StoredChat[] = raw ? JSON.parse(raw) : [];
    return arr.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
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

function writeAll(pid: string, chats: StoredChat[]) {
  // Cap the number of retained chats (newest-first), pruning the oldest.
  const capped =
    chats.length > MAX_CHATS_PER_PROJECT
      ? [...chats]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CHATS_PER_PROJECT)
      : chats;
  try {
    localStorage.setItem(key(pid), JSON.stringify(capped));
  } catch {
    // Over quota: aggressively drop the oldest half and retry once so the most
    // recent conversations keep saving instead of failing silently.
    try {
      const trimmed = [...capped]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, Math.floor(MAX_CHATS_PER_PROJECT / 2)));
      localStorage.setItem(key(pid), JSON.stringify(trimmed));
    } catch {
      notifyQuota();
    }
  }
}

function newId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 60) + "…" : t || "New chat";
}

export const useChatsStore = create<ChatsState>((set, get) => ({
  projectId: null,
  chats: [],
  activeId: null,

  load: (projectId) => {
    const chats = readAll(projectId);
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
    const next = [chat, ...readAll(projectId)];
    writeAll(projectId, next);
    set({ projectId, chats: next, activeId: chat.id });
    return chat;
  },

  saveMessages: (chatId, messages) => {
    const { projectId, chats } = get();
    if (!projectId) return;
    const updated = chats.map((c) =>
      c.id === chatId
        ? { ...c, messages, updatedAt: Date.now(), title: c.title === "New chat" && messages[0]?.role === "user" ? titleFrom(messages[0].content) : c.title }
        : c
    );
    writeAll(projectId, updated);
    set({ chats: updated.sort((a, b) => b.updatedAt - a.updatedAt) });
  },

  patchTitleIfEmpty: (chatId, title) => {
    const { projectId, chats } = get();
    if (!projectId) return;
    const updated = chats.map((c) =>
      c.id === chatId && (c.title === "New chat" || !c.title) ? { ...c, title: titleFrom(title) } : c
    );
    writeAll(projectId, updated);
    set({ chats: updated });
  },

  remove: (chatId) => {
    const { projectId, chats, activeId } = get();
    if (!projectId) return;
    const updated = chats.filter((c) => c.id !== chatId);
    writeAll(projectId, updated);
    set({ chats: updated, activeId: activeId === chatId ? null : activeId });
  },

  setActive: (chatId) => set({ activeId: chatId }),

  byId: (chatId) => get().chats.find((c) => c.id === chatId),
}));
