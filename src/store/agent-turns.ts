import { create } from "zustand";
import type { AgentEvent } from "@oleafly/ai-core";
import {
  DeltaQueues,
  TurnFold,
  type RecordedStoreItem,
  type StoreItem,
  type TurnRecord,
} from "@oleafly/ai-core";
import { windowFlushScheduler } from "@/lib/agent-stream-scheduler";

export interface QueuedAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
}

export interface QueuedFollowUp {
  id: string;
  text: string;
  attachments: QueuedAttachment[];
  status: "pending" | "steered";
}

interface AgentTurnsState {
  recordsByChat: Record<string, TurnRecord[]>;
  addedItemsByChat: Record<string, RecordedStoreItem[]>;
  threadByChat: Record<string, string>;
  queuedByChat: Record<string, QueuedFollowUp[]>;
  beginTurn: (chatId: string, threadId: string, clientTurnId: string, userText: string) => void;
  applyEvent: (chatId: string, event: AgentEvent) => void;
  finishTurn: (chatId: string, stoppedAtCap: boolean) => void;
  interruptTurn: (chatId: string) => void;
  rollbackTurn: (chatId: string, clientTurnId: string) => void;
  queueFollowUp: (chatId: string, text: string, attachments?: QueuedAttachment[]) => void;
  markSteered: (chatId: string, followUpId: string) => void;
  removeFollowUp: (chatId: string, followUpId: string) => void;
  takeFollowUps: (chatId: string) => QueuedFollowUp[];
  acknowledgeFollowUp: (chatId: string, followUpId: string) => void;
  threadFor: (chatId: string, projectId: string | null, claimPrewarmed: () => Promise<string | null>) => Promise<string>;
  reset: () => void;
}

const folds = new Map<string, TurnFold>();
const pendingPublishes = new Map<string, TurnFold>();
const publishQueues = new DeltaQueues(windowFlushScheduler());

function cloneStreamingItem(recorded: RecordedStoreItem): RecordedStoreItem {
  let item: StoreItem = { ...recorded.item };
  if (recorded.item.type === "reasoning") {
    item = {
      ...recorded.item,
      summary: [...recorded.item.summary],
      content: [...recorded.item.content],
    };
  } else if (recorded.item.type === "commandExecution") {
    item = { ...recorded.item, command: [...recorded.item.command] };
  }
  return { ...recorded, item };
}

function itemCanStillChange(
  recorded: RecordedStoreItem,
  index: number,
  itemCount: number,
): boolean {
  const item = recorded.item;
  if (
    (item.type === "commandExecution" ||
      item.type === "fileChange" ||
      item.type === "dynamicToolCall" ||
      item.type === "mcpToolCall") &&
    item.status === "inProgress"
  ) {
    return true;
  }
  return (
    !recorded.completed &&
    index === itemCount - 1 &&
    (item.type === "agentMessage" || item.type === "reasoning")
  );
}

function streamingSnapshot(previous: TurnRecord, current: TurnRecord): TurnRecord {
  return {
    ...current,
    items: current.items.map((recorded, index) => {
      const prior = previous.items[index];
      if (!prior || prior.id !== recorded.id) return cloneStreamingItem(recorded);
      if (prior.completed !== recorded.completed) return cloneStreamingItem(recorded);
      if (itemCanStillChange(prior, index, previous.items.length)) {
        return cloneStreamingItem(recorded);
      }
      if (itemCanStillChange(recorded, index, current.items.length)) {
        return cloneStreamingItem(recorded);
      }
      return prior;
    }),
  };
}

function republish(
  state: Pick<AgentTurnsState, "recordsByChat" | "addedItemsByChat">,
  chatId: string,
  fold: TurnFold,
): Partial<AgentTurnsState> {
  const previous = state.recordsByChat[chatId] ?? [];
  const previousRecord = previous[previous.length - 1];
  const current = fold.snapshot();
  const snapshot = previousRecord
    ? streamingSnapshot(previousRecord, current)
    : structuredClone(current);
  const added = snapshot.items.slice(previousRecord?.items.length ?? 0);
  const update: Partial<AgentTurnsState> = {
    recordsByChat: {
      ...state.recordsByChat,
      [chatId]: [...previous.slice(0, -1), snapshot],
    },
  };
  if (added.length > 0) {
    update.addedItemsByChat = { ...state.addedItemsByChat, [chatId]: added };
  }
  return update;
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
  addedItemsByChat: {},
  threadByChat: {},
  queuedByChat: {},

  beginTurn: (chatId, threadId, clientTurnId, userText) => {
    // The optimistic turn: a user message item exists before any request.
    const fold = new TurnFold(clientTurnId, clientTurnId).pushUserMessage(userText);
    folds.set(chatId, fold);
    const snapshot = structuredClone(fold.snapshot());
    set((state) => ({
      threadByChat: { ...state.threadByChat, [chatId]: threadId },
      recordsByChat: {
        ...state.recordsByChat,
        [chatId]: [...(state.recordsByChat[chatId] ?? []), snapshot],
      },
      addedItemsByChat: { ...state.addedItemsByChat, [chatId]: snapshot.items },
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

  rollbackTurn: (chatId, clientTurnId) => {
    const fold = folds.get(chatId);
    if (fold?.snapshot().clientTurnId === clientTurnId) {
      folds.delete(chatId);
      pendingPublishes.delete(chatId);
    }
    set((state) => {
      const records = state.recordsByChat[chatId] ?? [];
      const remaining = records.filter((record) => record.clientTurnId !== clientTurnId);
      if (remaining.length === records.length) return {};
      const recordsByChat = { ...state.recordsByChat };
      const addedItemsByChat = { ...state.addedItemsByChat };
      if (remaining.length > 0) recordsByChat[chatId] = remaining;
      else delete recordsByChat[chatId];
      delete addedItemsByChat[chatId];
      return { recordsByChat, addedItemsByChat };
    });
  },

  queueFollowUp: (chatId, text, attachments = []) => {
    if (!text.trim() && attachments.length === 0) return;
    set((state) => ({
      queuedByChat: {
        ...state.queuedByChat,
        [chatId]: [
          ...(state.queuedByChat[chatId] ?? []),
          {
            id: crypto.randomUUID(),
            text: text.trim(),
            attachments: attachments.map((attachment) => ({ ...attachment })),
            status: "pending",
          },
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

  removeFollowUp: (chatId, followUpId) => {
    set((state) => {
      const queued = state.queuedByChat[chatId] ?? [];
      const remaining = queued.filter((item) => item.id !== followUpId);
      if (remaining.length === queued.length) return {};
      const next = { ...state.queuedByChat };
      if (remaining.length > 0) next[chatId] = remaining;
      else delete next[chatId];
      return { queuedByChat: next };
    });
  },

  takeFollowUps: (chatId) => {
    const queued = get().queuedByChat[chatId] ?? [];
    const pendingIndex = queued.findIndex((item) => item.status === "pending");
    const taken = pendingIndex >= 0 ? [queued[pendingIndex]] : [];
    if (queued.some((item) => item.status === "steered")) {
      set((state) => {
        const next = { ...state.queuedByChat };
        const remaining = (next[chatId] ?? []).filter((item) => item.status === "pending");
        if (remaining.length > 0) next[chatId] = remaining;
        else delete next[chatId];
        return { queuedByChat: next };
      });
    }
    return taken;
  },

  acknowledgeFollowUp: (chatId, followUpId) => {
    set((state) => {
      const queued = state.queuedByChat[chatId] ?? [];
      const remaining = queued.filter((item) => item.id !== followUpId);
      if (remaining.length === queued.length) return {};
      const next = { ...state.queuedByChat };
      if (remaining.length > 0) next[chatId] = remaining;
      else delete next[chatId];
      return { queuedByChat: next };
    });
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
    set({ recordsByChat: {}, addedItemsByChat: {}, threadByChat: {}, queuedByChat: {} });
  },
}));
