import { create } from "zustand";
import { useChatRail } from "@/components/collab/chat-rail";
import { logError } from "@/lib/log";
import type { CollabChatChanged, CollabChatMessage, CollabErrorCode, CollabReaction } from "@/lib/tauri";
import {
  collabChatClear,
  collabChatDelete,
  collabChatList,
  collabChatReact,
  collabChatSend,
  onCollabChatChanged,
} from "@/lib/tauri-collab";
import { useSettingsStore } from "@/store/settings";
import { collabErrorCode } from "../errors";
import { commentMembers } from "../comments/comments-store";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabActivity } from "../sharing/activity-store";

export type ChatPhase = "idle" | "loading" | "ready" | "failed";

export interface ChatState {
  projectId: string | null;
  messages: CollabChatMessage[];
  phase: ChatPhase;
  error: CollabErrorCode | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  cursor: string | null;
}

export const CHAT_PAGE = 50;
const RELOAD_DELAY_MS = 150;

function blank(projectId: string | null): ChatState {
  return { projectId, messages: [], phase: "idle", error: null, hasOlder: false, loadingOlder: false, cursor: null };
}

export const useChat = create<ChatState>(() => blank(null));

function chronological(messages: readonly CollabChatMessage[]): CollabChatMessage[] {
  return [...messages].sort((left, right) => left.at - right.at);
}

function merged(...lists: readonly (readonly CollabChatMessage[])[]): CollabChatMessage[] {
  const byId = new Map<string, CollabChatMessage>();
  for (const list of lists) for (const message of list) byId.set(message.id, message);
  return chronological([...byId.values()]);
}

function same(left: readonly CollabChatMessage[], right: readonly CollabChatMessage[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function chatOpen(): boolean {
  const settings = useSettingsStore.getState();
  return settings.railTab === "chat" && settings.showTree;
}

let loadToken = 0;

export async function loadChat(): Promise<void> {
  const { projectId } = useChat.getState();
  if (!projectId) return;
  const token = ++loadToken;
  if (useChat.getState().phase !== "ready") useChat.setState({ phase: "loading", error: null });
  let listed: CollabChatMessage[];
  try {
    listed = await collabChatList(projectId, null, CHAT_PAGE);
  } catch (error) {
    if (token !== loadToken || useChat.getState().projectId !== projectId) return;
    const code = collabErrorCode(error);
    if (code === "not_found") {
      useChat.setState({ messages: [], phase: "ready", error: null, hasOlder: false, cursor: null });
      return;
    }
    void logError("collab chat load", error);
    useChat.setState({ phase: "failed", error: code });
    return;
  }
  if (token !== loadToken || useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => {
    const known = new Set(state.messages.map((message) => message.id));
    const joins = listed.some((message) => known.has(message.id));
    const next = joins ? merged(state.messages, listed) : chronological(listed);
    return {
      messages: same(state.messages, next) ? state.messages : next,
      phase: "ready",
      error: null,
      hasOlder: joins ? state.hasOlder : listed.length >= CHAT_PAGE,
      cursor: joins ? state.cursor : (listed[0]?.id ?? null),
    };
  });
}

export async function loadOlderChat(): Promise<void> {
  const { projectId, messages, loadingOlder, hasOlder, cursor } = useChat.getState();
  if (!projectId || loadingOlder || !hasOlder || messages.length === 0) return;
  useChat.setState({ loadingOlder: true });
  try {
    const older = await collabChatList(projectId, cursor ?? messages[0].id, CHAT_PAGE);
    if (useChat.getState().projectId !== projectId) return;
    useChat.setState((state) => {
      const known = new Set(state.messages.map((message) => message.id));
      const fresh = older.some((message) => !known.has(message.id));
      return {
        messages: fresh ? merged(older, state.messages) : state.messages,
        hasOlder: fresh && older.length >= CHAT_PAGE,
        cursor: fresh ? older[0].id : state.cursor,
      };
    });
  } catch (error) {
    void logError("collab chat older", error);
    if (useChat.getState().projectId === projectId) throw error;
  } finally {
    if (useChat.getState().projectId === projectId) useChat.setState({ loadingOlder: false });
  }
}

const drafts = new Map<string, string>();

export function chatDraft(projectId: string | null): string {
  return (projectId && drafts.get(projectId)) || "";
}

export function keepChatDraft(projectId: string | null, text: string): void {
  if (!projectId) return;
  if (text.trim()) drafts.set(projectId, text);
  else drafts.delete(projectId);
}

function requireProject(): string {
  const projectId = useChat.getState().projectId;
  if (!projectId) throw new Error("This project is not shared.");
  return projectId;
}

interface PendingChat {
  body: string;
  sent: Promise<void>;
  shown: boolean;
  failed: boolean;
}

const pending = new Map<string, PendingChat>();

export function pendingChat(projectId: string | null): PendingChat | undefined {
  return projectId ? pending.get(projectId) : undefined;
}

export function showPendingChat(projectId: string | null): () => void {
  const kept = pendingChat(projectId);
  if (projectId && kept?.failed) pending.delete(projectId);
  else if (kept) kept.shown = true;
  return () => {
    const left = pendingChat(projectId);
    if (left) left.shown = false;
  };
}

async function postChat(projectId: string, body: string): Promise<void> {
  const message = await collabChatSend(projectId, body, commentMembers());
  if (useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => ({ messages: merged(state.messages, [message]) }));
}

export async function sendChat(body: string): Promise<void> {
  const projectId = requireProject();
  const kept: PendingChat = { body, sent: postChat(projectId, body), shown: true, failed: false };
  pending.set(projectId, kept);
  try {
    await kept.sent;
    if (pending.get(projectId) === kept) pending.delete(projectId);
  } catch (error) {
    if (pending.get(projectId) === kept) {
      if (kept.shown) pending.delete(projectId);
      else kept.failed = true;
    }
    throw error;
  }
}

export async function deleteChat(id: string): Promise<void> {
  const projectId = requireProject();
  await collabChatDelete(projectId, id);
  if (useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => ({
    messages: state.messages.map((message) => (message.id === id ? { ...message, body: "", deleted: true } : message)),
  }));
}

export function withReaction(
  reactions: readonly CollabReaction[],
  emoji: string,
  self: string,
  on: boolean,
): CollabReaction[] {
  const listed = reactions.some((reaction) => reaction.emoji === emoji);
  const next = reactions.map((reaction) => {
    if (reaction.emoji !== emoji) return reaction;
    const others = reaction.by.filter((id) => id !== self);
    return { emoji, by: on ? [...others, self] : others };
  });
  if (on && !listed) next.push({ emoji, by: [self] });
  return next.filter((reaction) => reaction.by.length > 0);
}

export async function reactToChat(id: string, emoji: string, on: boolean): Promise<void> {
  const projectId = requireProject();
  await collabChatReact(projectId, id, emoji, on);
  const self = useCollabLiveStore.getState().share?.account_id;
  if (useChat.getState().projectId !== projectId || !self) return;
  useChat.setState((state) => ({
    messages: state.messages.map((message) =>
      message.id === id ? { ...message, reactions: withReaction(message.reactions ?? [], emoji, self, on) } : message,
    ),
  }));
}

export async function clearChat(): Promise<void> {
  const projectId = requireProject();
  await collabChatClear(projectId);
  if (useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => ({
    messages: state.messages.map((message) => ({ ...message, body: "", deleted: true })),
  }));
}

function noteChatMentions(payload: CollabChatChanged): void {
  const activity = useCollabActivity.getState();
  const members = useCollabLiveStore.getState().members;
  for (const mention of payload.mentioned ?? []) {
    const known = activity.entries.some((entry) => entry.kind === "chatMentioned" && entry.messageId === mention.messageId);
    if (known) continue;
    activity.add({
      kind: "chatMentioned",
      at: Date.now(),
      accountId: mention.author,
      name: members.find((member) => member.person.account_id === mention.author)?.person.display_name ?? "",
      messageId: mention.messageId,
    });
  }
}

export function startChat(): () => void {
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  drafts.clear();
  pending.clear();

  const cancelReload = () => {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = null;
  };

  const live = () => {
    const state = useCollabLiveStore.getState();
    return state.share !== null && state.projectId !== null && state.role !== null;
  };

  const openProject = () => {
    const state = useCollabLiveStore.getState();
    const projectId = state.share && state.projectId ? state.projectId : null;
    const rail = useChatRail.getState();
    if (rail.visible !== (projectId !== null)) {
      useChatRail.setState(projectId ? { visible: true } : { visible: false, unread: false });
    }
    if (projectId === useChat.getState().projectId) return;
    cancelReload();
    loadToken += 1;
    useChat.setState(blank(projectId));
    useChatRail.setState({ unread: false, reveal: null });
    if (projectId && live()) void loadChat();
  };

  const onChanged = (payload: CollabChatChanged) => {
    if (payload.projectId !== useChat.getState().projectId) return;
    noteChatMentions(payload);
    if (!payload.local && !chatOpen()) useChatRail.setState({ unread: true });
    cancelReload();
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void loadChat();
    }, RELOAD_DELAY_MS);
  };

  const stopLive = useCollabLiveStore.subscribe((state, previous) => {
    if (state.projectId !== previous.projectId || state.share !== previous.share) {
      openProject();
      return;
    }
    const cameOnline = state.status?.state === "online" && previous.status?.state !== "online";
    if ((state.role !== previous.role || cameOnline) && live()) void loadChat();
  });
  const stopSettings = useSettingsStore.subscribe((settings, previous) => {
    if (settings.railTab === previous.railTab && settings.showTree === previous.showTree) return;
    const open = chatOpen();
    if (open && useChatRail.getState().unread) useChatRail.setState({ unread: false });
    if (!open && previous.railTab === "chat" && previous.showTree) useChatRail.setState({ reveal: null });
  });
  const listening = onCollabChatChanged(onChanged).catch((error: unknown) => {
    void logError("collab chat listen", error);
    return () => undefined;
  });

  openProject();

  return () => {
    stopLive();
    stopSettings();
    void listening.then((unlisten) => unlisten());
    cancelReload();
    loadToken += 1;
    useChat.setState(blank(null));
    useChatRail.setState({ visible: false, unread: false, reveal: null });
  };
}
