// Live turn records: the authoritative item-layer state for the active
// chat. One TurnFold per chat runs the event fold (records mutate in place
// inside the fold; the store republishes on every applied event), turns are
// keyed by chat with a thread mapping so a chat keeps its rollout thread
// across sends. Queued follow-ups implement steer-vs-queue: Enter during a
// running turn queues; an explicit steer injects mid-run.

import { create } from "zustand";
import type { AgentEvent } from "@oleafly/ai-core";
import { DeltaQueues, TurnFold, type TurnRecord } from "@oleafly/ai-core";
import { windowFlushScheduler } from "@/lib/agent-stream-scheduler";

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
const pendingPublishes = new Map<string, TurnFold>();
const publishQueues = new DeltaQueues(windowFlushScheduler());

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

function scheduleRepublish(chatId: string, fold: TurnFold): void {
  if (pendingPublishes.has(chatId)) return;
  pendingPublishes.set(chatId, fold);
  publishQueues.enqueueFrameText(() => {
    const pending = pendingPublishes.get(chatId);
    if (!pending) return;
    pendingPublishes.delete(chatId);
    useAgentTurnsStore.setState((state) => republish(state, chatId, pending));
  });
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
    if (event.kind === "textDelta" || event.kind === "reasoningDelta") {
      scheduleRepublish(chatId, fold);
      return;
    }
    pendingPublishes.delete(chatId);
    set((state) => republish(state, chatId, fold));
  },

  finishTurn: (chatId, stoppedAtCap) => {
    const fold = folds.get(chatId);
    if (!fold) return;
    fold.finish(stoppedAtCap);
    pendingPublishes.delete(chatId);
    set((state) => republish(state, chatId, fold));
  },

  interruptTurn: (chatId) => {
    const fold = folds.get(chatId);
    if (!fold) return;
    fold.markInterrupted();
    pendingPublishes.delete(chatId);
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

  markSteered: (_chatId, followUpId) => {
    set((state) => {
      const owner = Object.entries(state.queuedByChat).find(([, queued]) =>
        queued.some((item) => item.id === followUpId),
      );
      if (!owner) return {};
      const [chatId, queued] = owner;
      return {
        queuedByChat: {
          ...state.queuedByChat,
          [chatId]: queued.map((item) =>
            item.id === followUpId ? { ...item, status: "steered" } : item,
          ),
        },
      };
    });
  },

  takeFollowUps: (chatId) => {
    const queued = get().queuedByChat[chatId] ?? [];
    const pendingIndex = queued.findIndex((item) => item.status === "pending");
    const taken = pendingIndex >= 0 ? [queued[pendingIndex]] : [];
    const remaining = queued.filter(
      (item, index) => item.status === "pending" && index !== pendingIndex,
    );
    set((state) => {
      const next = { ...state.queuedByChat };
      if (remaining.length > 0) next[chatId] = remaining;
      else delete next[chatId];
      return { queuedByChat: next };
    });
    return taken;
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
    pendingPublishes.clear();
    publishQueues.dispose();
    set({ recordsByChat: {}, threadByChat: {}, queuedByChat: {} });
  },
}));
