import { create } from "zustand";
import { useChatRail } from "@/components/collab/chat-rail";
import { logError } from "@/lib/log";
import type { CollabChatChanged, CollabChatMessage, CollabErrorCode } from "@/lib/tauri";
import { collabChatClear, collabChatDelete, collabChatList, collabChatSend, onCollabChatChanged } from "@/lib/tauri-collab";
import { useSettingsStore } from "@/store/settings";
import { collabErrorCode } from "../errors";
import { useCollabLiveStore } from "../live/live-store";

export type ChatPhase = "idle" | "loading" | "ready" | "failed";

export interface ChatState {
  projectId: string | null;
  messages: CollabChatMessage[];
  phase: ChatPhase;
  error: CollabErrorCode | null;
  hasOlder: boolean;
  loadingOlder: boolean;
}

export const CHAT_PAGE = 50;
const RELOAD_DELAY_MS = 150;

function blank(projectId: string | null): ChatState {
  return { projectId, messages: [], phase: "idle", error: null, hasOlder: false, loadingOlder: false };
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
  const { projectId, messages } = useChat.getState();
  if (!projectId) return;
  const token = ++loadToken;
  if (useChat.getState().phase !== "ready") useChat.setState({ phase: "loading", error: null });
  const limit = Math.max(CHAT_PAGE, messages.length);
  let listed: CollabChatMessage[];
  try {
    listed = await collabChatList(projectId, null, limit);
  } catch (error) {
    if (token !== loadToken || useChat.getState().projectId !== projectId) return;
    const code = collabErrorCode(error);
    if (code === "not_found") {
      useChat.setState({ messages: [], phase: "ready", error: null, hasOlder: false });
      return;
    }
    void logError("collab chat load", error);
    useChat.setState({ phase: "failed", error: code });
    return;
  }
  if (token !== loadToken || useChat.getState().projectId !== projectId) return;
  const next = chronological(listed);
  useChat.setState((state) => ({
    messages: same(state.messages, next) ? state.messages : next,
    phase: "ready",
    error: null,
    hasOlder: listed.length >= limit,
  }));
}

export async function loadOlderChat(): Promise<void> {
  const { projectId, messages, loadingOlder, hasOlder } = useChat.getState();
  if (!projectId || loadingOlder || !hasOlder || messages.length === 0) return;
  useChat.setState({ loadingOlder: true });
  try {
    const older = await collabChatList(projectId, messages[0].id, CHAT_PAGE);
    if (useChat.getState().projectId !== projectId) return;
    useChat.setState((state) => ({
      messages: merged(older, state.messages),
      hasOlder: older.length >= CHAT_PAGE,
    }));
  } catch (error) {
    void logError("collab chat older", error);
    throw error;
  } finally {
    if (useChat.getState().projectId === projectId) useChat.setState({ loadingOlder: false });
  }
}

function requireProject(): string {
  const projectId = useChat.getState().projectId;
  if (!projectId) throw new Error("This project is not shared.");
  return projectId;
}

export async function sendChat(body: string): Promise<void> {
  const projectId = requireProject();
  const message = await collabChatSend(projectId, body);
  if (useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => ({ messages: merged(state.messages, [message]) }));
}

export async function deleteChat(id: string): Promise<void> {
  const projectId = requireProject();
  await collabChatDelete(projectId, id);
  if (useChat.getState().projectId !== projectId) return;
  useChat.setState((state) => ({
    messages: state.messages.map((message) => (message.id === id ? { ...message, body: "", deleted: true } : message)),
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

export function startChat(): () => void {
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

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
    useChatRail.setState({ unread: false });
    if (projectId && live()) void loadChat();
  };

  const onChanged = (payload: CollabChatChanged) => {
    if (payload.projectId !== useChat.getState().projectId) return;
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
    if (chatOpen() && useChatRail.getState().unread) useChatRail.setState({ unread: false });
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
    useChatRail.setState({ visible: false, unread: false });
  };
}
