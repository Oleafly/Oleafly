import { create } from "zustand";
import { useChatRail } from "@/components/collab/chat-rail";
import { logError, logWarning } from "@/lib/log";
import { withPending } from "@/components/ui/comments/comment-reactions";
import type { CollabChatChanged, CollabChatMessage, CollabChatStatus, CollabErrorCode } from "@/lib/tauri";
import {
  collabChatClear,
  collabChatDelete,
  collabChatEdit,
  collabChatList,
  collabChatReact,
  collabChatSend,
  collabChatStatus,
  onCollabChatChanged,
  onCollabCommentsStatus,
} from "@/lib/tauri-collab";
import { useSettingsStore } from "@/store/settings";
import { collabErrorCode } from "../errors";
import { commentMembers, sameData } from "../comments/comments-store";
import { reported } from "../comments/refusals";
import { liveJoinedProjectId, liveSelfId, useCollabLiveStore } from "../live/live-store";
import { useCollabActivity } from "../sharing/activity-store";

export type ChatPhase = "idle" | "loading" | "ready" | "failed";

export interface ChatState {
  projectId: string | null;
  status: CollabChatStatus | null;
  messages: CollabChatMessage[];
  phase: ChatPhase;
  error: CollabErrorCode | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  cursor: string | null;
}

export const CHAT_PAGE = 50;
const REFRESH_PAGE = 200;
const RELOAD_DELAY_MS = 150;

function blank(projectId: string | null): ChatState {
  return {
    projectId,
    status: null,
    messages: [],
    phase: "idle",
    error: null,
    hasOlder: false,
    loadingOlder: false,
    cursor: null,
  };
}

export const useChat = create<ChatState>(() => blank(null));

function chatAvailable(status: CollabChatStatus | null): boolean {
  return status?.available === true;
}

function chronological(messages: readonly CollabChatMessage[]): CollabChatMessage[] {
  return [...messages].sort((left, right) => left.at - right.at);
}

function merged(...lists: readonly (readonly CollabChatMessage[])[]): CollabChatMessage[] {
  const byId = new Map<string, CollabChatMessage>();
  for (const list of lists) for (const message of list) byId.set(message.id, message);
  return chronological([...byId.values()]);
}

function chatOpen(): boolean {
  const settings = useSettingsStore.getState();
  return settings.railTab === "chat" && settings.showTree;
}

function mine(message: CollabChatMessage, self: string | null): boolean {
  return message.verified && message.author === self;
}

function othersWrote(listed: readonly CollabChatMessage[], seen: ReadonlySet<string>, self: string | null): boolean {
  for (let index = listed.length - 1; index >= 0 && !seen.has(listed[index].id); index -= 1) {
    if (!listed[index].deleted && !mine(listed[index], self)) return true;
  }
  return false;
}

let loadToken = 0;

interface OlderPages {
  messages: CollabChatMessage[];
  complete: boolean;
}

async function shownBefore(
  projectId: string,
  newest: readonly CollabChatMessage[],
  cursor: string,
  known: ReadonlySet<string>,
  current: () => boolean,
): Promise<OlderPages> {
  const messages: CollabChatMessage[] = [];
  let before = newest[0]?.id;
  for (let page = 0; before && page <= Math.ceil(known.size / REFRESH_PAGE) && current(); page += 1) {
    const older = await collabChatList(projectId, before, REFRESH_PAGE);
    messages.unshift(...older);
    if (older.length < REFRESH_PAGE || older.some((message) => message.id === cursor)) return { messages, complete: true };
    before = older[0].id;
  }
  return { messages, complete: false };
}

function cursorAfter(
  cursor: string | null,
  gone: (id: string) => boolean,
  fetched: readonly CollabChatMessage[],
  next: readonly CollabChatMessage[],
): string | null {
  if (cursor === null || !gone(cursor)) return cursor;
  const shown = new Set(next.map((message) => message.id));
  return fetched.find((message) => shown.has(message.id))?.id ?? next[0]?.id ?? null;
}

export async function loadChat(): Promise<void> {
  const shown = useChat.getState();
  const { projectId } = shown;
  if (!projectId || !chatAvailable(shown.status)) return;
  const token = ++loadToken;
  const current = () => token === loadToken && useChat.getState().projectId === projectId;
  const seen = new Set(shown.messages.map((message) => message.id));
  const settled = shown.phase === "ready";
  if (!settled) useChat.setState({ phase: "loading", error: null });
  const limit = shown.messages.length === 0 ? CHAT_PAGE : Math.min(REFRESH_PAGE, shown.messages.length + CHAT_PAGE);
  let listed: CollabChatMessage[];
  try {
    listed = await collabChatList(projectId, null, limit);
  } catch (error) {
    if (!current()) return;
    const code = collabErrorCode(error);
    if (code === "not_found") {
      useChat.setState({ messages: [], phase: "ready", error: null, hasOlder: false, cursor: null });
      return;
    }
    void logError("collab chat load", error);
    useChat.setState({ phase: "failed", error: code });
    return;
  }
  if (!current()) return;
  const { messages, cursor } = useChat.getState();
  const known = new Set(messages.map((message) => message.id));
  let older: CollabChatMessage[] = [];
  let complete = listed.length < limit || listed.some((message) => message.id === cursor);
  if (!complete && cursor && listed.some((message) => known.has(message.id))) {
    try {
      ({ messages: older, complete } = await shownBefore(projectId, listed, cursor, known, current));
    } catch (error) {
      void logWarning("collab chat refresh older", error);
    }
    if (!current()) return;
  }
  const fetched = [...older, ...listed];
  const present = new Set(fetched.map((message) => message.id));
  const gone = (id: string) => complete && seen.has(id) && !present.has(id);
  const self = liveSelfId(useCollabLiveStore.getState());
  useChat.setState((state) => {
    const known = new Set(state.messages.map((message) => message.id));
    const joins = listed.some((message) => known.has(message.id));
    const start = joins ? listed.findIndex((message) => message.id === state.cursor) : -1;
    const fresh = start > 0 ? listed.slice(start) : listed;
    const kept = state.messages.filter((message) => !gone(message.id));
    const refreshed = older.filter((message) => known.has(message.id));
    const next = joins ? merged(kept, refreshed, fresh) : chronological(listed);
    return {
      messages: sameData(state.messages, next) ? state.messages : next,
      phase: "ready",
      error: null,
      hasOlder: joins ? state.hasOlder : listed.length >= CHAT_PAGE,
      cursor: joins ? cursorAfter(state.cursor, gone, fetched, next) : (listed[0]?.id ?? null),
    };
  });
  if (settled && !chatOpen() && othersWrote(listed, seen, self)) useChatRail.setState({ unread: true });
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
    const here = useChat.getState().projectId === projectId;
    if (here && collabErrorCode(error) === "not_found") {
      await loadChat();
      return;
    }
    void logError("collab chat older", error);
    if (here) throw error;
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

function showWritten(projectId: string, message: CollabChatMessage): void {
  if (useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => ({ messages: merged(state.messages, [message]) }));
}

async function postChat(projectId: string, body: string): Promise<void> {
  showWritten(projectId, await reported("collab chat send", () => collabChatSend(projectId, body, commentMembers())));
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

export async function editChat(id: string, body: string): Promise<void> {
  const projectId = requireProject();
  showWritten(projectId, await reported("collab chat edit", () => collabChatEdit(projectId, id, body, commentMembers())));
}

export async function deleteChat(id: string): Promise<void> {
  const projectId = requireProject();
  await reported("collab chat delete", () => collabChatDelete(projectId, id));
  if (useChat.getState().projectId !== projectId) return;
  await loadChat();
  if (useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => ({
    messages: state.messages.map((message) =>
      message.id === id && !message.deleted ? { ...message, body: "", deleted: true } : message,
    ),
  }));
}

export async function reactToChat(id: string, emoji: string, on: boolean): Promise<void> {
  const projectId = requireProject();
  await reported("collab chat react", () => collabChatReact(projectId, id, emoji, on));
  const self = liveSelfId(useCollabLiveStore.getState());
  if (useChat.getState().projectId !== projectId || !self) return;
  useChat.setState((state) => ({
    messages: state.messages.map((message) =>
      message.id === id
        ? { ...message, reactions: withPending(message.reactions ?? [], { [emoji]: on }, self).map(({ emoji: shown, by }) => ({ emoji: shown, by: [...by] })) }
        : message,
    ),
  }));
}

export async function clearChat(): Promise<void> {
  const projectId = requireProject();
  await reported("collab chat clear", () => collabChatClear(projectId));
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
  let statusToken = 0;
  let heard: CollabChatStatus | null = null;
  drafts.clear();
  pending.clear();

  const cancelReload = () => {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = null;
  };

  const live = () =>
    liveJoinedProjectId(useCollabLiveStore.getState()) !== null && chatAvailable(useChat.getState().status);

  const syncRail = () => {
    const { projectId, status } = useChat.getState();
    const visible = projectId !== null && chatAvailable(status);
    if (useChatRail.getState().visible !== visible) useChatRail.setState(visible ? { visible } : { visible, unread: false });
  };

  const applyStatus = (raw: CollabChatStatus) => {
    heard = raw;
    const status = useCollabLiveStore.getState().restricted ? { ...raw, available: false, post: false } : raw;
    const shown = useChat.getState();
    const was = chatAvailable(shown.status);
    if (was && !status.available) {
      cancelReload();
      loadToken += 1;
      useChat.setState({ ...blank(shown.projectId), status });
      useChatRail.setState({ reveal: null });
    } else if (!sameData(shown.status, status)) {
      useChat.setState({ status });
    }
    syncRail();
    if (status.available && !was && live()) void loadChat();
  };

  const refreshStatus = async () => {
    const projectId = useChat.getState().projectId;
    if (!projectId) return;
    const token = ++statusToken;
    try {
      const status = await collabChatStatus(projectId);
      if (token === statusToken && useChat.getState().projectId === projectId) applyStatus(status);
    } catch (error) {
      void logError("collab chat status", error);
    }
  };

  const openProject = () => {
    const projectId = liveJoinedProjectId(useCollabLiveStore.getState());
    if (projectId === useChat.getState().projectId) {
      syncRail();
      return;
    }
    cancelReload();
    loadToken += 1;
    statusToken += 1;
    heard = null;
    useChat.setState(blank(projectId));
    useChatRail.setState({ visible: false, unread: false, reveal: null });
    if (projectId) void refreshStatus();
  };

  const onChanged = (payload: CollabChatChanged) => {
    const chat = useChat.getState();
    if (payload.projectId !== chat.projectId) return;
    noteChatMentions(payload);
    if (!chatAvailable(chat.status)) {
      void refreshStatus();
      return;
    }
    cancelReload();
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void loadChat();
    }, RELOAD_DELAY_MS);
  };

  const stopLive = useCollabLiveStore.subscribe((state, previous) => {
    if (liveJoinedProjectId(state) !== liveJoinedProjectId(previous)) {
      openProject();
      return;
    }
    if (state.restricted !== previous.restricted && heard) applyStatus(heard);
    const cameOnline = state.status?.state === "online" && previous.status?.state !== "online";
    if (state.role === previous.role && !cameOnline) return;
    void refreshStatus();
    if (live()) void loadChat();
  });
  const stopSettings = useSettingsStore.subscribe((settings, previous) => {
    if (settings.railTab === previous.railTab && settings.showTree === previous.showTree) return;
    const open = chatOpen();
    if (open && useChatRail.getState().unread) useChatRail.setState({ unread: false });
    if (!open && previous.railTab === "chat" && previous.showTree) useChatRail.setState({ reveal: null });
  });
  const listening = [
    onCollabChatChanged(onChanged),
    onCollabCommentsStatus((payload) => {
      if (payload.projectId === useChat.getState().projectId) void refreshStatus();
    }),
  ].map((listener) =>
    listener.catch((error: unknown) => {
      void logError("collab chat listen", error);
      return () => undefined;
    }),
  );

  openProject();

  return () => {
    stopLive();
    stopSettings();
    for (const listener of listening) void listener.then((unlisten) => unlisten());
    cancelReload();
    loadToken += 1;
    statusToken += 1;
    heard = null;
    useChat.setState(blank(null));
    useChatRail.setState({ visible: false, unread: false, reveal: null });
  };
}
