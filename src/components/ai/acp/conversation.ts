import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { AcpEvent, AcpSession } from "@/lib/acp";
import type { RenderedMessage } from "@/components/ai/MessageList";
import { createLiveMessageStore, streamedEntryChange, type LiveMessageStore } from "@/components/ai/live-message";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { createAcpProjector } from "./projection";

interface ConversationState {
  events: Record<string, AcpEvent[]>;
  sessions: Record<string, AcpSession>;
}

export interface AcpConversationSource {
  getState: () => ConversationState;
  subscribe: (listener: (state: ConversationState) => void) => () => void;
}

export interface AcpConversation {
  readonly live: LiveMessageStore;
  getMessages: () => readonly RenderedMessage[];
  subscribe: (listener: () => void) => () => void;
  setSending: (sending: boolean) => void;
  connect: () => () => void;
}

const NO_EVENTS: readonly AcpEvent[] = [];
const NO_MESSAGES: readonly RenderedMessage[] = [];

function sessionRunning(state: ConversationState, sessionId: string): boolean {
  const status = state.sessions[sessionId]?.status;
  return status === "running" || status === "cancelling";
}

export function createAcpConversation(
  sessionId: string | null,
  source: AcpConversationSource = useAcpSessionsStore,
): AcpConversation {
  const live = createLiveMessageStore();
  const listeners = new Set<() => void>();
  if (!sessionId) {
    return {
      live,
      getMessages: () => NO_MESSAGES,
      subscribe: () => () => {},
      setSending: () => {},
      connect: () => () => {},
    };
  }
  const project = createAcpProjector();
  let sending = false;
  let events: readonly AcpEvent[] = source.getState().events[sessionId] ?? NO_EVENTS;
  let running = sessionRunning(source.getState(), sessionId);
  let committed: readonly RenderedMessage[] = project(events, running);

  const sync = (state: ConversationState) => {
    const nextEvents = state.events[sessionId] ?? NO_EVENTS;
    const nextRunning = sending || sessionRunning(state, sessionId);
    if (nextEvents === events && nextRunning === running) return;
    events = nextEvents;
    running = nextRunning;
    const next = project(events, running);
    const streamed = streamedEntryChange(committed, next);
    if (streamed) {
      const shown = live.get();
      if (shown?.base !== streamed.base || shown.message !== streamed.message) live.set(streamed);
      return;
    }
    if (next.length === committed.length && next.every((entry, index) => entry === committed[index])) return;
    committed = next;
    live.set(null);
    const snapshot = [...listeners];
    for (const listener of snapshot) listener();
  };

  return {
    live,
    getMessages: () => committed,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSending: (value) => {
      if (value === sending) return;
      sending = value;
      sync(source.getState());
    },
    connect: () => {
      const stop = source.subscribe(sync);
      sync(source.getState());
      return stop;
    },
  };
}

export function useAcpConversation(sessionId: string | null, sending: boolean): AcpConversation {
  const conversation = useMemo(() => createAcpConversation(sessionId), [sessionId]);
  useLayoutEffect(() => conversation.setSending(sending), [conversation, sending]);
  useEffect(() => conversation.connect(), [conversation]);
  return conversation;
}

export function useAcpMessages(conversation: AcpConversation): readonly RenderedMessage[] {
  return useSyncExternalStore(conversation.subscribe, conversation.getMessages, conversation.getMessages);
}

export function useAcpHasMessages(conversation: AcpConversation): boolean {
  const hasMessages = () => conversation.getMessages().length > 0;
  return useSyncExternalStore(conversation.subscribe, hasMessages, hasMessages);
}
