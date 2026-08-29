// Live turn records: the authoritative item-layer state for the active
// chat. One TurnFold per chat runs the event fold (records mutate in place
// inside the fold; the store republishes on every applied event), turns are
// keyed by chat with a thread mapping so a chat keeps its rollout thread
// across sends. Queued follow-ups implement steer-vs-queue: Enter during a
// running turn queues; an explicit steer injects mid-run.

import { create } from "zustand";
import type { AgentEvent } from "@oleafly/ai-core";
import { TurnFold, type TurnRecord } from "@oleafly/ai-core";

export interface QueuedFollowUp {
  id: string;
  text: string;
  status: "pending" | "steered";
}

interface AgentTurnsState {
  recordsByChat: Record<string, TurnRecord[]>;
  threadByChat: Record<string, string>;
  queuedByChat: Record<string, QueuedFollowUp[]>;
  beginTurn: (chatId: string, threadId: string, clientTurnId: string, userText: string) => void;
  applyEvent: (chatId: string, event: AgentEvent) => void;
  finishTurn: (chatId: string, stoppedAtCap: boolean) => void;
  interruptTurn: (chatId: string) => void;
  queueFollowUp: (chatId: string, text: string) => void;
  markSteered: (chatId: string, followUpId: string) => void;
  takeFollowUps: (chatId: string) => QueuedFollowUp[];
  threadFor: (chatId: string, projectId: string | null, claimPrewarmed: () => Promise<string | null>) => Promise<string>;
  reset: () => void;
}

const folds = new Map<string, TurnFold>();

function republish(
  state: Pick<AgentTurnsState, "recordsByChat">,
  chatId: string,
  fold: TurnFold,
): Partial<AgentTurnsState> {
  const snapshot = fold.snapshot();
  const previous = state.recordsByChat[chatId] ?? [];
  return {
    recordsByChat: {
      ...state.recordsByChat,
      [chatId]: [...previous.slice(0, -1), structuredClone(snapshot)],
    },
  };
}

export const useAgentTurnsStore = create<AgentTurnsState>((set, get) => ({
  recordsByChat: {},
  threadByChat: {},
  queuedByChat: {},

  beginTurn: (chatId, threadId, clientTurnId, userText) => {
    // The optimistic turn: a user message item exists before any request.
    const fold = new TurnFold(clientTurnId, clientTurnId).pushUserMessage(userText);
    folds.set(chatId, fold);
    set((state) => ({
      threadByChat: { ...state.threadByChat, [chatId]: threadId },
      recordsByChat: {
        ...state.recordsByChat,
        [chatId]: [...(state.recordsByChat[chatId] ?? []), structuredClone(fold.snapshot())],
      },
    }));
  },

  applyEvent: (chatId, event) => {
    const fold = folds.get(chatId);
    if (!fold) return;
    fold.apply(event);
    set((state) => republish(state, chatId, fold));
  },

  finishTurn: (chatId, stoppedAtCap) => {
    const fold = folds.get(chatId);
    if (!fold) return;
    fold.finish(stoppedAtCap);
    set((state) => republish(state, chatId, fold));
  },

  interruptTurn: (chatId) => {
    const fold = folds.get(chatId);
    if (!fold) return;
    fold.markInterrupted();
    set((state) => republish(state, chatId, fold));
    folds.delete(chatId);
  },

  queueFollowUp: (chatId, text) => {
    if (!text.trim()) return;
    set((state) => ({
      queuedByChat: {
        ...state.queuedByChat,
        [chatId]: [
          ...(state.queuedByChat[chatId] ?? []),
          { id: crypto.randomUUID(), text: text.trim(), status: "pending" },
        ],
      },
    }));
  },

  markSteered: (chatId, followUpId) => {
    set((state) => ({
      queuedByChat: {
        ...state.queuedByChat,
        [chatId]: (state.queuedByChat[chatId] ?? []).map((item) =>
          item.id === followUpId ? { ...item, status: "steered" } : item,
        ),
      },
    }));
  },

  takeFollowUps: (chatId) => {
    const queued = get().queuedByChat[chatId] ?? [];
    set((state) => {
      const next = { ...state.queuedByChat };
      delete next[chatId];
      return { queuedByChat: next };
    });
    return queued;
  },

  threadFor: async (chatId, projectId, claimPrewarmed) => {
    const existing = get().threadByChat[chatId];
    if (existing) return existing;
    if (projectId) {
      const prewarmed = await claimPrewarmed().catch(() => null);
      if (prewarmed) {
        set((state) => ({ threadByChat: { ...state.threadByChat, [chatId]: prewarmed } }));
        return prewarmed;
      }
    }
    const fresh = `thread-${crypto.randomUUID()}`;
    set((state) => ({ threadByChat: { ...state.threadByChat, [chatId]: fresh } }));
    return fresh;
  },

  reset: () => {
    folds.clear();
    set({ recordsByChat: {}, threadByChat: {}, queuedByChat: {} });
  },
}));
